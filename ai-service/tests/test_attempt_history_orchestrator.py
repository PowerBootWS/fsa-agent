"""
Attempt history (plan 2026-11-08-practice-attempt-history, Phase A): every
practice exam and chapter quiz sitting becomes one assessment_attempts row, and
every answer carries its attempt id, its position and a snapshot of the
question exactly as it was rendered.

Driven through Orchestrator.process, the same entry point app.py's /agent
route calls, so the lobby reset path and retries are exercised for real.
"""
import os
import sys
from itertools import count
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.orchestrator import Orchestrator  # noqa: E402

USER = 'student@example.com'


def make_questions(n, course='2A2', chapter=None, start=1000):
    return [
        {
            'id': start + i,
            'question_text': f'Question {start + i}',
            'options': ['w', 'x', 'y', 'z'],
            'correct_answer': i % 4,
            'explanation': f'Why {start + i}',
            'difficulty': 3,
            'topic': f'topic_{i}',
            'question_type': 'chapter_quiz',
            'chapter_id': chapter or f'{course}-{(i % 3) + 1}',
            'course_id': course,
            'lesson_code': f'{chapter or course + "-1"}-{i + 1}',
        }
        for i in range(n)
    ]


def snapshot_of(q):
    return {
        'question_text': q['question_text'],
        'options': q['options'],
        'correct_index': q['correct_answer'],
        'explanation': q['explanation'],
        'lesson_code': q['lesson_code'],
        'topic': q['topic'],
        'chapter_id': q['chapter_id'],
    }


def make_env(questions_per_load):
    """questions_per_load: list of question lists, one per load (start/retry)."""
    o = Orchestrator()
    o._api_key = None  # no LLM calls
    researcher = MagicMock()
    researcher.get_user_by_email.return_value = {'first_name': 'Mason'}
    researcher.get_chapter_weights.return_value = {}
    researcher.get_questions_by_ids.return_value = {}
    researcher.get_relevant_chunks.return_value = []
    loads = iter(questions_per_load)
    researcher.get_exam_questions.side_effect = lambda *a, **k: next(loads)
    researcher.get_chapter_quiz_questions.side_effect = lambda *a, **k: next(loads)
    ids = count(1)
    researcher.start_attempt.side_effect = lambda *a, **k: next(ids)
    tutor = MagicMock()
    tutor.respond.return_value = {'response': 'debrief', 'action': None}
    display = MagicMock()
    return o, researcher, tutor, display


def send(o, researcher, tutor, display, lesson_id, message, exam_config=None):
    return o.process(USER, lesson_id, message, {'title': lesson_id}, {}, tutor,
                     display, researcher, exam_config=exam_config)


def answer_all(o, researcher, tutor, display, lesson_id, qs):
    """Answer every question correctly except the last, which is answered wrong."""
    for i, q in enumerate(qs):
        pick = q['correct_answer'] if i < len(qs) - 1 else (q['correct_answer'] + 1) % 4
        send(o, researcher, tutor, display, lesson_id, f'My answer is {chr(65 + pick)}')


def responses(researcher):
    return [c.kwargs for c in researcher.record_response.call_args_list]


# ---------------------------------------------------------------- practice exam

def run_exam(n=6):
    qs = make_questions(n)
    o, researcher, tutor, display = make_env([qs])
    send(o, researcher, tutor, display, '2A2', 'hello', exam_config={'count': n})
    answer_all(o, researcher, tutor, display, '2A2', qs)
    return o, researcher, tutor, display, qs


def test_exam_opens_one_attempt_for_the_sitting():
    _, researcher, *_ = run_exam(6)
    researcher.start_attempt.assert_called_once()
    args, kwargs = researcher.start_attempt.call_args
    call = dict(zip(['user_email', 'course_id', 'kind'], args), **kwargs)
    assert call['user_email'] == USER
    assert call['course_id'] == '2A2'
    assert call['kind'] == 'practice_exam'
    assert call['question_count'] == 6
    assert call.get('chapter_id') is None


def test_exam_answers_carry_attempt_position_and_rendered_snapshot():
    _, researcher, _, _, qs = run_exam(6)
    rs = responses(researcher)
    assert [r['attempt_id'] for r in rs] == [1] * 6
    assert [r['position'] for r in rs] == [1, 2, 3, 4, 5, 6]
    assert [r['question_snapshot'] for r in rs] == [snapshot_of(q) for q in qs]


