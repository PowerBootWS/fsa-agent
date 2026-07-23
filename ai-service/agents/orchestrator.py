"""
Orchestrator - Central coordinator for the multi-agent system.
Manages conversation state, routes activity flow, persists progress to DB.
"""
import os
import re
import requests


# Intent labels returned by the classifier
INTENT_SELECT_PRACTICE = 'select_practice'
INTENT_SELECT_REVIEW = 'select_review'
INTENT_SELECT_DISCUSSION = 'select_discussion'
INTENT_PROVIDE_ANSWER = 'provide_answer'
INTENT_CONTINUE = 'continue'
INTENT_STOP = 'stop'
INTENT_OTHER = 'other'

# How many exchanges before we treat the session as near its context limit
CONTEXT_LIMIT_EXCHANGES = 20
MAX_QUESTIONS_PER_OBJECTIVE = 5
PROGRESS_SAVE_INTERVAL = 3  # save progress every N exchanges as a heartbeat

CHAPTER_QUIZ_QUESTION_COUNT = 15
PRACTICE_EXAM_QUESTION_COUNT = 50

# Courses with no lesson content and a reduced-AI (stats-only) debrief — see
# docs/superpowers/specs/2026-07-13-fourth-class-platform-integration-design.md.
# The AI service only ever sees course_id (never class_code), so membership in
# this fixed set is the simplest correct "is this 4th Class" signal.
FOURTH_CLASS_COURSES = {'4A', '4B'}

def _detect_mode(lesson_id):
    """
    Detect session mode from the lesson_id string.
    Returns 'lesson', 'chapter_quiz', or 'practice_exam'.
    """
    lid = str(lesson_id)
    if re.match(r'^[A-Z0-9]{2,5}-\d{1,3}-\d{1,3}$', lid, re.IGNORECASE):
        return 'lesson'
    if re.match(r'^[A-Z0-9]{2,5}-\d{1,3}$', lid, re.IGNORECASE):
        return 'chapter_quiz'
    if re.match(r'^[A-Z0-9]{2,5}$', lid, re.IGNORECASE):
        return 'practice_exam'
    return 'lesson'  # numeric id or UUID → lesson


