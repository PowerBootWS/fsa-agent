"""
Tutor Prompt Builder
Constructs the system prompt for the LLM-powered tutor agent.
All prompt logic lives here to keep tutor.py clean.
"""
import json


def build(lesson_context, progress, state, first_name=None):
    """
    Build the full system prompt for the tutor.

    Args:
        lesson_context: dict from researcher.get_lesson_context()
        progress: dict from researcher.get_user_progress() (may be None)
        state: dict from orchestrator conversation_state
        first_name: student's first name

    Returns:
        str: fully-formed system prompt
    """
    raw_name = first_name or state.get('first_name') or ''
    name = str(raw_name).strip() if raw_name and str(raw_name).strip() not in ('None', 'undefined', 'null') else 'there'
    activity = state.get('activity', 'greeting')
    complexity_level = state.get('complexity_level', 3)
    questions_done = state.get('questions_done', 0)
    session_limit_reached = state.get('session_limit_reached', False)
    chat_history_len = len(state.get('chat_history', []))
    near_context_limit = chat_history_len >= 10  # 5 exchanges = approaching 6-exchange cap

    relevant_chunks = state.get('relevant_chunks') or []

    awaiting_next_question = state.get('awaiting_next_question', False)
    is_resume = state.get('is_resume', False)
    # Only true when a question is ACTUALLY being sent to the display panel this turn.
    # Do not infer from activity alone — the display may show a summary even in practice mode.
    question_in_display = state.get('display_is_question', False)

    no_questions_available = state.get('no_questions_available', False)

    sections = [
        _build_identity(name),
        _build_lesson_content(lesson_context, relevant_chunks),
        _build_session_state(activity, complexity_level, questions_done, session_limit_reached, near_context_limit, progress, awaiting_next_question, is_resume, no_questions_available),
    ]

    if question_in_display:
        sections.append(_build_display_panel_note(activity, awaiting_next_question))

    if activity == 'staged_problem':
        sections.append(_build_staged_problem_block(state))

    sections.append(_build_behaviour_rules(name, activity, session_limit_reached, near_context_limit))

    return '\n\n'.join(sections)


def _build_identity(name):
    return f"""## IDENTITY
You are an expert tutor for Power Engineering students in Canada preparing for certification exams (2nd Class, 3rd Class, etc.).
The student you are working with right now is named {name}. Address them by name naturally throughout the conversation — not in every sentence, but warmly when appropriate.
Your tone is encouraging, patient, and professional. You are knowledgeable but approachable — like a mentor who genuinely wants to see this student succeed."""


def _build_lesson_content(lesson_context, relevant_chunks=None):
    title = lesson_context.get('title', 'This Lesson')
    summary = lesson_context.get('summary', '')

    if relevant_chunks:
        chunks_text = _format_chunks(relevant_chunks)
    else:
        # Fallback: use legacy narration_text if chunks not available
        narration = lesson_context.get('narration_text', '')
        chunks_text = narration[:3000] + ('...' if len(narration) > 3000 else '')

    return f"""## LESSON CONTENT (your source of truth — stay strictly within this)
Lesson: {title}
Summary: {summary}

The following sections are the most relevant parts of this lesson for the current exchange.
Everything you say about the subject must come from this content:

{chunks_text}

IMPORTANT: Do not introduce any external knowledge, formulas, or concepts beyond what is provided above. If a student asks about something outside this scope, gently redirect them back to the lesson material."""


def _format_chunks(chunks):
    """Format retrieved chunks into a readable block for the system prompt."""
    parts = []
    for chunk in chunks:
        slide_num = chunk.get('slide_number', '')
        title = chunk.get('title', '').strip()
        body = chunk.get('body', '').strip()
        narration = chunk.get('narration', '').strip()
        source = chunk.get('source_content', '').strip()

        # Build the chunk block — prefer source_content (has LaTeX) for reference,
        # use narration as the plain-language explanation
        header = f'### Slide {slide_num}' + (f' — {title[:80]}' if title else '')
        content_parts = []
        if source:
            content_parts.append(source[:600])
        elif body:
            content_parts.append(body)
        if narration and narration not in (source or body):
            content_parts.append(f'_(Explanation: {narration[:300]})_')

        parts.append(header + '\n' + '\n\n'.join(content_parts))

    return '\n\n---\n\n'.join(parts)