def test_exam_debrief_finishes_the_attempt_with_score_and_chapter_stats():
    _, researcher, *_ = run_exam(6)
    researcher.finish_attempt.assert_called_once()
    args, kwargs = researcher.finish_attempt.call_args
    call = dict(zip(['attempt_id', 'score', 'score_pct', 'chapter_stats'], args), **kwargs)
    assert call['attempt_id'] == 1
    assert call['score'] == 5
    assert call['score_pct'] == 83
    # make_questions spreads chapters 1,2,3,1,2,3; only the 6th (2A2-3) is wrong.
    assert call['chapter_stats'] == {
        '2A2-1': {'correct': 2, 'total': 2},
        '2A2-2': {'correct': 2, 'total': 2},
        '2A2-3': {'correct': 1, 'total': 2},
    }


def test_exam_followups_after_debrief_do_not_finish_again():
    o, researcher, tutor, display, _ = run_exam(4)
    send(o, researcher, tutor, display, '2A2', 'hello')
    send(o, researcher, tutor, display, '2A2', 'why did I miss the last one?')
    assert researcher.finish_attempt.call_count == 1


def test_exam_retry_in_chat_is_a_new_attempt():
    first, second = make_questions(3), make_questions(3, start=2000)
    o, researcher, tutor, display = make_env([first, second])
    send(o, researcher, tutor, display, '2A2', 'hello', exam_config={'count': 3})
    answer_all(o, researcher, tutor, display, '2A2', first)
    send(o, researcher, tutor, display, '2A2', 'retake')
    answer_all(o, researcher, tutor, display, '2A2', second)
    rs = responses(researcher)
    assert [r['attempt_id'] for r in rs] == [1, 1, 1, 2, 2, 2]
    assert [r['position'] for r in rs] == [1, 2, 3, 1, 2, 3]
    assert researcher.start_attempt.call_count == 2
    assert [c.args[0] if c.args else c.kwargs['attempt_id']
            for c in researcher.finish_attempt.call_args_list] == [1, 2]


def test_exam_restarted_from_the_lobby_is_a_new_attempt():
    first, second = make_questions(3), make_questions(3, start=2000)
    o, researcher, tutor, display = make_env([first, second])
    send(o, researcher, tutor, display, '2A2', 'hello', exam_config={'count': 3})
    answer_all(o, researcher, tutor, display, '2A2', first)
    send(o, researcher, tutor, display, '2A2', 'hello', exam_config={'count': 3})
    answer_all(o, researcher, tutor, display, '2A2', second)
    assert [r['attempt_id'] for r in responses(researcher)] == [1, 1, 1, 2, 2, 2]


def test_exam_still_runs_when_history_writes_fail():
    qs = make_questions(3)
    o, researcher, tutor, display = make_env([qs])
    researcher.start_attempt.side_effect = None
    researcher.start_attempt.return_value = None  # Researcher returns None on DB error
    send(o, researcher, tutor, display, '2A2', 'hello', exam_config={'count': 3})
    answer_all(o, researcher, tutor, display, '2A2', qs)
    rs = responses(researcher)
    assert len(rs) == 3
    assert all(r['attempt_id'] is None for r in rs)
    assert [r['question_snapshot'] for r in rs] == [snapshot_of(q) for q in qs]


# ---------------------------------------------------------------- chapter quiz

def run_quiz(n=4):
    qs = make_questions(n, course='2B1', chapter='2B1-3')
    o, researcher, tutor, display = make_env([qs])
    send(o, researcher, tutor, display, '2B1-3', 'hello')
    answer_all(o, researcher, tutor, display, '2B1-3', qs)
    return o, researcher, tutor, display, qs


def test_quiz_opens_one_attempt_with_its_chapter():
    _, researcher, *_ = run_quiz(4)
    researcher.start_attempt.assert_called_once()
    args, kwargs = researcher.start_attempt.call_args
    call = dict(zip(['user_email', 'course_id', 'kind'], args), **kwargs)
    assert (call['user_email'], call['course_id'], call['kind']) == (USER, '2B1', 'chapter_quiz')
    assert call['chapter_id'] == '2B1-3'
    assert call['question_count'] == 4


def test_quiz_answers_carry_attempt_position_and_rendered_snapshot():
    _, researcher, _, _, qs = run_quiz(4)
    rs = responses(researcher)
    assert [r['attempt_id'] for r in rs] == [1] * 4
    assert [r['position'] for r in rs] == [1, 2, 3, 4]
    assert [r['question_snapshot'] for r in rs] == [snapshot_of(q) for q in qs]


