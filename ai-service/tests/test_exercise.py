"""Quick exercise (lesson tutor redesign, slice 5)."""
import sys, os
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents import exercise, tutor_prompt
from tests.test_lesson_grounding_and_memory import make_researcher_mock, fresh_orchestrator

REPLY = r"""Nice start. Here's your first one.

[QUESTION]
Q: Which arrangement do nuclear plants of 800 to 1300 MW
standardize on?
A) Two-casing tandem compound
B) Three-casing tandem compound
C) Four-casing tandem compound
D) Four-casing cross compound, with $\frac{1}{2}$ the flow per shaft
ANSWER: D
WHY: Slide 22 says nuclear plants standardized on the four casing cross compound arrangement.
[/QUESTION]"""

EX = {'from_slide': 19, 'after_slide': 22, 'asked': 0, 'correct': 0}


def test_parse_reply_splits_message_and_question():
    message, q = exercise.parse_reply(REPLY)
    assert message == "Nice start. Here's your first one."
    assert q['question_text'] == 'Which arrangement do nuclear plants of 800 to 1300 MW standardize on?'
    assert q['options'][3].endswith(r'$\frac{1}{2}$ the flow per shaft')  # LaTeX survives
    assert q['correct_answer'] == 3
    assert 'Slide 22' in q['explanation']


def test_malformed_blocks_give_no_card():
    no_answer = REPLY.replace('ANSWER: D\n', '')
    three_options = REPLY.replace('C) Four-casing tandem compound\n', '')
    for text in (no_answer, three_options):
        message, q = exercise.parse_reply(text)
        assert q is None and message.startswith('Nice start')
    assert exercise.parse_reply('Just chatting.') == ('Just chatting.', None)


def test_sanitize_drops_bad_state():
    assert exercise.sanitize(None) is None
    assert exercise.sanitize({'from_slide': 5, 'after_slide': 2}) is None
    out = exercise.sanitize({**EX, 'last': {'question_text': 'Q', 'options': ['a', 'b', 'c'], 'correct_index': 1, 'selected_index': 0}})
    assert out['last'] is None  # three options is not a valid last question
    ok = exercise.sanitize({**EX, 'asked': 1, 'last': {'question_text': 'Q', 'options': ['a', 'b', 'c', 'd'], 'correct_index': 1, 'selected_index': 0}})
    assert ok['last']['selected_index'] == 0


def test_prompt_states_the_graded_pick_and_the_final_turn():
    ex = exercise.sanitize({**EX, 'asked': 4, 'correct': 3, 'last': {
        'question_text': 'Which?', 'options': ['a', 'b', 'c', 'd'], 'correct_index': 1, 'selected_index': 2}})
    prompt = tutor_prompt.build({'title': 'T'}, None, {'mode': 'lesson', 'activity': 'free_discussion', 'exercise': ex}, 'K')
    assert 'They picked C. That is INCORRECT. The keyed answer is B.' in prompt
    assert 'Do NOT include a question block' in prompt
    assert 'slides 19 to 22' in prompt


def test_a_graded_miss_must_state_the_right_answer_on_every_turn():
    # Mid-exercise and final turn both: no hint-only replies, no blanket "close".
    for asked in (2, 4):
        ex = exercise.sanitize({**EX, 'asked': asked, 'correct': 1, 'last': {
            'question_text': 'Which?', 'options': ['a', 'b', 'c', 'd'], 'correct_index': 1, 'selected_index': 2}})
        prompt = tutor_prompt.build({'title': 'T'}, None, {'mode': 'lesson', 'activity': 'free_discussion', 'exercise': ex}, 'K')
        assert 'say which option is correct' in prompt
        assert 'Do not answer a miss with only a hint' in prompt
        assert 'when it really is close' in prompt


def _run(orch, researcher, reply, ex):
    tutor = MagicMock()

    def respond(user_message, lesson_context, progress, state, first_name=None):
        state.setdefault('chat_history', []).extend([{'role': 'user', 'content': user_message}, {'role': 'assistant', 'content': reply}])
        state.setdefault('full_transcript', []).extend([{'role': 'user', 'content': user_message}, {'role': 'assistant', 'content': reply}])
        return {'response': reply}
    tutor.respond.side_effect = respond
    return orch.process(user='k@example.com', lesson_id='2B1-1-1', message='go', lesson_context={'title': 'T'},
                        progress=None, tutor=tutor, display=MagicMock(), researcher=researcher,
                        slide_number=23, exercise=ex)