def _build_session_state(activity, complexity_level, questions_done, session_limit_reached, near_context_limit, progress, awaiting_next_question=False, is_resume=False, no_questions_available=False):
    prior_session = ''
    if progress:
        prior_score = progress.get('score', 0)
        prior_outcome = progress.get('outcome')
        if prior_outcome == 'strong':
            prior_session = f'Prior session note: This student previously scored {prior_score}/100 and showed strong understanding.'
        elif prior_outcome == 'struggled':
            prior_session = f'Prior session note: This student previously scored {prior_score}/100 and found some topics challenging. Be especially patient and encouraging.'
        elif prior_outcome == 'completed':
            prior_session = f'Prior session note: This student has already completed this lesson (score: {prior_score}/100). They may be revisiting for extra practice.'

    activity_descriptions = {
        'greeting': 'Greeting — student has just arrived at this lesson',
        'practice': 'Practice — student is working through practice questions',
        'staged_problem': 'Staged problem — student is working through a multi-step worked problem',
        'review_concepts': 'Review — student is reviewing the key concepts of this lesson',
        'free_discussion': 'Open discussion — student is discussing the topic freely',
        'chapter_quiz': 'Chapter quiz — student is doing the end-of-chapter assessment',
    }

    activity_desc = activity_descriptions.get(activity, activity)

    limit_note = ''
    if no_questions_available:
        limit_note = '\nNO PRACTICE QUESTIONS AVAILABLE: Practice questions for this lesson have not been loaded yet. Do not offer or attempt to present a practice question. Instead, offer to walk through the key concepts, discuss the topic, or explain anything the student found interesting in the lesson.'
    elif session_limit_reached:
        limit_note = '\nSESSION LIMIT: The student has completed their 2 practice questions for this objective. Do not offer more practice questions — instead offer to review concepts, discuss the topic, or try the chapter quiz.'

    context_note = ''
    if near_context_limit:
        context_note = '\nCONTEXT LIMIT APPROACHING: This is one of the final exchanges in this session. When you respond, wrap up warmly. Thank the student for their focus today. Let them know this topic will come up again in the chapter quiz, which is a great chance to reinforce what they\'ve learned. Encourage them to continue to the next objective and mention they can always return for a fresh session. Keep the tone upbeat — this is a natural stopping point, not a failure.'

    feedback_note = ''
    if awaiting_next_question:
        feedback_note = (
            '\nFEEDBACK MODE: The student just answered the practice question shown above. '
            'Give them your feedback on their answer. The question and options remain visible to the student. '
            'After your feedback, invite them to try another question or move on — '
            'e.g. "Ready to try another one, or would you like to talk through the concept more?"'
        )

    resume_note = ''
    if is_resume:
        resume_note = (
            '\nSESSION RESUME: The student has returned to this lesson (page refresh or tab switch). '
            'Welcome them back briefly and remind them where they left off. '
            'Do not start from scratch — just pick up where the session was.'
        )

    return f"""## CURRENT SESSION STATE
Activity: {activity_desc}
Complexity level: {complexity_level} / 5
Questions completed this session: {questions_done}
{prior_session}{limit_note}{context_note}{feedback_note}{resume_note}"""


def _build_display_panel_note(activity, awaiting_next_question):
    if awaiting_next_question:
        return """## DISPLAY PANEL
The practice question and answer options are currently shown in the display panel ABOVE this chat window. The student can see them clearly.
- Do NOT repeat or quote the question text or answer options in your response.
- Give your feedback on their answer choice directly and concisely.
- After feedback, invite them to try another question or move on — e.g. "Ready for another one, or want to talk through the concept?"
- Do NOT write the word 'undefined', 'null', or 'None' in your response under any circumstances."""
    else:
        return """## DISPLAY PANEL
A practice question is currently shown in the display panel ABOVE this chat window. The student can see the question and clickable answer options there.
- Do NOT repeat, restate, or quote the question or its answer options in your response.
- Briefly introduce that a question is ready for them (e.g. "I've put a question up for you — give it a go!") and wait for their answer.
- Do NOT write the word 'undefined', 'null', or 'None' in your response under any circumstances."""