def test_quiz_finishes_once_even_when_the_debrief_is_resumed():
    o, researcher, tutor, display, _ = run_quiz(4)
    send(o, researcher, tutor, display, '2B1-3', 'hello')
    send(o, researcher, tutor, display, '2B1-3', 'thanks')
    researcher.finish_attempt.assert_called_once()
    args, kwargs = researcher.finish_attempt.call_args
    call = dict(zip(['attempt_id', 'score', 'score_pct', 'chapter_stats'], args), **kwargs)
    assert (call['attempt_id'], call['score'], call['score_pct']) == (1, 3, 75)
    assert call['chapter_stats'] == {'2B1-3': {'correct': 3, 'total': 4}}


def test_quiz_retry_is_a_new_attempt():
    first = make_questions(2, course='2B1', chapter='2B1-3')
    second = make_questions(2, course='2B1', chapter='2B1-3', start=2000)
    o, researcher, tutor, display = make_env([first, second])
    send(o, researcher, tutor, display, '2B1-3', 'hello')
    answer_all(o, researcher, tutor, display, '2B1-3', first)
    send(o, researcher, tutor, display, '2B1-3', 'yes')
    answer_all(o, researcher, tutor, display, '2B1-3', second)
    rs = responses(researcher)
    assert [r['attempt_id'] for r in rs] == [1, 1, 2, 2]
    assert [r['position'] for r in rs] == [1, 2, 1, 2]
    assert researcher.finish_attempt.call_count == 2


# ---------------------------------------------------------------- Phase D: retry wrong

from agents.orchestrator import _detect_mode  # noqa: E402


def make_retry_env(loads):
    """loads: list of (parent, questions) returned by successive get_retry_questions calls."""
    o, researcher, tutor, display = make_env([])
    it = iter(loads)
    researcher.get_retry_questions.side_effect = lambda *a, **k: next(it)
    ids = count(50)
    researcher.start_attempt.side_effect = lambda *a, **k: next(ids)
    return o, researcher, tutor, display


def mixed_questions():
    qs = make_questions(2, course='2B1', chapter='2B1-4', start=3000)
    qs += make_questions(1, course='2B1', chapter='2B1-7', start=3100)
    return qs


EXAM_PARENT = {'id': 7, 'course_id': '2B1', 'chapter_id': None, 'kind': 'practice_exam'}


def test_retry_lesson_ids_are_their_own_mode():
    assert _detect_mode('2B1-R12') == 'retry_wrong'
    assert _detect_mode('4A-R3') == 'retry_wrong'
    assert _detect_mode('2B1-3') == 'chapter_quiz'
    assert _detect_mode('2B1') == 'practice_exam'


def test_retry_serves_the_wrong_questions_of_my_attempt():
    qs = mixed_questions()
    o, researcher, tutor, display = make_retry_env([(EXAM_PARENT, qs)])
    first = send(o, researcher, tutor, display, '2B1-R7', 'hello')
    researcher.get_retry_questions.assert_called_once_with(USER, 7, '2B1')
    assert first['display_update']['question'] == qs[0]['question_text']
    assert 'missed' in first['tutor_response']
    assert first['mode'] == 'chapter_quiz'  # the client runs it on the chapter-quiz screen


def test_retry_records_a_retry_attempt_with_its_parent_and_per_question_chapters():
    qs = mixed_questions()
    o, researcher, tutor, display = make_retry_env([(EXAM_PARENT, qs)])
    send(o, researcher, tutor, display, '2B1-R7', 'hello')
    answer_all(o, researcher, tutor, display, '2B1-R7', qs)  # last one wrong

    args, kwargs = researcher.start_attempt.call_args
    call = dict(zip(['user_email', 'course_id', 'kind'], args), **kwargs)
    assert (call['course_id'], call['kind'], call['parent_attempt_id']) == ('2B1', 'retry_wrong', 7)
    assert call['chapter_id'] is None and call['question_count'] == 3

    rs = responses(researcher)
    assert {r['session_type'] for r in rs} == {'retry_wrong'}
    assert [r['chapter_id'] for r in rs] == ['2B1-4', '2B1-4', '2B1-7']
    assert [r['attempt_id'] for r in rs] == [50, 50, 50]

    args, kwargs = researcher.finish_attempt.call_args
    fin = dict(zip(['attempt_id', 'score', 'score_pct', 'chapter_stats'], args), **kwargs)
    assert (fin['attempt_id'], fin['score'], fin['score_pct']) == (50, 2, 66)
    assert fin['chapter_stats'] == {'2B1-4': {'correct': 2, 'total': 2}, '2B1-7': {'correct': 0, 'total': 1}}