class Orchestrator:
    def __init__(self):
        self.conversation_state = {}
        self._api_key = os.getenv('OPENROUTER_API_KEY')
        self._model = os.getenv('OPENROUTER_MODEL', 'deepseek/deepseek-v4-flash')
        self._base_url = 'https://openrouter.ai/api/v1'

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def process(self, user, lesson_id, message, lesson_context, progress,
                tutor, display, researcher, exam_config=None):
        """
        Main entry point — coordinates the full agent pipeline.

        Returns dict with:
        - tutor_response: message from Tutor Agent
        - display_update: content for top section (if any)
        - progress_update: scoring/progress snapshot
        - complexity_level: current complexity level
        - first_name: student's first name
        - action: optional action ('stop', 'warning', None)
        """
        state_key = f'{user}:{lesson_id}'
        mode = _detect_mode(lesson_id)

        # Initialize state for new sessions
        if state_key not in self.conversation_state:
            user_info = researcher.get_user_by_email(user)
            first_name = user_info.get('first_name', 'there')
            complexity = progress.get('complexity_level', 3) if progress else 3

            self.conversation_state[state_key] = {
                'user': user,
                'lesson_id': lesson_id,
                'mode': mode,
                'first_name': first_name,
                'initialized': False,
                'exchange_count': 0,

                # Progress tracking
                'score': progress.get('score', 100) if progress else 100,
                'struggles': list(progress.get('struggles', []) if progress else []),
                'attempts': dict(progress.get('attempts', {}) if progress else {}),
                'complexity_level': complexity,

                # Activity state machine
                'activity': 'greeting',
                'questions_done': 0,
                'session_limit_reached': False,
                'seen_question_ids': [],

                # Staged problem state
                'staged_step': 1,
                'staged_problem_id': None,
                'staged_context': {},
                'staged_step1_answer': None,
                'staged_step2_answer': None,
                'staged_step3_answer': None,

                # Review state
                'review_index': 0,

                # Chat history for LLM context (rolling, max 12 entries)
                'chat_history': [],

                # Profanity tracking
                'profanity_count': 0,

                # Chapter quiz state
                'quiz_questions': [],       # pre-loaded list for the session
                'quiz_index': 0,            # which question we're on
                'quiz_correct': 0,          # running tally
                'quiz_awaiting_feedback': False,
                'quiz_current_correct_answer': None,

                # Practice exam state
                'exam_questions': [],       # pre-loaded list
                'exam_index': 0,
                'exam_results': [],         # list of {chapter_id, correct}
                'exam_phase': 'answering',  # 'answering' or 'debrief'
                # Exam configuration (set once on session init from client)
                'exam_question_count': (exam_config or {}).get('count', PRACTICE_EXAM_QUESTION_COUNT),
                'exam_timed': (exam_config or {}).get('timed', False),
                'exam_lead_magnet': (exam_config or {}).get('lead_magnet', False),
            }

        state = self.conversation_state[state_key]
        first_name = state['first_name']
        state['exchange_count'] = state.get('exchange_count', 0) + 1
        mode = state.get('mode', 'lesson')

        # Route chapter quiz and practice exam modes entirely separately
        if mode == 'chapter_quiz':
            return self._process_chapter_quiz(
                state, user, lesson_id, message, researcher, display
            )
        if mode == 'practice_exam':
            # examConfig is only sent when the lobby is starting a brand-new exam.
            # A bare 'hello' with no examConfig is a refresh/review and must NOT
            # spin up a new exam (see the DB-restore guard in _process_practice_exam).
            state['_starting_new_exam'] = exam_config is not None
            # If the lobby is starting a fresh exam (examConfig provided) and the previous
            # session is in the debrief/done state, reset exam-specific state now so that
            # _process_practice_exam sees a clean slate and doesn't re-run the debrief LLM call.
            if exam_config is not None and state.get('exam_done'):
                state['exam_done'] = False
                state['exam_phase'] = 'answering'
                state['exam_questions'] = []
                state['exam_index'] = 0
                state['exam_results'] = []
                state['exam_question_count'] = exam_config.get('count', PRACTICE_EXAM_QUESTION_COUNT)
                state['exam_timed'] = exam_config.get('timed', False)
                state['exam_lead_magnet'] = exam_config.get('lead_magnet', False)
            return self._process_practice_exam(
                state, user, lesson_id, message, researcher, display, tutor, lesson_context, progress
            )

        # Detect page-reload / session-resume: client sends message='hello' on init.
        # We treat this as a resume if the session is already initialized.
        is_init_hello = message.strip().lower() == 'hello'

        # On first interaction: set up initial display
        display_update = None
        if not state['initialized']:
            initial_context = researcher.extract_key_points(lesson_context)
            initial_context['first_name'] = first_name
            initial_context['lesson_id'] = lesson_id
            initial_context['user'] = user
            state['key_points'] = lesson_context.get('key_points', [])
            display_update = display.create_initial_display(initial_context)
            state['initialized'] = True
        elif is_init_hello:
            # Session already exists (page reload / tab switch).
            # Re-send the appropriate display so the client has fresh content.
            activity = state.get('activity', 'greeting')
            if activity in ('practice', 'staged_problem') and state.get('current_question_id'):
                # Re-emit the current question display so the panel shows it again
                current_q = None
                seen = state.get('seen_question_ids', [])
                if seen:
                    # Re-fetch the most recently seen question
                    questions = researcher.get_questions(
                        lesson_id=lesson_id,
                        complexity_level=5,  # fetch any difficulty
                        question_type='objective_practice',
                        limit=20,
                    )
                    last_id = state.get('current_question_id')
                    for q in questions:
                        if q['id'] == last_id:
                            current_q = q
                            break
                if current_q:
                    display_update = display.create_question_display(
                        current_q, max(0, state.get('questions_done', 1) - 1)
                    )
                else:
                    # Fall back to summary display
                    initial_context = researcher.extract_key_points(lesson_context)
                    display_update = display.create_initial_display(initial_context)
            else:
                # Greeting or other mode — re-send the summary display
                initial_context = researcher.extract_key_points(lesson_context)
                display_update = display.create_initial_display(initial_context)

        # Route based on current activity.
        # Skip routing for session-resume hello pings — they just refresh the display.
        is_resume = is_init_hello and state.get('exchange_count', 0) > 1
        state['is_resume'] = is_resume
        if not is_resume:
            display_update, state = self._route_activity(
                state, message, lesson_context, researcher, display, display_update
            )

        # Fetch relevant chunks for this activity and message
        # context_hint: use current question topic if in practice, else the user message
        context_hint = None
        if state.get('activity') in ('practice', 'staged_problem'):
            q = state.get('staged_context') or {}
            context_hint = q.get('topic') or q.get('question_text', '')[:120] or message
        elif state.get('activity') == 'free_discussion':
            context_hint = message
        # greeting / review: context_hint stays None → first-slides fallback

        relevant_chunks = researcher.get_relevant_chunks(
            lesson_code=lesson_id,
            activity=state.get('activity', 'greeting'),
            context_hint=context_hint,
            limit=4,
        )
        state['relevant_chunks'] = relevant_chunks

        # Tell the tutor whether the display panel is actually showing a question right now.
        # This prevents it from saying "the question is above" when only a summary is displayed.
        state['display_is_question'] = (
            isinstance(display_update, dict) and display_update.get('type') == 'question'
        ) or (
            # Also true if awaiting feedback and no display_update override (client keeps current question)
            state.get('awaiting_next_question') and display_update is None
        )

        # Call tutor agent for the conversational response
        tutor_result = tutor.respond(
            user_message=message,
            lesson_context=lesson_context,
            progress=progress,
            state=state,
            first_name=first_name,
        )

        if isinstance(tutor_result, dict):
            tutor_response = tutor_result.get('response', '')
            action = tutor_result.get('action')
        else:
            tutor_response = str(tutor_result)
            action = None

        # If display wasn't set by routing AND we're not in feedback/awaiting mode,
        # check if tutor response suggests a display update.
        # Suppress this during awaiting_next_question — the current question must stay visible.
        if not display_update and not state.get('awaiting_next_question'):
            display_update = display.determine_update(
                state=state,
                tutor_response=tutor_response,
                lesson_context=lesson_context,
            )

        # Track progress changes and persist to DB periodically
        self._update_score(state, message, lesson_context)
        self._adjust_complexity(state)

        if self._should_save_progress(state):
            outcome = self._compute_outcome(state)
            researcher.save_progress(
                user_email=state['user'],
                lesson_id=state['lesson_id'],
                score=state['score'],
                struggles=state['struggles'],
                attempts=state['attempts'],
                complexity_level=state['complexity_level'],
                outcome=outcome,
            )

        return {
            'tutor_response': tutor_response,
            'display_update': display_update,
            'progress_update': {
                'score': state['score'],
                'struggles': state['struggles'],
                'complexity_level': state['complexity_level'],
            },
            'complexity_level': state['complexity_level'],
            'first_name': first_name,
            'action': action,
        }

    # ------------------------------------------------------------------
    # Activity routing
    # ------------------------------------------------------------------

    def _route_activity(self, state, message, lesson_context, researcher, display, display_update):
        """
        Update state based on current activity and user message.
        Returns (display_update, updated_state).
        """
        activity = state.get('activity', 'greeting')

        if activity == 'greeting':
            # Use LLM classifier only here — this is the one branch where we need to
            # distinguish between practice / review / discussion mode selection.
            intent = self._classify_intent(message)

            if intent == INTENT_SELECT_PRACTICE:
                state['activity'] = 'practice'
                display_update = self._load_next_question(state, lesson_context, researcher, display)

            elif intent == INTENT_SELECT_REVIEW:
                state['activity'] = 'review_concepts'
                state['review_index'] = 0

            elif intent == INTENT_SELECT_DISCUSSION:
                state['activity'] = 'free_discussion'

            # Otherwise stay in greeting — tutor LLM will handle the conversation

        elif activity == 'practice':
            if state.get('session_limit_reached'):
                # Limit already enforced; tutor prompt handles the response
                pass
            else:
                # Keyword matching is sufficient here — we only need stop/answer/continue
                intent = self._keyword_classify(message)

                if intent == INTENT_STOP:
                    state['activity'] = 'greeting'

                elif intent == INTENT_PROVIDE_ANSWER:
                    # Evaluate the answer — but DON'T load the next question yet.
                    # The tutor needs to respond first (feedback, correction, etc.)
                    # The current question stays on display while tutor gives feedback.
                    self._evaluate_practice_answer(state, message, lesson_context)
                    state['awaiting_next_question'] = True
                    # display_update stays None → client preserves current question display

                elif intent in (INTENT_CONTINUE, INTENT_SELECT_PRACTICE, INTENT_OTHER) and state.get('awaiting_next_question'):
                    # Student has acknowledged the feedback (or any follow-up message).
                    # Clear feedback mode. If they want another question they'll ask;
                    # if the limit is reached, the prompt handles it.
                    state['awaiting_next_question'] = False
                    state['activity'] = 'greeting'  # Return to greeting between questions
                    # Clear current question so resume doesn't re-display a stale question
                    state['current_question_id'] = None
                    if intent == INTENT_SELECT_PRACTICE and not state.get('session_limit_reached'):
                        # They explicitly asked for another — load it now
                        state['activity'] = 'practice'
                        display_update = self._load_next_question(state, lesson_context, researcher, display)

        elif activity == 'staged_problem':
            intent = self._keyword_classify(message)

            if intent == INTENT_STOP:
                state['activity'] = 'greeting'
            else:
                display_update = self._advance_staged_problem(
                    state, message, lesson_context, researcher, display
                )

        elif activity == 'review_concepts':
            intent = self._keyword_classify(message)

            if intent in (INTENT_CONTINUE, INTENT_SELECT_PRACTICE):
                if intent == INTENT_SELECT_PRACTICE:
                    state['activity'] = 'practice'
                    display_update = self._load_next_question(state, lesson_context, researcher, display)
                else:
                    # Advance to next key point
                    state['review_index'] = state.get('review_index', 0) + 1

            elif intent == INTENT_STOP:
                state['activity'] = 'greeting'

        elif activity in ('free_discussion', 'chapter_quiz'):
            intent = self._keyword_classify(message)
            if intent == INTENT_STOP:
                state['activity'] = 'greeting'

        return display_update, state

    # ------------------------------------------------------------------
    # Question loading
    # ------------------------------------------------------------------

    def _load_next_question(self, state, lesson_context, researcher, display):
        """Fetch the next practice question and update display. Returns display_update."""
        lesson_id = state['lesson_id']
        seen = state.get('seen_question_ids', [])

        questions = researcher.get_questions(
            lesson_id=lesson_id,
            complexity_level=state['complexity_level'],
            question_type='objective_practice',
            limit=1,
            exclude_ids=seen if seen else None,
        )

        if not questions:
            # No questions available for this lesson (not yet loaded into DB, or all seen)
            state['session_limit_reached'] = True
            state['no_questions_available'] = True
            # Fall back to discussion mode so the tutor doesn't try to present a question
            state['activity'] = 'free_discussion'
            return None

        question = questions[0]
        state['current_question_id'] = question['id']
        state['current_question_difficulty'] = question.get('difficulty', 3)
        state['seen_question_ids'].append(question['id'])

        # Check if this is a multi-step problem
        if question.get('step_data') and question['step_data'].get('steps'):
            state['activity'] = 'staged_problem'
            state['staged_step'] = 1
            state['staged_problem_id'] = question['id']
            state['staged_context'] = question
            state['staged_step1_answer'] = None
            state['staged_step2_answer'] = None
            state['staged_step3_answer'] = None

        return display.create_question_display(question, state['questions_done'])

    # ------------------------------------------------------------------
    # Staged problem progression
    # ------------------------------------------------------------------

    def _advance_staged_problem(self, state, message, lesson_context, researcher, display):
        """Advance through staged problem steps. Returns display_update."""
        staged_context = state.get('staged_context', {})
        step_data = staged_context.get('step_data', {}) or {}
        steps = step_data.get('steps', [])
        current_step = state.get('staged_step', 1)

        # Record the answer for this step
        answer_key = f'staged_step{current_step}_answer'
        state[answer_key] = message

        # Check if this answer is correct (basic evaluation)
        correct = self._evaluate_staged_step(current_step, message, steps)

        if correct:
            if current_step >= len(steps):
                # All steps complete
                state['questions_done'] += 1
                state['activity'] = 'practice'  # return to practice mode (may hit limit)
                if state['questions_done'] >= MAX_QUESTIONS_PER_OBJECTIVE:
                    state['session_limit_reached'] = True

                # Track attempt as correct
                q_id = str(state.get('staged_problem_id', 'staged'))
                if q_id not in state['attempts']:
                    state['attempts'][q_id] = {'count': 1, 'correct': True}
                else:
                    state['attempts'][q_id]['correct'] = True

                return None  # Tutor generates completion message
            else:
                # Advance to next step
                state['staged_step'] = current_step + 1
        # If wrong, staged_step stays the same; tutor will generate guidance

        # Return updated display (same question, same step or next step)
        return display.create_question_display(staged_context, state['questions_done'])

    def _evaluate_staged_step(self, step_num, message, steps):
        """
        Basic correctness check for a staged step.
        For formula choice: check if message mentions the correct formula identifier.
        For others: accept any non-trivial response and let the LLM evaluate quality.
        """
        if not steps or step_num > len(steps):
            return True

        step = steps[step_num - 1]
        step_type = step.get('type', '')
        message_lower = message.lower().strip()

        if step_type == 'formula_choice':
            correct = str(step.get('correct', '')).lower()
            return correct in message_lower

        elif step_type == 'unit_check':
            expected = str(step.get('answer', '')).lower()
            if expected in ('yes', 'no'):
                return expected in message_lower

        # For substitution and final answer: accept any substantive reply
        # The LLM tutor evaluates quality and provides feedback
        return len(message.strip()) > 2

    # ------------------------------------------------------------------
    # Practice answer evaluation (non-staged MC)
    # ------------------------------------------------------------------

    def _evaluate_practice_answer(self, state, message, lesson_context):
        """Evaluate a multiple-choice practice answer and update score/attempts."""
        q_id = str(state.get('current_question_id', 'unknown'))
        message_lower = message.lower().strip()

        # Look up the current question's correct answer from lesson context
        # (Simplified: tutor LLM provides full evaluation; here we track attempt count)
        if q_id not in state['attempts']:
            state['attempts'][q_id] = {'count': 0, 'correct': False, 'last_answer': ''}

        state['attempts'][q_id]['count'] += 1
        state['attempts'][q_id]['last_answer'] = message

        # Basic letter matching for score tracking
        selected = None
        if message_lower in ('a', 'b', 'c', 'd'):
            selected = ord(message_lower) - ord('a')
        elif message_lower in ('1', '2', '3', '4'):
            selected = int(message_lower) - 1

        # We'd need the question data to compare to correct_answer.
        # For now, increment questions_done; full evaluation is in tutor LLM.
        state['questions_done'] += 1
        if state['questions_done'] >= MAX_QUESTIONS_PER_OBJECTIVE:
            state['session_limit_reached'] = True

    # ------------------------------------------------------------------
    # Score and complexity
    # ------------------------------------------------------------------

    def _update_score(self, state, message, lesson_context):
        """Simple score tracking based on attempt patterns."""
        # Score is primarily maintained by specific evaluation methods above.
        # This is a lightweight check for any outstanding adjustments.
        pass

    def _adjust_complexity(self, state):
        """Adjust complexity level (1-5) based on performance."""
        if not state['attempts']:
            return

        total = sum(a.get('count', 1) for a in state['attempts'].values())
        avg_attempts = total / len(state['attempts'])
        correct_count = sum(1 for a in state['attempts'].values() if a.get('correct'))
        accuracy = correct_count / len(state['attempts'])

        if accuracy > 0.8 and avg_attempts < 1.5:
            state['complexity_level'] = min(5, state['complexity_level'] + 1)
        elif accuracy < 0.5 or avg_attempts > 2:
            state['complexity_level'] = max(1, state['complexity_level'] - 1)

    # ------------------------------------------------------------------
    # Progress persistence helpers
    # ------------------------------------------------------------------

    def _should_save_progress(self, state):
        """Return True when progress should be persisted to DB."""
        exchange_count = state.get('exchange_count', 0)
        # Save on every PROGRESS_SAVE_INTERVAL exchanges, or when a question was just answered
        questions_done = state.get('questions_done', 0)
        last_saved_at = state.get('last_saved_at_questions', 0)

        if questions_done > last_saved_at:
            state['last_saved_at_questions'] = questions_done
            return True

        if exchange_count % PROGRESS_SAVE_INTERVAL == 0:
            return True

        return False

    def _compute_outcome(self, state):
        """Map state to an outcome label for the user_progress record."""
        score = state.get('score', 100)
        questions_done = state.get('questions_done', 0)
        activity = state.get('activity', 'greeting')

        if activity in ('greeting',) and questions_done == 0:
            return None  # Don't overwrite a prior outcome if student hasn't done anything yet

        if score >= 80 and questions_done >= 1:
            return 'strong'
        if score < 50:
            return 'struggled'
        return None  # in progress — don't write an outcome yet

    # ------------------------------------------------------------------
    # Chapter quiz flow
    # ------------------------------------------------------------------

    def _process_chapter_quiz(self, state, user, lesson_id, message, researcher, display):
        """
        Drive the chapter quiz session.
        - Pre-loads CHAPTER_QUIZ_QUESTION_COUNT random chapter_quiz questions once.
        - One question per turn, immediate right/wrong feedback from the LLM.
        - Records each response silently.
        - After all questions: summary debrief.
        """
        first_name = state['first_name']

        # Parse chapter context from lesson_id e.g. '2B1-1'
        parts = lesson_id.split('-')
        course_id = parts[0] if parts else lesson_id
        chapter_id = lesson_id  # e.g. '2B1-1'

        # Load questions on first message
        if not state['quiz_questions'] and not state.get('quiz_done'):
            qs = researcher.get_chapter_quiz_questions(chapter_id, limit=CHAPTER_QUIZ_QUESTION_COUNT)
            state['quiz_questions'] = qs
            state['quiz_index'] = 0
            state['quiz_correct'] = 0
            state['quiz_awaiting_feedback'] = False

        questions = state['quiz_questions']
        idx = state['quiz_index']
        total = len(questions)

        # ---- Handle debrief phase ----
        if state.get('quiz_done'):
            if self._is_exam_retry(message):
                return self._reset_and_start_quiz(state, researcher, chapter_id, first_name)
            return self._build_chapter_quiz_debrief(state, first_name)

        # ---- No questions available ----
        if not questions:
            return {
                'tutor_response': (
                    f"Sorry {first_name}, I couldn't find any quiz questions for this chapter yet. "
                    "Check back soon, or head back to the lessons to keep studying."
                ),
                'display_update': None,
                'progress_update': {},
                'complexity_level': state['complexity_level'],
                'first_name': first_name,
                'action': None,
                'mode': 'chapter_quiz',
            }

        # ---- Feedback on previous answer ----
        if state['quiz_awaiting_feedback']:
            current_q = questions[idx - 1]  # question we just asked
            correct_answer = state['quiz_current_correct_answer']
            correct_index = current_q['correct_answer']
            options = current_q['options']
            correct_text = options[correct_index] if options and correct_index < len(options) else '?'
            explanation = current_q.get('explanation', '')

            # Parse what the student selected
            student_correct = self._evaluate_mc_answer(message, correct_index)
            selected_index = self._parse_mc_selected_index(message)
            state.setdefault('quiz_review', []).append({
                'question_text': current_q.get('question_text', ''),
                'options': options,
                'correct_index': correct_index,
                'selected_index': selected_index,
                'correct': student_correct,
                'explanation': explanation,
            })

            # Record response silently
            researcher.record_response(
                user_email=user,
                question_id=current_q['id'],
                session_type='chapter_quiz',
                course_id=course_id,
                chapter_id=chapter_id,
                correct=student_correct,
            )

            if student_correct:
                state['quiz_correct'] += 1
                feedback_prefix = f"Correct! "
            else:
                correct_label = chr(65 + correct_index)
                feedback_prefix = f"Not quite — the correct answer was **{correct_label}. {correct_text}**. "
                # Track missed topic
                topic = current_q.get('topic', '')
                if topic:
                    state.setdefault('quiz_topics_missed', []).append(topic)

            if explanation:
                feedback = feedback_prefix + explanation
            else:
                feedback = feedback_prefix

            state['quiz_awaiting_feedback'] = False

            # If this was the last question, return the full debrief now —
            # no second round-trip required to see the result.
            if idx >= total:
                state['quiz_done'] = True
                return self._build_chapter_quiz_debrief(state, first_name)

            # Load next question
            next_q = questions[idx]
            display_update = self._build_quiz_question_display(next_q, idx, total)
            state['quiz_awaiting_feedback'] = True
            state['quiz_current_correct_answer'] = next_q['correct_answer']
            state['quiz_index'] = idx + 1

            feedback += f"\n\n*Question {idx + 1} of {total} is ready — give it your best shot.*"
            return {
                'tutor_response': feedback,
                'display_update': display_update,
                'progress_update': {},
                'complexity_level': state['complexity_level'],
                'first_name': first_name,
                'action': None,
                'mode': 'chapter_quiz',
            }

        # ---- Present next question (or first question) ----
        q = questions[idx]
        display_update = self._build_quiz_question_display(q, idx, total)
        state['quiz_awaiting_feedback'] = True
        state['quiz_current_correct_answer'] = q['correct_answer']
        state['quiz_index'] = idx + 1

        if idx == 0:
            intro = (
                f"Let's get into it, {first_name}! Here's your Chapter Quiz — "
                f"**{total} questions**, one at a time. I'll give you feedback after each one. "
                f"There's no grade, just a quick read on where you stand. Ready? Here's question 1."
            )
        else:
            intro = f"*Question {idx + 1} of {total}:*"

        return {
            'tutor_response': intro,
            'display_update': display_update,
            'progress_update': {},
            'complexity_level': state['complexity_level'],
            'first_name': first_name,
            'action': None,
            'mode': 'chapter_quiz',
        }

    def _build_chapter_quiz_debrief(self, state, first_name):
        """
        Score + full question review for a finished chapter quiz. Called both
        immediately after the last question is answered and on resume (a
        follow-up message after quiz_done that isn't a retry trigger) — same
        content either way, no second round-trip needed to see it.
        """
        correct = state['quiz_correct']
        total = len(state['quiz_questions'])
        score_pct = int(correct / total * 100) if total else 0
        topics_missed = state.get('quiz_topics_missed', [])
        missed_str = ', '.join(topics_missed) if topics_missed else 'none in particular'
        summary = (
            f"Quiz complete, {first_name}! You got **{correct} out of {total}** "
            f"({score_pct}%).\n\n"
        )
        if score_pct >= 80:
            summary += f"Great work — you're clearly solid on this chapter. {missed_str != 'none in particular' and f'A quick look at **{missed_str}** would round things out nicely.' or ''}"
        elif score_pct >= 60:
            summary += f"Decent foundation. Worth revisiting **{missed_str}** before the practice exam — those topics came up in your wrong answers."
        else:
            summary += f"There's room to strengthen this chapter. I'd recommend going back through **{missed_str}** — those are the areas where you dropped marks. The practice exam will also help reinforce them."

        return {
            'tutor_response': summary,
            'display_update': {
                'type': 'quiz_done', 'title': 'Chapter Quiz Complete',
                'score': correct, 'total': total, 'score_pct': score_pct,
                'question_review': state.get('quiz_review', []),
            },
            'progress_update': {},
            'complexity_level': state['complexity_level'],
            'first_name': first_name,
            'action': None,
            'mode': 'chapter_quiz',
        }

    def _reset_and_start_quiz(self, state, researcher, chapter_id, first_name):
        """Chapter-quiz retry — mirrors _reset_and_start_exam's pattern exactly
        (chat-message-triggered, not a remount: QuizExamView's init effect
        only fires once per mount, so a fresh question set has to arrive via
        the same in-place state-update path every other answer uses)."""
        qs = researcher.get_chapter_quiz_questions(chapter_id, limit=CHAPTER_QUIZ_QUESTION_COUNT)
        if not qs:
            return {
                'tutor_response': f"Sorry {first_name}, I couldn't load new quiz questions for this chapter right now. Please try again in a moment.",
                'display_update': None,
                'progress_update': {},
                'complexity_level': state.get('complexity_level', 3),
                'first_name': first_name,
                'action': None,
                'mode': 'chapter_quiz',
            }

        state['quiz_questions'] = qs
        state['quiz_correct'] = 0
        state['quiz_done'] = False
        state['quiz_topics_missed'] = []
        state['quiz_review'] = []
        state['quiz_awaiting_feedback'] = True
        state['quiz_current_correct_answer'] = qs[0]['correct_answer']
        state['quiz_index'] = 1

        display_update = self._build_quiz_question_display(qs[0], 0, len(qs))
        intro = (
            f"Fresh chapter quiz, {first_name}! **{len(qs)} questions**, one at a time, "
            f"randomly selected — here's question 1."
        )
        return {
            'tutor_response': intro,
            'display_update': display_update,
            'progress_update': {},
            'complexity_level': state['complexity_level'],
            'first_name': first_name,
            'action': None,
            'mode': 'chapter_quiz',
        }

    def _build_quiz_question_display(self, q, idx, total):
        options = q.get('options', [])
        formatted = [{'label': chr(65 + i), 'text': opt} for i, opt in enumerate(options)]
        return {
            'type': 'question',
            'title': f'Question {idx + 1} of {total}',
            'question': q.get('question_text', ''),
            'options': formatted,
            'topic': q.get('topic', ''),
            'question_id': q['id'],
        }

    # ------------------------------------------------------------------
    # Practice exam flow
    # ------------------------------------------------------------------

    def _process_practice_exam(self, state, user, lesson_id, message,
                                researcher, display, tutor, lesson_context, progress):
        """
        Drive the adaptive practice exam session.
        - Pre-loads PRACTICE_EXAM_QUESTION_COUNT questions with chapter weighting.
        - Questions presented one at a time with NO per-question feedback.
        - Records each answer silently.
        - After all questions: LLM generates full chapter-level debrief.
        """
        first_name = state['first_name']
        course_id = lesson_id  # e.g. '2B1'

        # Refresh / review resume: a bare 'hello' with no fresh examConfig and no
        # exam in progress means the page reloaded (or the lobby "Review most
        # recent results" opened) after the in-memory session was lost (e.g. an
        # AI-service restart). Restore the last debrief from the DB instead of
        # starting a brand-new exam. New exams always carry examConfig, so this
        # never hijacks a genuine start.
        if (message.strip().lower() == 'hello'
                and not state.get('_starting_new_exam')
                and not state.get('exam_questions')
                and not state.get('exam_done')):
            db_debrief = researcher.get_last_debrief(user, course_id)
            if db_debrief:
                state['exam_done'] = True
                state['exam_phase'] = 'debrief'
                state['last_debrief'] = db_debrief
                return {
                    'tutor_response': db_debrief.get('tutor_response', ''),
                    'display_update': db_debrief.get('display_update'),
                    'progress_update': {},
                    'complexity_level': state['complexity_level'],
                    'first_name': first_name,
                    'action': None,
                    'mode': 'practice_exam',
                }

        # Load questions on first message
        if not state['exam_questions'] and not state.get('exam_done'):
            weights = researcher.get_chapter_weights(user, course_id)
            count = state.get('exam_question_count', PRACTICE_EXAM_QUESTION_COUNT)
            qs = researcher.get_exam_questions(
                course_id=course_id,
                limit=count,
                weights=weights if weights else None,
            )
            state['exam_questions'] = qs
            state['exam_index'] = 0
            state['exam_results'] = []
            state['exam_phase'] = 'answering'

        questions = state['exam_questions']
        idx = state['exam_index']
        total = len(questions)

        # ---- Debrief phase ----
        if state.get('exam_done') or state.get('exam_phase') == 'debrief':
            if self._is_exam_retry(message):
                return self._reset_and_start_exam(
                    state, user, course_id, first_name, researcher, display
                )
            # Page-refresh / session-resume 'hello': return cached debrief without re-running LLM.
            if message.strip().lower() == 'hello' and state.get('last_debrief'):
                cached = state['last_debrief']
                return {
                    'tutor_response': cached.get('tutor_response', ''),
                    'display_update': cached.get('display_update'),
                    'progress_update': {},
                    'complexity_level': state['complexity_level'],
                    'first_name': first_name,
                    'action': None,
                    'mode': 'practice_exam',
                }
            # First arrival at the debrief (no cached result yet): generate it.
            if not state.get('last_debrief'):
                return self._generate_exam_debrief(
                    state, user, course_id, first_name, researcher, tutor, lesson_context, progress
                )
            # Otherwise the student is asking a follow-up question about their
            # results — answer it as a normal tutoring turn (the debrief prompt
            # invites this), and keep the results panel on screen unchanged.
            return self._answer_exam_followup(
                state, user, course_id, first_name, message,
                researcher, tutor, lesson_context, progress
            )

        # ---- No questions ----
        if not questions:
            return {
                'tutor_response': (
                    f"Sorry {first_name}, I couldn't load exam questions for {course_id} right now. "
                    "Please try again in a moment."
                ),
                'display_update': None,
                'progress_update': {},
                'complexity_level': state['complexity_level'],
                'first_name': first_name,
                'action': None,
                'mode': 'practice_exam',
            }

        # ---- Record answer for previous question ----
        if idx > 0 and not state.get('exam_init_hello'):
            prev_q = questions[idx - 1]
            correct = self._evaluate_mc_answer(message, prev_q['correct_answer'])
            state['exam_results'].append({
                'chapter_id': prev_q['chapter_id'],
                'question_id': prev_q['id'],
                'correct': correct,
                # Objective enrichment — already in memory, needed for debrief
                'lesson_code': prev_q.get('lesson_code', ''),
                'topic': prev_q.get('topic', ''),
                'explanation': prev_q.get('explanation', ''),
            })
            researcher.record_response(
                user_email=user,
                question_id=prev_q['id'],
                session_type='practice_exam',
                course_id=course_id,
                chapter_id=prev_q['chapter_id'],
                correct=correct,
            )

        state['exam_init_hello'] = False

        # ---- Transition to debrief ----
        if idx >= total:
            state['exam_done'] = True
            state['exam_phase'] = 'debrief'
            return self._generate_exam_debrief(
                state, user, course_id, first_name, researcher, tutor, lesson_context, progress
            )

        # ---- Present next question ----
        q = questions[idx]
        display_update = self._build_exam_question_display(q, idx, total)
        state['exam_index'] = idx + 1

        if idx == 0:
            state['exam_init_hello'] = True  # Don't record the hello as an answer
            intro = (
                f"Welcome to your {course_id} Practice Exam, {first_name}! "
                f"You'll get **{total} questions** from across all chapters. "
                f"Just select your answer for each one — I'll save the feedback for the end "
                f"so you can work through it at exam pace. Let's begin."
            )
        else:
            intro = ''  # No commentary between questions in exam mode

        return {
            'tutor_response': intro if intro else None,
            'display_update': display_update,
            'progress_update': {},
            'complexity_level': state['complexity_level'],
            'first_name': first_name,
            'action': None,
            'mode': 'practice_exam',
            'exam_progress': {'current': idx + 1, 'total': total},
        }

    def _build_exam_question_display(self, q, idx, total):
        options = q.get('options', [])
        formatted = [{'label': chr(65 + i), 'text': opt} for i, opt in enumerate(options)]
        return {
            'type': 'exam_question',
            'title': f'Question {idx + 1} of {total}',
            'question': q.get('question_text', ''),
            'options': formatted,
            'topic': q.get('topic', ''),
            'chapter_id': q.get('chapter_id', ''),
            'question_id': q['id'],
            'progress': {'current': idx + 1, 'total': total},
        }

    def _parse_lesson_code(self, lesson_code, fallback_chapter_id=''):
        """
        Parse '2B1-3-2' → ('3', '2').  Returns ('?', '?') if unparseable.
        Falls back to chapter_id suffix if lesson_code is empty.
        """
        parts = lesson_code.split('-') if lesson_code else []
        if len(parts) == 3:
            return parts[1], parts[2]
        # Fallback: derive chapter number from chapter_id tail
        fb_parts = fallback_chapter_id.split('-') if fallback_chapter_id else []
        chap = fb_parts[-1] if len(fb_parts) >= 2 else '?'
        return chap, '?'

    def _group_wrong_by_objective(self, results):
        """
        Group wrong answers by objective key (lesson_code, or chapter_id as fallback).
        Returns {key: {lesson_code, chapter_id, topic, explanation, count}}
        """
        by_objective = {}
        for r in results:
            if r['correct']:
                continue
            key = r.get('lesson_code') or r.get('chapter_id', 'unknown')
            if key not in by_objective:
                by_objective[key] = {
                    'lesson_code': r.get('lesson_code', ''),
                    'chapter_id': r.get('chapter_id', ''),
                    'topic': r.get('topic', ''),
                    'explanation': r.get('explanation', ''),
                    'count': 0,
                }
            by_objective[key]['count'] += 1
            # Keep first non-empty explanation
            if not by_objective[key]['explanation'] and r.get('explanation'):
                by_objective[key]['explanation'] = r['explanation']
        return by_objective

    def _call_llm_for_teaching_tips(self, prompt, expected_count):
        """
        Single batched LLM call that returns teaching tips for all missed objectives.
        Returns dict {1: 'tip text', 2: 'tip text', ...}.
        Falls back to empty dict on any error.
        """
        if not self._api_key or expected_count == 0:
            return {}
        try:
            session = requests.Session()
            session.headers.update({
                'Authorization': f'Bearer {self._api_key}',
                'Content-Type': 'application/json',
            })
            response = session.post(
                f'{self._base_url}/chat/completions',
                json={
                    'model': self._model,
                    'max_tokens': max(150, 100 * expected_count),
                    'messages': [
                        {
                            'role': 'system',
                            'content': 'You are an expert 2nd Class Power Engineering instructor.',
                        },
                        {'role': 'user', 'content': prompt},
                    ],
                },
                timeout=30,
            )
            response.raise_for_status()
            content = response.json()['choices'][0]['message']['content'].strip()

            # Parse numbered list: "1. tip\n\n2. tip"
            tips = {}
            pattern = re.compile(
                r'^\s*(\d+)\.\s+(.+?)(?=^\s*\d+\.|\Z)',
                re.MULTILINE | re.DOTALL,
            )
            for m in pattern.finditer(content):
                tips[int(m.group(1))] = m.group(2).strip()
            return tips

        except Exception as e:
            print(f'Orchestrator._call_llm_for_teaching_tips error: {e}')
            return {}

    def _compute_chapter_allocations(self, chapters, total, weights):
        """
        Distribute `total` questions across chapters.
        Chapters with lower accuracy get more questions.
        Returns { chapter_id: count }
        """
        if not weights:
            base = total // len(chapters)
            remainder = total % len(chapters)
            alloc = {c: base for c in chapters}
            for i, c in enumerate(chapters):
                if i < remainder:
                    alloc[c] += 1
            return alloc

        raw_weights = {}
        for c in chapters:
            if c in weights:
                raw_weights[c] = 1.0 - weights[c]['accuracy']
            else:
                raw_weights[c] = 0.5

        total_weight = sum(raw_weights.values())
        if total_weight == 0:
            total_weight = 1.0

        # Guaranteeing 1 question per chapter only makes sense when there are
        # enough requested questions to cover every chapter — 2nd/3rd Class
        # papers always had fewer chapters than the smallest exam-count
        # option (25), so this was never exercised. 4th Class papers have
        # 55-56 chapters: with the floor forced to 1 regardless of `total`,
        # a 25- or 50-question exam always came out as 55/56 questions
        # instead, silently ignoring the student's chosen count. When there
        # are more chapters than requested questions, drop the floor to 0 so
        # the weighted distribution (favoring low-accuracy chapters) can
        # actually add up to `total`.
        min_per_chapter = 1 if total >= len(chapters) else 0
        reserved = min_per_chapter * len(chapters)
        distributable = max(0, total - reserved)

        alloc = {c: min_per_chapter for c in chapters}
        for c in chapters:
            extra = round(distributable * raw_weights[c] / total_weight)
            alloc[c] += extra

        current_total = sum(alloc.values())
        diff = total - current_total
        if diff != 0:
            sorted_chapters = sorted(chapters, key=lambda c: raw_weights[c], reverse=True)
            for c in sorted_chapters:
                if diff == 0:
                    break
                if diff > 0:
                    alloc[c] += 1
                    diff -= 1
                elif diff < 0 and alloc[c] > min_per_chapter:
                    alloc[c] -= 1
                    diff += 1

        return alloc

    def _generate_exam_debrief(self, state, user, course_id, first_name,
                                researcher, tutor, lesson_context, progress):
        """Generate the end-of-exam debrief with objective-level teaching tips."""
        results = state.get('exam_results', [])
        if not results:
            return {
                'tutor_response': f"Exam complete, {first_name}! No results to summarize.",
                'display_update': {'type': 'exam_done'},
                'progress_update': {},
                'complexity_level': state['complexity_level'],
                'first_name': first_name,
                'action': None,
                'mode': 'practice_exam',
            }

        # --- Enrich any wrong answers missing lesson_code (edge case fallback) ---
        wrong_missing = [
            r['question_id'] for r in results
            if not r['correct'] and not r.get('lesson_code')
        ]
        if wrong_missing:
            enrichment = researcher.get_questions_by_ids(wrong_missing)
            for r in results:
                if not r['correct'] and not r.get('lesson_code') and r['question_id'] in enrichment:
                    r.update(enrichment[r['question_id']])

        is_fourth_class = course_id in FOURTH_CLASS_COURSES

        # --- Group wrong answers by objective ---
        by_objective = self._group_wrong_by_objective(results)

        # --- Generate teaching tips via single batched LLM call ---
        # Skipped for 4th Class: no generated or templated prose of any kind (see
        # docs/superpowers/specs/2026-07-13-fourth-class-platform-integration-design.md §6) —
        # those students are already in a real accredited program elsewhere and are
        # understood to want the score breakdown, not FSA-authored explanations.
        objective_breakdowns = []
        if by_objective and not is_fourth_class:
            objectives_list = list(by_objective.values())
            numbered_lines = []
            for i, obj in enumerate(objectives_list, 1):
                chap_num, obj_num = self._parse_lesson_code(obj['lesson_code'], obj['chapter_id'])
                topic_label = obj['topic'].replace('_', ' ') if obj['topic'] else 'general concept'
                explanation = obj['explanation'] or 'No additional context available.'
                numbered_lines.append(
                    f"{i}. Chapter {chap_num} Objective {obj_num} (topic: {topic_label})\n"
                    f"   Explanation: {explanation}"
                )

            batch_prompt = (
                f"A student studying for the 2nd Class Power Engineering exam missed questions "
                f"on the following objectives. For each, write a 2-3 sentence teaching tip "
                f"that identifies what the student needs to remember or watch for — concrete "
                f"guidance specific to power engineering that helps them get it right next time. "
                f"Format your response as a numbered list matching the objective numbers.\n\n"
                + '\n\n'.join(numbered_lines)
            )
            tips = self._call_llm_for_teaching_tips(batch_prompt, len(objectives_list))

            for i, obj in enumerate(objectives_list):
                chap_num, obj_num = self._parse_lesson_code(obj['lesson_code'], obj['chapter_id'])
                topic_label = obj['topic'].replace('_', ' ') if obj['topic'] else 'general concept'
                objective_breakdowns.append({
                    'lesson_code': obj['lesson_code'],
                    'chapter_id': obj['chapter_id'],
                    'chapter_num': chap_num,
                    'objective_num': obj_num,
                    'topic': topic_label,
                    'teaching_tip': tips.get(i + 1, obj['explanation'] or ''),
                    'wrong_count': obj['count'],
                })

        # --- Aggregate chapter stats (unchanged for 4th Class — pure SQL, not an LLM feature) ---
        chapter_stats = {}
        for r in results:
            cid = r['chapter_id'] or 'Unknown'
            chapter_stats.setdefault(cid, {'correct': 0, 'total': 0})
            chapter_stats[cid]['total'] += 1
            if r['correct']:
                chapter_stats[cid]['correct'] += 1

        total_q = len(results)
        total_correct = sum(1 for r in results if r['correct'])
        score_pct = int(total_correct / total_q * 100) if total_q else 0

        chapter_lines = []
        weak_chapters, strong_chapters = [], []
        for cid, s in sorted(chapter_stats.items()):
            pct = int(s['correct'] / s['total'] * 100) if s['total'] else 0
            status = 'Strong' if pct >= 70 else ('Needs review' if pct < 50 else 'Developing')
            chapter_lines.append({
                'chapter': cid, 'correct': s['correct'],
                'total': s['total'], 'pct': pct, 'status': status,
            })
            if pct < 60:
                weak_chapters.append(cid)
            elif pct >= 75:
                strong_chapters.append(cid)

        # --- Compute next-attempt allocation (unchanged for 4th Class) ---
        fresh_weights = {
            cid: {'accuracy': s['correct'] / s['total'] if s['total'] else 0.5, 'total': s['total']}
            for cid, s in chapter_stats.items()
        }
        exam_count = state.get('exam_question_count', PRACTICE_EXAM_QUESTION_COUNT)
        all_chapters = list(chapter_stats.keys())
        next_allocation = self._compute_chapter_allocations(all_chapters, exam_count, fresh_weights)

        # --- Build tutor debrief message ---
        # Skipped entirely for 4th Class: no LLM call, no generated or templated prose.
        if is_fourth_class:
            tutor_response = ''
        else:
            missed_obj_mentions = []
            for obj in objective_breakdowns[:3]:
                missed_obj_mentions.append(
                    f"Chapter {obj['chapter_num']} Objective {obj['objective_num']} ({obj['topic']})"
                )
            weak_str = ', '.join(weak_chapters) if weak_chapters else 'none'
            strong_str = ', '.join(strong_chapters) if strong_chapters else 'none'
            missed_str = ', '.join(missed_obj_mentions) if missed_obj_mentions else ''

            if state.get('exam_lead_magnet'):
                debrief_prompt = (
                    f"A prospective student named {first_name} just completed a {total_q}-question "
                    f"practice exam for the {course_id} exam paper.\n"
                    f"Overall: {total_correct}/{total_q} ({score_pct}%)\n"
                    f"Strong chapters: {strong_str}\n"
                    f"Chapters needing review: {weak_str}\n"
                    + (f"Missed objectives: {missed_str}\n" if missed_str else "")
                    + f"\nWrite a warm, encouraging 5-7 sentence response. "
                    f"Address them as {first_name}. "
                    f"Start by acknowledging their score. "
                    f"Highlight their strong chapters if any exist. "
                    f"If they have weak chapters, explain that Full Steam Ahead's practice exams "
                    f"automatically adapt — giving more questions on chapters they struggle with — "
                    f"so they improve faster. "
                    f"End with a genuine, warm invitation: a Full Steam Ahead subscription gives them "
                    f"unlimited adaptive practice exams for all 6 papers, full course content with "
                    f"step-by-step lessons, and AI tutoring for $149/month. "
                    f"Invite them to enroll at https://enrollment.fullsteamahead.ca . "
                    f"Be encouraging and genuine, not pushy."
                )
            else:
                debrief_prompt = (
                    f"The student {first_name} just completed a {total_q}-question practice exam for {course_id}, "
                    f"scoring {total_correct}/{total_q} ({score_pct}%).\n"
                    f"The full score breakdown, per-chapter results, and per-objective teaching notes are ALREADY "
                    f"displayed on screen next to this chat, so do NOT repeat or list them.\n"
                    f"\nKeep your reply very brief — 2 to 3 short sentences total, no more. Do this in order:\n"
                    f"1. Summarize their performance in one short sentence at a high level "
                    f"(e.g. strong work / solid progress / room to grow) WITHOUT naming specific chapters, "
                    f"objectives, scores, or percentages.\n"
                    f"2. Encourage them to review the lessons in the \"Where to focus\" section shown on this page.\n"
                    f"3. Ask if there's anything they'd like explained in more detail.\n"
                    f"Address them as {first_name}. Do NOT list their weak areas or offer another exam."
                )

            debrief_state = {
                'activity': 'exam_debrief',
                'mode': 'practice_exam',
                'complexity_level': state.get('complexity_level', 3),
                'questions_done': total_q,
                'session_limit_reached': False,
                'chat_history': state.get('chat_history', []),
                'relevant_chunks': [],
                'display_is_question': False,
                'awaiting_next_question': False,
                'is_resume': False,
                'no_questions_available': False,
                'first_name': first_name,
                'exam_debrief_prompt': debrief_prompt,
            }

            tutor_result = tutor.respond(
                user_message=debrief_prompt,
                lesson_context={'title': f'{course_id} Practice Exam', 'summary': '', 'key_points': [],
                                'narration_text': '', 'video_transcript': ''},
                progress=progress,
                state=debrief_state,
                first_name=first_name,
            )
            tutor_response = tutor_result.get('response', '') if isinstance(tutor_result, dict) else str(tutor_result)

        display_update = {
            'type': 'exam_done',
            'title': f'{course_id} Exam Results',
            'score': total_correct,
            'total': total_q,
            'score_pct': score_pct,
            'chapter_stats': chapter_lines,
            'objective_breakdowns': objective_breakdowns,
            'next_attempt_allocation': next_allocation,
        }
        # Cache so page refreshes can return results without re-running the LLM.
        state['last_debrief'] = {
            'tutor_response': tutor_response,
            'display_update': display_update,
        }
        # Persist durably so the lobby review button and refreshes survive an
        # AI-service restart (in-memory state is lost on every deploy).
        researcher.save_last_debrief(user, course_id, state['last_debrief'])
        return {
            'tutor_response': tutor_response,
            'display_update': display_update,
            'progress_update': {},
            'complexity_level': state['complexity_level'],
            'first_name': first_name,
            'action': None,
            'mode': 'practice_exam',
        }

    def _answer_exam_followup(self, state, user, course_id, first_name, message,
                              researcher, tutor, lesson_context, progress):
        """
        Answer a free-form follow-up question after the exam debrief without
        regenerating the debrief or disturbing the on-screen results panel.
        Returns no display_update so the client keeps showing the results.
        """
        # Search content across the whole course (there's no single active
        # lesson here), and feed it to the tutor as context so it can actually
        # explain topics rather than claim the lesson notes are missing.
        relevant_chunks = researcher.get_course_chunks(
            course_id=course_id, context_hint=message, limit=5,
        )
        combined = '\n\n'.join(
            c.get('body') or c.get('narration') or c.get('source_content') or ''
            for c in relevant_chunks
        ).strip()
        followup_context = {
            'title': f'{course_id} Exam Review',
            'summary': combined[:2000],
            'key_points': [],
            'narration_text': combined,
            'video_transcript': '',
        } if combined else lesson_context
        followup_state = {
            'activity': 'free_discussion',
            'mode': 'practice_exam',
            'complexity_level': state.get('complexity_level', 3),
            'questions_done': state.get('questions_done', 0),
            'session_limit_reached': False,
            'chat_history': state.get('chat_history', []),
            'relevant_chunks': relevant_chunks,
            'display_is_question': False,
            'awaiting_next_question': False,
            'is_resume': False,
            'no_questions_available': False,
            'first_name': first_name,
            'exam_post_debrief': True,
        }
        tutor_result = tutor.respond(
            user_message=message,
            lesson_context=followup_context,
            progress=progress,
            state=followup_state,
            first_name=first_name,
        )
        tutor_response = (tutor_result.get('response', '')
                          if isinstance(tutor_result, dict) else str(tutor_result))
        return {
            'tutor_response': tutor_response,
            'display_update': None,  # keep the results panel as-is
            'progress_update': {},
            'complexity_level': state['complexity_level'],
            'first_name': first_name,
            'action': None,
            'mode': 'practice_exam',
        }

    # ------------------------------------------------------------------
    # Exam retry logic
    # ------------------------------------------------------------------

    def _is_exam_retry(self, message):
        # The "Retake Exam" button sends a bare affirmative. Match only short,
        # clearly-affirmative messages — NOT longer follow-up questions, which
        # the post-debrief chat now routes to the tutor (a question like
        # "can you explain that please?" must not start a new exam).
        msg = message.strip().lower().rstrip('.!?')
        exact = {
            'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'okay sure',
            'yes please', 'again', 'retry', 'retake', 'another', 'one more',
            'go again', "let's go", 'lets go', 'ready', 'start', 'begin',
            'do it', "let's do it", 'retake exam', 'another exam', 'start exam',
            'new exam', 'go',
        }
        if msg in exact:
            return True
        # Very short phrase with a strong retry verb (e.g. "retake please").
        if len(msg.split()) <= 3 and any(
            k in msg for k in ('retake', 'retry', 'another exam', 'go again')
        ):
            return True
        return False

    def _reset_and_start_exam(self, state, user, course_id, first_name, researcher, display):
        weights = researcher.get_chapter_weights(user, course_id)
        count = state.get('exam_question_count', PRACTICE_EXAM_QUESTION_COUNT)
        qs = researcher.get_exam_questions(
            course_id=course_id,
            limit=count,
            weights=weights if weights else None,
        )

        if not qs:
            return {
                'tutor_response': (
                    f"Sorry {first_name}, I couldn't load new exam questions for {course_id} right now. "
                    "Please try again in a moment."
                ),
                'display_update': None,
                'progress_update': {},
                'complexity_level': state.get('complexity_level', 3),
                'first_name': first_name,
                'action': None,
                'mode': 'practice_exam',
            }

        state['exam_questions'] = qs
        state['exam_index'] = 0
        state['exam_results'] = []
        state['exam_phase'] = 'answering'
        state['exam_done'] = False
        state['exam_init_hello'] = True

        display_update = self._build_exam_question_display(qs[0], 0, len(qs))
        state['exam_index'] = 1

        weak_text = ''
        if weights:
            weak_chapters = [cid for cid, w in weights.items() if w['accuracy'] < 0.6]
            if weak_chapters:
                weak_text = (
                    f"This set is weighted toward **{', '.join(sorted(weak_chapters)[:3])}** "
                    f"based on your last attempt. "
                )

        intro = (
            f"Here we go, {first_name}! Fresh {course_id} practice exam — "
            f"{weak_text}"
            f"**{len(qs)} questions**, same deal: pick your answer for each one "
            f"and I'll save the feedback for the end. Good luck!"
        )

        return {
            'tutor_response': intro,
            'display_update': display_update,
            'progress_update': {},
            'complexity_level': state.get('complexity_level', 3),
            'first_name': first_name,
            'action': None,
            'mode': 'practice_exam',
            'exam_progress': {'current': 1, 'total': len(qs)},
        }

    # ------------------------------------------------------------------
    # Demo helpers
    # ------------------------------------------------------------------

    def seed_demo_exam(self, user, lesson_id, researcher):
        """
        Pre-seed orchestrator state for a demo: loads real exam questions and
        marks them with a realistic 38/50 (76%) result pattern so that the very
        next chat message triggers the debrief immediately.

        Call this once via the /agent/demo/exam-debrief endpoint before opening
        the exam URL in the browser.
        """
        state_key = f'{user}:{lesson_id}'
        course_id = lesson_id

        user_info = researcher.get_user_by_email(user)
        first_name = user_info.get('first_name', 'Jordan')

        questions = researcher.get_exam_questions(course_id=course_id, limit=PRACTICE_EXAM_QUESTION_COUNT)
        if not questions:
            return {'ok': False, 'error': f'No questions found for {course_id}'}

        total = len(questions)

        # Build a realistic result set: 76% correct spread across chapters.
        # Mark the last question in each chapter group as incorrect so weak
        # chapters are visible in the debrief table.
        results = []
        chapter_seen = {}
        for i, q in enumerate(questions):
            cid = q.get('chapter_id', 'Unknown')
            chapter_seen[cid] = chapter_seen.get(cid, 0) + 1
            # Mark roughly every 4th question wrong (gives ~75% overall)
            correct = (i % 4 != 3)
            results.append({'chapter_id': cid, 'question_id': q['id'], 'correct': correct})

        self.conversation_state[state_key] = {
            'user': user,
            'lesson_id': lesson_id,
            'mode': 'practice_exam',
            'first_name': first_name,
            'initialized': True,
            'exchange_count': total,
            'complexity_level': 3,
            'activity': 'exam_debrief',
            'chat_history': [],
            'session_limit_reached': False,
            'questions_done': 0,
            'relevant_chunks': [],
            'display_is_question': False,
            'awaiting_next_question': False,
            'is_resume': False,
            'no_questions_available': False,
            # Exam-specific state
            'exam_questions': questions,
            'exam_index': total,
            'exam_results': results,
            'exam_phase': 'debrief',
            'exam_done': True,
            'exam_init_hello': False,
        }

        correct_count = sum(1 for r in results if r['correct'])
        return {'ok': True, 'total': total, 'correct': correct_count, 'state_key': state_key}

    # ------------------------------------------------------------------
    # MC answer evaluation helper
    # ------------------------------------------------------------------

    def _evaluate_mc_answer(self, message, correct_index):
        """
        Returns True if the student's message matches the correct answer index.
        Handles: 'A'/'a', '1'-'4', 'My answer is B', 'option 2', etc.
        """
        msg = message.strip().lower()

        # Direct letter: a b c d
        letter_map = {'a': 0, 'b': 1, 'c': 2, 'd': 3}
        if msg in letter_map:
            return letter_map[msg] == correct_index

        # 'my answer is b' or 'i choose c'
        letter_match = re.search(r'\b([abcd])\b', msg)
        if letter_match:
            return letter_map.get(letter_match.group(1), -1) == correct_index

        # 1-4 number
        num_match = re.search(r'\b([1234])\b', msg)
        if num_match:
            return (int(num_match.group(1)) - 1) == correct_index

        return False

    def _parse_mc_selected_index(self, message):
        """
        Returns the 0-based option index the student's message selected, or
        None if unparseable. Sibling to _evaluate_mc_answer (which only
        returns whether the answer was correct) — this returns WHICH option
        was picked, needed to build a full question-review list.
        """
        msg = message.strip().lower()
        letter_map = {'a': 0, 'b': 1, 'c': 2, 'd': 3}
        if msg in letter_map:
            return letter_map[msg]

        letter_match = re.search(r'\b([abcd])\b', msg)
        if letter_match:
            return letter_map.get(letter_match.group(1))

        num_match = re.search(r'\b([1234])\b', msg)
        if num_match:
            return int(num_match.group(1)) - 1

        return None

    # ------------------------------------------------------------------
    # Intent classification
    # ------------------------------------------------------------------

    def _classify_intent(self, message):
        """
        Classify the student's message intent using a lightweight LLM call.
        Falls back to keyword matching if API is unavailable.
        """
        # Short greetings are always 'other' — never route them to practice
        stripped = message.strip().lower()
        if stripped in ('hello', 'hi', 'hey', 'hiya', 'greetings', 'good morning',
                        'good afternoon', 'good evening', 'howdy'):
            return INTENT_OTHER

        if self._api_key:
            try:
                session = requests.Session()
                session.headers.update({
                    'Authorization': f'Bearer {self._api_key}',
                    'Content-Type': 'application/json',
                })
                response = session.post(
                    f'{self._base_url}/chat/completions',
                    json={
                        'model': self._model,
                        'max_tokens': 10,
                        'messages': [
                            {
                                'role': 'system',
                                'content': (
                                    'Classify this student message with exactly one label: '
                                    'select_practice, select_review, select_discussion, '
                                    'provide_answer, continue, stop, other. '
                                    'Return only the label, nothing else.'
                                ),
                            },
                            {'role': 'user', 'content': message},
                        ],
                    },
                    timeout=5,
                )
                response.raise_for_status()
                label = response.json()['choices'][0]['message']['content'].strip().lower()
                # Validate the label is one we know
                valid = {INTENT_SELECT_PRACTICE, INTENT_SELECT_REVIEW, INTENT_SELECT_DISCUSSION,
                         INTENT_PROVIDE_ANSWER, INTENT_CONTINUE, INTENT_STOP, INTENT_OTHER}
                return label if label in valid else INTENT_OTHER

            except Exception:
                pass  # Fall through to keyword matching

        return self._keyword_classify(message)

    def _keyword_classify(self, message):
        """Keyword-based fallback intent classification."""
        lower = message.lower()

        if any(w in lower for w in ['practice', 'question', 'quiz', 'try', '1']):
            return INTENT_SELECT_PRACTICE
        if any(w in lower for w in ['review', 'concept', 'explain', 'tell me', '3']):
            return INTENT_SELECT_REVIEW
        if any(w in lower for w in ['discuss', 'chat', 'talk', '2']):
            return INTENT_SELECT_DISCUSSION
        if any(w in lower for w in ['stop', 'done', 'finish', 'quit', 'exit', 'next lesson', 'move on']):
            return INTENT_STOP
        if any(w in lower for w in ['next', 'continue', 'yes', 'ok', 'sure', 'ready']):
            return INTENT_CONTINUE

        # If message looks like an answer (single letter, short response)
        stripped = message.strip()
        if stripped.lower() in ('a', 'b', 'c', 'd', '1', '2', '3', '4') or len(stripped) > 5:
            return INTENT_PROVIDE_ANSWER

        return INTENT_OTHER