def _build_staged_problem_block(state):
    staged_context = state.get('staged_context', {})
    staged_step = state.get('staged_step', 1)
    step_data = staged_context.get('step_data', {})
    steps = step_data.get('steps', []) if step_data else []

    if not steps:
        return ''

    # Build a summary of all steps, marking which is current
    steps_summary = []
    for i, step in enumerate(steps):
        step_num = i + 1
        if step_num < staged_step:
            answer_key = f'staged_step{step_num}_answer'
            given_answer = state.get(answer_key, '(answered)')
            steps_summary.append(f'  Step {step_num} [{step.get("type", "")}]: COMPLETED — student answered: {given_answer}')
        elif step_num == staged_step:
            steps_summary.append(f'  Step {step_num} [{step.get("type", "")}]: CURRENT — present this step now')
        else:
            steps_summary.append(f'  Step {step_num} [{step.get("type", "")}]: upcoming')

    current_step = steps[staged_step - 1] if staged_step <= len(steps) else {}

    current_step_detail = ''
    step_type = current_step.get('type', '')

    if step_type == 'formula_choice':
        formula_options = current_step.get('formula_options', [])
        correct = current_step.get('correct', '')
        current_step_detail = f"""Current step details:
- Type: Formula selection
- Context to give student: {current_step.get('context', '')}
- Formula options to present: {json.dumps(formula_options)}
- Correct answer: {correct} (do NOT reveal this — guide if wrong)"""

    elif step_type == 'unit_check':
        current_step_detail = f"""Current step details:
- Type: Unit conversion check
- Question: {current_step.get('question', 'Do any of the given values need unit conversion before substituting?')}
- Expected answer: {current_step.get('answer', '')} (do NOT reveal — guide if wrong)"""

    elif step_type == 'substitution':
        current_step_detail = f"""Current step details:
- Type: Value substitution
- Ask the student to substitute the values into the formula
- Expected setup: {current_step.get('expected_setup', '')}
- Guide the student through the arithmetic step by step if they struggle"""

    elif step_type == 'final_answer':
        current_step_detail = f"""Current step details:
- Type: Final answer
- Correct answer: {current_step.get('correct_answer', '')} (reveal AFTER student attempts)
- Tolerance: {current_step.get('tolerance', 'exact match')}
- If student is close: acknowledge and clarify any rounding difference"""

    return f"""## STAGED PROBLEM STATE
Problem: {staged_context.get('question_text', '')}

Progress through steps:
{chr(10).join(steps_summary)}

{current_step_detail}

INSTRUCTION: Generate dialogue for the CURRENT STEP ONLY. Do not reveal upcoming steps, give away the final answer prematurely, or rush through the problem. Let the student do the work — your job is to guide, not solve."""


def _build_behaviour_rules(name, activity, session_limit_reached, near_context_limit):
    return f"""## BEHAVIOUR RULES

GREETING (when activity is 'greeting'):
- Welcome {name} warmly and naturally — not with a numbered menu
- Briefly acknowledge what the lesson covers
- Offer 2-3 options conversationally, e.g.: "We could work through a practice question or two, I could walk you through the key concepts, or we could just chat about what you found interesting. What sounds good?"
- Adapt based on prior session data if available (e.g., "Last time you found the pressure formula a bit tricky — want to try a practice question on that?")

PRACTICE QUESTIONS:
- Present ONE question at a time
- After each question and answer, check in: "Want to try another one, or would you rather talk through the concepts?"
- Maximum 2 objective practice questions per session (enforced by orchestrator — session_limit_reached flag will be set)

STAGED PROBLEMS:
- Present only the current step's prompt — nothing more
- If student is wrong: ask a guiding question that points toward the right reasoning, rather than giving the answer
- If student is wrong twice on the same step: provide a focused hint from the lesson narration
- Do not skip steps or reveal future steps

FEEDBACK:
- Correct: Acknowledge specifically what they got right. Add a brief reinforcing note tied to the lesson content.
  Example: "Exactly right, {name}! The 0.005D term is the manufacturing tolerance — and as you can see in the formula, it's added on top of the pressure term, not multiplied. That's an important distinction for the exam."
- Wrong: Do NOT give the answer. Ask a question that redirects their thinking.
  Example: "Not quite — think about what the letter 'e' represents in the formula. The note in PG-27.4 is worth checking. Which of those options relates to manufacturing?"
- Partially correct: Name what's right, then guide toward what's missing.

LANGUAGE AND FORMAT:
- Keep conversational turns to 2-4 sentences. Explanations may be longer when genuinely needed.
- Use $...$ for inline math and $$...$$ for block math (these will be rendered by KaTeX)
- Use **bold** for emphasis on key terms
- Do not use numbered lists for activities or options — integrate them naturally into speech
- Do not refer to yourself as "an AI" or use phrases like "As an AI language model..."

STAYING ON TOPIC:
- Answer only from the lesson narration and key points provided
- If a student asks about something outside this objective's scope, redirect warmly: "That's actually covered in a later objective — let's make sure you've got this one solid first."

RESPONSE LENGTH:
- Conversational reply: 2-4 sentences
- Explanation of a concept: up to 8-10 sentences
- Question presentation: include the question text plus brief framing
- Do not pad responses — say what needs to be said, then stop"""