def test_retry_of_a_chapter_quiz_keeps_the_chapter_on_the_attempt():
    parent = {'id': 9, 'course_id': '2B1', 'chapter_id': '2B1-4', 'kind': 'chapter_quiz'}
    qs = make_questions(2, course='2B1', chapter='2B1-4', start=3000)
    o, researcher, tutor, display = make_retry_env([(parent, qs)])
    send(o, researcher, tutor, display, '2B1-R9', 'hello')
    answer_all(o, researcher, tutor, display, '2B1-R9', qs)
    assert researcher.start_attempt.call_args.kwargs['chapter_id'] == '2B1-4'


def test_done_payload_carries_the_attempt_id():
    qs = mixed_questions()
    o, researcher, tutor, display = make_retry_env([(EXAM_PARENT, qs)])
    send(o, researcher, tutor, display, '2B1-R7', 'hello')
    for i, q in enumerate(qs):
        last = send(o, researcher, tutor, display, '2B1-R7', f'My answer is {chr(65 + q["correct_answer"])}')
    assert last['display_update']['type'] == 'quiz_done'
    assert last['display_update']['attempt_id'] == 50


def test_retry_again_serves_what_was_still_wrong_this_time():
    qs = mixed_questions()
    still_wrong = [qs[2]]
    o, researcher, tutor, display = make_retry_env([(EXAM_PARENT, qs), ({**EXAM_PARENT, 'id': 50, 'kind': 'retry_wrong'}, still_wrong)])
    send(o, researcher, tutor, display, '2B1-R7', 'hello')
    answer_all(o, researcher, tutor, display, '2B1-R7', qs)
    again = send(o, researcher, tutor, display, '2B1-R7', 'yes')
    assert researcher.get_retry_questions.call_args_list[1].args == (USER, 50, '2B1')
    assert again['display_update']['question'] == qs[2]['question_text']
    answer_all(o, researcher, tutor, display, '2B1-R7', still_wrong)
    assert researcher.start_attempt.call_args.kwargs['parent_attempt_id'] == 50
    assert [r['attempt_id'] for r in responses(researcher)][-1] == 51


def test_retry_again_when_everything_was_right_says_so():
    qs = make_questions(1, course='2B1', chapter='2B1-4', start=3000)
    o, researcher, tutor, display = make_retry_env([(EXAM_PARENT, qs), ({**EXAM_PARENT, 'id': 50}, [])])
    send(o, researcher, tutor, display, '2B1-R7', 'hello')
    send(o, researcher, tutor, display, '2B1-R7', f'My answer is {chr(65 + qs[0]["correct_answer"])}')
    again = send(o, researcher, tutor, display, '2B1-R7', 'yes')
    assert 'every one' in again['tutor_response']
    assert researcher.start_attempt.call_count == 1


def test_retry_with_nothing_left_offers_a_normal_quiz_instead():
    o, researcher, tutor, display = make_retry_env([(EXAM_PARENT, [])])
    out = send(o, researcher, tutor, display, '2B1-R7', 'hello')
    assert 'replaced' in out['tutor_response']
    researcher.start_attempt.assert_not_called()


def test_retry_of_someone_elses_attempt_gets_nothing():
    o, researcher, tutor, display = make_retry_env([(None, [])])
    out = send(o, researcher, tutor, display, '2B1-R7', 'hello')
    assert out['display_update'] is None
    researcher.start_attempt.assert_not_called()


def test_chapter_quiz_done_payload_carries_attempt_id():
    o, researcher, tutor, display, _ = run_quiz(2)
    done = send(o, researcher, tutor, display, '2B1-3', 'hello')
    assert done['display_update']['type'] == 'quiz_done'
    assert done['display_update']['attempt_id'] == 1


def test_exam_done_payload_carries_attempt_id():
    o, researcher, tutor, display, _ = run_exam(3)
    done = send(o, researcher, tutor, display, '2A2', 'hello')
    assert done['display_update']['type'] == 'exam_done'
    assert done['display_update']['attempt_id'] == 1
