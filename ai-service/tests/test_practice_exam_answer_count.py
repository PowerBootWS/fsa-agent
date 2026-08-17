"""
Regression test for the practice-exam off-by-one (reported 2026-08-11 by a
student who took the free 2A2 exam, confirmed 2026-08-17).

`_process_practice_exam` presented N questions but only ever recorded N-1
answers. The cause was `state['exam_init_hello']`: it was set to True on the
turn that served question 1 (orchestrator.py, "Present next question" block)
and only cleared on the NEXT turn *after* the record check had already run —
so the answer to question 1 was silently discarded on every exam ever taken.
`_reset_and_start_exam` set the same flag, so retries lost their first answer
too.

Live evidence at the time of the fix (question_responses, session_type
'practice_exam'): 100-question exams stored 99 rows, 50-question exams stored
49. The student's own two sittings both stored exactly 99.

`idx > 0` alone is the correct guard: the exam-opening greeting is always the
turn where exam_index is still 0, so it can never be mistaken for an answer.
"""
import sys, os
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.orchestrator import Orchestrator


def make_questions(n):
    return [
        {
            'id': 1000 + i,
            'question_text': f'Question {i + 1}',
            'options': ['w', 'x', 'y', 'z'],
            'correct_answer': i % 4,
            'explanation': '',
            'difficulty': 3,
            'topic': '',
            'question_type': 'objective_practice',
            'chapter_id': f'2A2-{(i % 5) + 1}',
            'course_id': '2A2',
            'lesson_code': '',
        }
        for i in range(n)
    ]


def make_state(count):
    return {
        'user': 'student@example.com',
        'lesson_id': '2A2',
        'first_name': 'Mason',
        'complexity_level': 3,
        'exam_questions': [],
        'exam_index': 0,
        'exam_results': [],
        'exam_phase': 'answering',
        'exam_done': False,
        'exam_question_count': count,
        'exam_timed': False,
        'exam_lead_magnet': True,
        '_starting_new_exam': True,
    }


def run_full_exam(count):
    """Drive a whole exam the way the client does and return (orchestrator, state)."""
    o = Orchestrator.__new__(Orchestrator)
    o._generate_exam_debrief = MagicMock(return_value={'mode': 'practice_exam'})

    researcher = MagicMock()
    researcher.get_chapter_weights.return_value = None
    researcher.get_exam_questions.return_value = make_questions(count)

    state = make_state(count)
    kwargs = dict(
        researcher=researcher,
        display=MagicMock(),
        tutor=MagicMock(),
        lesson_context={},
        progress={},
    )

    # Turn 1: the lobby's opening 'hello' carries examConfig and no answer.
    o._process_practice_exam(state, 'student@example.com', '2A2', 'hello', **kwargs)
    state['_starting_new_exam'] = False

    # Turns 2..N+1: one option click per presented question.
    for i in range(count):
        letter = chr(65 + (i % 4))
        o._process_practice_exam(
            state, 'student@example.com', '2A2', f'My answer is {letter}', **kwargs
        )

    return o, state, researcher


def test_every_presented_question_is_recorded():
    """A 100-question exam must produce 100 results, not 99."""
    _, state, _ = run_full_exam(100)
    assert len(state['exam_results']) == 100


def test_the_first_question_is_not_dropped():
    """The dropped answer was always question 1 — assert it by id."""
    _, state, _ = run_full_exam(25)
    assert state['exam_results'][0]['question_id'] == 1000
    assert [r['question_id'] for r in state['exam_results']] == list(range(1000, 1025))


def test_every_answer_is_persisted_to_question_responses():
    """researcher.record_response backs the DB row count the student's
    chapter breakdown is built from."""
    _, _, researcher = run_full_exam(50)
    assert researcher.record_response.call_count == 50


def test_scoring_matches_the_answers_given():
    """Question 1 was keyed 'A' and answered 'A'; losing it also lost a mark."""
    _, state, _ = run_full_exam(4)
    assert [r['correct'] for r in state['exam_results']] == [True, True, True, True]


def test_retry_exam_also_records_every_answer():
    """_reset_and_start_exam serves question 1 inside the retry turn itself."""
    o = Orchestrator.__new__(Orchestrator)
    o._generate_exam_debrief = MagicMock(return_value={'mode': 'practice_exam'})

    researcher = MagicMock()
    researcher.get_chapter_weights.return_value = None
    researcher.get_exam_questions.return_value = make_questions(25)

    state = make_state(25)
    state.update({
        'exam_questions': make_questions(25),
        'exam_index': 25,
        'exam_results': [],
        'exam_phase': 'debrief',
        'exam_done': True,
        '_starting_new_exam': False,
    })
    kwargs = dict(
        researcher=researcher,
        display=MagicMock(),
        tutor=MagicMock(),
        lesson_context={},
        progress={},
    )

    # 'retry' serves question 1 immediately (exam_index becomes 1).
    o._process_practice_exam(state, 'student@example.com', '2A2', 'retry', **kwargs)
    for i in range(25):
        letter = chr(65 + (i % 4))
        o._process_practice_exam(
            state, 'student@example.com', '2A2', f'My answer is {letter}', **kwargs
        )

    assert len(state['exam_results']) == 25
