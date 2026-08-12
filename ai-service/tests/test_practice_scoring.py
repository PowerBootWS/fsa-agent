"""
Regression tests for the tutor practice-scoring no-op (audit 2026-08-12).

Three linked defects in the objective-practice path:

  1. `_evaluate_practice_answer` never compared the student's answer to the
     question's `correct_answer` — it computed `selected` and threw it away —
     so `state['attempts'][q_id]['correct']` was permanently False. Live DB:
     0 of 112 user_progress rows with attempts had a single `"correct": true`.

  2. `state['score']` was never written after initialisation, so it stayed at
     its default of 100 forever. Live DB: all 172 user_progress rows scored
     100, and `_compute_outcome` therefore returned 'strong' for every student
     who answered at least one question.

  3. Because accuracy was always 0.0, `_adjust_complexity` could only ever take
     the *decrement* branch, driving `complexity_level` down to 1 and holding
     it there. `Researcher.get_questions` filters `difficulty <= max(level, 2)`,
     so the difficulty-3/4 half of the objective_practice bank became
     permanently unreachable. Made worse by `_adjust_complexity` running on
     EVERY message rather than only after an answer, so a few clarifying
     questions after one wrong answer could ratchet the level straight to 1.
"""
import sys, os
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.orchestrator import Orchestrator


def make_orchestrator():
    return Orchestrator.__new__(Orchestrator)


def make_state(**overrides):
    state = {
        'user': 'test@example.com',
        'lesson_id': '2A1-1-1',
        'first_name': 'Jordan',
        'score': 100,
        'struggles': [],
        'attempts': {},
        'complexity_level': 3,
        'activity': 'practice',
        'questions_done': 0,
        'session_limit_reached': False,
        'seen_question_ids': [],
        'current_question_id': 101,
        'current_question_correct_answer': 1,  # option 'b'
    }
    state.update(overrides)
    return state


# ----------------------------------------------------------------------
# 1. The answer is actually compared to the correct option
# ----------------------------------------------------------------------

def test_correct_answer_is_recorded_as_correct():
    o = make_orchestrator()
    state = make_state()
    o._evaluate_practice_answer(state, 'b', {})
    assert state['attempts']['101']['correct'] is True


def test_wrong_answer_is_recorded_as_incorrect():
    o = make_orchestrator()
    state = make_state()
    o._evaluate_practice_answer(state, 'd', {})
    assert state['attempts']['101']['correct'] is False


def test_natural_language_answer_is_parsed():
    o = make_orchestrator()
    state = make_state()
    o._evaluate_practice_answer(state, 'I think the answer is B', {})
    assert state['attempts']['101']['correct'] is True


def test_correct_flag_is_not_downgraded_by_a_later_wrong_retry():
    """Once a question has been answered correctly it stays correct."""
    o = make_orchestrator()
    state = make_state()
    o._evaluate_practice_answer(state, 'b', {})
    o._evaluate_practice_answer(state, 'a', {})
    assert state['attempts']['101']['correct'] is True


# ----------------------------------------------------------------------
# 2. The question's correct answer is carried in state at load time
# ----------------------------------------------------------------------

def test_load_next_question_stashes_the_correct_answer():
    o = make_orchestrator()
    state = make_state(current_question_id=None, current_question_correct_answer=None)
    researcher = MagicMock()
    researcher.get_questions.return_value = [{
        'id': 202, 'question_text': 'Q', 'options': ['w', 'x', 'y', 'z'],
        'correct_answer': 2, 'explanation': '', 'difficulty': 4,
        'topic': '', 'question_type': 'objective_practice', 'step_data': None,
    }]
    display = MagicMock()

    o._load_next_question(state, {}, researcher, display)

    assert state['current_question_id'] == 202
    assert state['current_question_correct_answer'] == 2


# ----------------------------------------------------------------------
# 3. Score discriminates instead of sitting at 100
# ----------------------------------------------------------------------

def test_score_drops_when_the_student_answers_wrong():
    o = make_orchestrator()
    state = make_state()
    o._evaluate_practice_answer(state, 'a', {})   # wrong
    o._update_score(state, 'a', {})
    assert state['score'] < 100


def test_score_is_the_share_of_questions_answered_correctly():
    o = make_orchestrator()
    state = make_state()
    o._evaluate_practice_answer(state, 'b', {})   # q101 correct
    state['current_question_id'] = 102
    state['current_question_correct_answer'] = 0
    o._evaluate_practice_answer(state, 'c', {})   # q102 wrong
    o._update_score(state, 'c', {})
    assert state['score'] == 50


def test_score_stays_100_before_any_answer():
    o = make_orchestrator()
    state = make_state()
    o._update_score(state, 'hello', {})
    assert state['score'] == 100


# ----------------------------------------------------------------------
# 4. Outcome is no longer uniformly 'strong'
# ----------------------------------------------------------------------

def test_outcome_is_struggled_for_a_student_getting_everything_wrong():
    o = make_orchestrator()
    state = make_state()
    for qid, ca in ((101, 1), (102, 0), (103, 3)):
        state['current_question_id'] = qid
        state['current_question_correct_answer'] = ca
        o._evaluate_practice_answer(state, 'c' if ca != 2 else 'a', {})
    o._update_score(state, 'c', {})
    assert o._compute_outcome(state) == 'struggled'


def test_outcome_is_strong_only_for_a_student_who_actually_scores_well():
    o = make_orchestrator()
    state = make_state()
    for qid, ca in ((101, 1), (102, 1), (103, 1)):
        state['current_question_id'] = qid
        state['current_question_correct_answer'] = ca
        o._evaluate_practice_answer(state, 'b', {})
    o._update_score(state, 'b', {})
    assert o._compute_outcome(state) == 'strong'


# ----------------------------------------------------------------------
# 5. Complexity can rise again → the whole question bank is reachable
# ----------------------------------------------------------------------

def test_complexity_rises_for_a_student_answering_correctly():
    o = make_orchestrator()
    state = make_state(complexity_level=3)
    for qid in (101, 102, 103):
        state['current_question_id'] = qid
        state['current_question_correct_answer'] = 1
        o._evaluate_practice_answer(state, 'b', {})
        o._adjust_complexity(state)
    assert state['complexity_level'] > 3


def test_complexity_can_reach_the_top_of_the_bank():
    """difficulty-4 and difficulty-5 questions must become reachable."""
    o = make_orchestrator()
    state = make_state(complexity_level=3)
    for qid in range(101, 111):
        state['current_question_id'] = qid
        state['current_question_correct_answer'] = 1
        o._evaluate_practice_answer(state, 'b', {})
        o._adjust_complexity(state)
    assert state['complexity_level'] == 5


def test_complexity_falls_for_a_student_answering_wrong():
    o = make_orchestrator()
    state = make_state(complexity_level=3)
    for qid in (101, 102, 103):
        state['current_question_id'] = qid
        state['current_question_correct_answer'] = 1
        o._evaluate_practice_answer(state, 'a', {})
        o._adjust_complexity(state)
    assert state['complexity_level'] < 3


def test_complexity_only_moves_when_an_answer_was_evaluated():
    """
    _adjust_complexity runs on every message. Chatting after an answer must not
    ratchet the level — that is what pinned every live student at 1 or 2.
    """
    o = make_orchestrator()
    state = make_state(complexity_level=3)
    state['current_question_correct_answer'] = 1
    o._evaluate_practice_answer(state, 'a', {})  # one wrong answer
    o._adjust_complexity(state)
    after_answer = state['complexity_level']

    for _ in range(5):                            # five follow-up chat turns
        o._adjust_complexity(state)

    assert state['complexity_level'] == after_answer