def test_lesson_turn_returns_the_card_and_saves_readable_text():
    r = make_researcher_mock()
    out = _run(fresh_orchestrator(), r, REPLY, EX)
    assert out['exercise_question']['correct_answer'] == 3
    assert out['tutor_response'] == "Nice start. Here's your first one."
    assert not out['exercise_done']
    saved = r.save_chat_history.call_args.kwargs['messages'][-1]['content']
    assert '[QUESTION]' not in saved and 'D) Four-casing cross compound' in saved


def test_final_answer_ends_the_exercise_even_if_the_model_adds_a_question():
    last = {'question_text': 'Q', 'options': ['a', 'b', 'c', 'd'], 'correct_index': 3, 'selected_index': 3}
    out = _run(fresh_orchestrator(), make_researcher_mock(), REPLY, {**EX, 'asked': 4, 'correct': 4, 'last': last})
    assert out['exercise_done'] is True
    assert out['exercise_question'] is None


def test_plain_chat_turns_are_untouched():
    out = _run(fresh_orchestrator(), make_researcher_mock(), REPLY, None)
    assert out['exercise_question'] is None
    assert '[QUESTION]' in out['tutor_response']


def test_a_prose_copy_of_the_question_is_dropped_from_the_message():
    # Real Nov 2026 shape: the model wrote the question in prose too, once with
    # options that differed from the card's.
    prose = ("That's the spirit! Here's the next one.\n\n"
             "If a force of 150 N moves equipment 4 m, what is the work done?\n"
             "A) 150 J\nB) 300 J\nC) 600 J\nD) 600 kJ\n\n")
    message, q = exercise.parse_reply(prose + REPLY.split('\n\n', 1)[1])
    assert q is not None
    assert message == "That's the spirit! Here's the next one."
    # A message that merely mentions an option letter is left alone.
    message, _ = exercise.parse_reply('Not quite. A) was the trap here.\n\n' + REPLY.split('\n\n', 1)[1])
    assert message == 'Not quite. A) was the trap here.'


def test_questions_from_earlier_rounds_reach_the_prompt():
    transcript = [
        {'role': 'user', 'content': 'go'},
        {'role': 'assistant', 'content': exercise.as_text('First one.', {
            'question_text': 'What temperature window suits SNCR?', 'options': ['a', 'b', 'c', 'd']})},
        {'role': 'assistant', 'content': exercise.as_text('', {
            'question_text': 'What temperature window suits SNCR?', 'options': ['a', 'b', 'c', 'd']})},
        {'role': 'assistant', 'content': 'Plain chat with no question.'},
    ]
    assert exercise.asked_before(transcript) == ['What temperature window suits SNCR?']
    ex = exercise.sanitize({**EX, 'asked': 1})
    ex['asked_before'] = exercise.asked_before(transcript)
    prompt = tutor_prompt.build({'title': 'T'}, None, {'mode': 'lesson', 'activity': 'free_discussion', 'exercise': ex}, 'K')
    assert 'Do NOT ask any of these again' in prompt
    assert '- What temperature window suits SNCR?' in prompt


def test_orchestrator_feeds_the_saved_transcript_into_the_exercise():
    orch = fresh_orchestrator()
    r = make_researcher_mock()
    seen = {}
    tutor = MagicMock()

    def respond(user_message, lesson_context, progress, state, first_name=None):
        seen['before'] = list(state['exercise'].get('asked_before', []))
        return {'response': REPLY}
    tutor.respond.side_effect = respond
    # Earlier rounds live only in the restored transcript, beyond the history window.
    r.get_chat_history.return_value = [
        {'role': 'assistant', 'content': 'Ok.\n\nOld round-one question?\nA) a\nB) b\nC) c\nD) d'}]
    orch.process(user='k@example.com', lesson_id='2B1-1-1', message='go', lesson_context={'title': 'T'},
                 progress=None, tutor=tutor, display=MagicMock(), researcher=r, slide_number=23, exercise=EX)
    assert seen['before'] == ['Old round-one question?']
