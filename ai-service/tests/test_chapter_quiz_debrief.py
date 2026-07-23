import sys, os
from unittest.mock import MagicMock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.orchestrator import Orchestrator, CHAPTER_QUIZ_QUESTION_COUNT


def make_quiz_state(questions, index, correct=0):
    return {
        'user': 'student@example.com',
        'lesson_id': '4A-1',
        'mode': 'chapter_quiz',
        'first_name': 'Jordan',
        'complexity_level': 3,
        'chat_history': [],
        'quiz_questions': questions,
        'quiz_index': index,
        'quiz_correct': correct,
        'quiz_awaiting_feedback': False,
        'quiz_current_correct_answer': None,
        'quiz_done': False,
    }


def two_question_bank():
    return [
        {'id': 1, 'question_text': 'Q1', 'options': ['A', 'B', 'C', 'D'],
         'correct_answer': 0, 'explanation': 'Because A.', 'topic': 'friction', 'difficulty': 3},
        {'id': 2, 'question_text': 'Q2', 'options': ['W', 'X', 'Y', 'Z'],
         'correct_answer': 2, 'explanation': 'Because Y.', 'topic': 'pressure', 'difficulty': 3},
    ]


def test_last_question_returns_full_debrief_immediately_no_second_round_trip():
    """Regression test for the dead end: answering the last question must
    return type='quiz_done' with a real score directly, not a placeholder
    requiring a second message.

    Note: answers are always sent as a letter ("My answer is C"), never the
    option's text — the frontend always sends `My answer is ${opt.label}`
    where label is A/B/C/D (see _build_quiz_question_display), and
    _evaluate_mc_answer/_parse_mc_selected_index only recognize a/b/c/d and
    1-4, not arbitrary option text. Q2's correct_answer is index 2 → letter C.
    """
    orch = Orchestrator()
    questions = two_question_bank()
    state = make_quiz_state(questions, index=2)
    state['quiz_awaiting_feedback'] = True
    state['quiz_current_correct_answer'] = 2  # correct answer to Q2 (index 2, already answered Q1)
    state['quiz_correct'] = 1

    mock_researcher = MagicMock()
    mock_display = MagicMock()

    result = orch._process_chapter_quiz(state, 'student@example.com', '4A-1', 'My answer is C', mock_researcher, mock_display)

    assert result['display_update']['type'] == 'quiz_done'
    assert result['display_update']['score'] == 2
    assert result['display_update']['total'] == 2
    assert state['quiz_done'] is True


def test_debrief_includes_full_question_review():
    orch = Orchestrator()
    questions = two_question_bank()
    state = make_quiz_state(questions, index=2)
    state['quiz_done'] = True
    state['quiz_correct'] = 1
    state['quiz_review'] = [
        {'question_text': 'Q1', 'options': ['A', 'B', 'C', 'D'], 'correct_index': 0,
         'selected_index': 1, 'correct': False, 'explanation': 'Because A.'},
        {'question_text': 'Q2', 'options': ['W', 'X', 'Y', 'Z'], 'correct_index': 2,
         'selected_index': 2, 'correct': True, 'explanation': 'Because Y.'},
    ]

    mock_researcher = MagicMock()
    mock_display = MagicMock()

    result = orch._process_chapter_quiz(state, 'student@example.com', '4A-1', 'hello', mock_researcher, mock_display)

    review = result['display_update']['question_review']
    assert len(review) == 2
    assert review[0] == {'question_text': 'Q1', 'options': ['A', 'B', 'C', 'D'], 'correct_index': 0,
                          'selected_index': 1, 'correct': False, 'explanation': 'Because A.'}


def test_answering_a_question_appends_to_quiz_review_with_selected_index():
    orch = Orchestrator()
    questions = two_question_bank()
    state = make_quiz_state(questions, index=1)
    state['quiz_awaiting_feedback'] = True
    state['quiz_current_correct_answer'] = 0  # Q1's correct answer

    mock_researcher = MagicMock()
    mock_researcher.record_response.return_value = None
    mock_display = MagicMock()

    orch._process_chapter_quiz(state, 'student@example.com', '4A-1', 'My answer is B', mock_researcher, mock_display)

    assert state['quiz_review'] == [
        {'question_text': 'Q1', 'options': ['A', 'B', 'C', 'D'], 'correct_index': 0,
         'selected_index': 1, 'correct': False, 'explanation': 'Because A.'},
    ]


def test_retry_after_quiz_done_loads_a_fresh_set_and_resets_review():
    orch = Orchestrator()
    questions = two_question_bank()
    state = make_quiz_state(questions, index=2)
    state['quiz_done'] = True
    state['quiz_correct'] = 2
    state['quiz_review'] = [{'question_text': 'stale', 'options': [], 'correct_index': 0,
                              'selected_index': 0, 'correct': True, 'explanation': ''}]

    mock_researcher = MagicMock()
    fresh_questions = two_question_bank()
    mock_researcher.get_chapter_quiz_questions.return_value = fresh_questions
    mock_display = MagicMock()

    result = orch._process_chapter_quiz(state, 'student@example.com', '4A-1', 'yes', mock_researcher, mock_display)

    mock_researcher.get_chapter_quiz_questions.assert_called_once_with('4A-1', limit=CHAPTER_QUIZ_QUESTION_COUNT)
    assert result['display_update']['type'] == 'question'
    assert state['quiz_done'] is False
    assert state['quiz_correct'] == 0
    assert state['quiz_review'] == []
    assert state['quiz_questions'] == fresh_questions


def test_non_retry_message_after_quiz_done_returns_cached_debrief_not_a_reset():
    orch = Orchestrator()
    questions = two_question_bank()
    state = make_quiz_state(questions, index=2)
    state['quiz_done'] = True
    state['quiz_correct'] = 1
    state['quiz_review'] = []

    mock_researcher = MagicMock()
    mock_display = MagicMock()

    result = orch._process_chapter_quiz(state, 'student@example.com', '4A-1', 'thanks!', mock_researcher, mock_display)

    mock_researcher.get_chapter_quiz_questions.assert_not_called()
    assert result['display_update']['type'] == 'quiz_done'
