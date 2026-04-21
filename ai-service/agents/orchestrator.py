"""
Orchestrator - Central coordinator for the multi-agent system.
Manages conversation state, routes activity flow, persists progress to DB.
"""
import os
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
CONTEXT_LIMIT_EXCHANGES = 6
MAX_QUESTIONS_PER_OBJECTIVE = 2
PROGRESS_SAVE_INTERVAL = 3  # save progress every N exchanges as a heartbeat


class Orchestrator:
    def __init__(self):
        self.conversation_state = {}
        self._api_key = os.getenv('OPENROUTER_API_KEY')
        self._model = os.getenv('OPENROUTER_MODEL', 'anthropic/claude-sonnet-4-6-20250515')
        self._base_url = 'https://openrouter.ai/api/v1'

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def process(self, user, lesson_id, message, lesson_context, progress,
                tutor, display, researcher):
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

        # Initialize state for new sessions
        if state_key not in self.conversation_state:
            user_info = researcher.get_user_by_email(user)
            first_name = user_info.get('first_name', 'there')
            complexity = progress.get('complexity_level', 3) if progress else 3

            self.conversation_state[state_key] = {
                'user': user,
                'lesson_id': lesson_id,
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
            }

        state = self.conversation_state[state_key]
        first_name = state['first_name']
        state['exchange_count'] = state.get('exchange_count', 0) + 1

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
                intent = self._classify_intent(message)

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
            intent = self._classify_intent(message)

            if intent == INTENT_STOP:
                state['activity'] = 'greeting'
            else:
                display_update = self._advance_staged_problem(
                    state, message, lesson_context, researcher, display
                )

        elif activity == 'review_concepts':
            intent = self._classify_intent(message)

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
            intent = self._classify_intent(message)
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
