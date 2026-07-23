import sys, os
from unittest.mock import MagicMock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.orchestrator import Orchestrator, PRACTICE_EXAM_QUESTION_COUNT


def make_exam_state(exam_results):
    return {
        'exam_results': exam_results,
        'complexity_level': 3,
        'exam_question_count': PRACTICE_EXAM_QUESTION_COUNT,
        'chat_history': [],
        'exam_lead_magnet': False,
    }


def test_exam_results_capture_question_text_options_and_selected_index():
    """Answering an exam question must record enough detail to build a full
    review later, not just correctness."""
    orch = Orchestrator()
    state = {
        'exam_questions': [
            {'id': 10, 'question_text': 'Q1', 'options': ['A', 'B', 'C', 'D'],
             'correct_answer': 0, 'explanation': 'Use Barlow.', 'difficulty': 3,
             'topic': 'thickness', 'chapter_id': '2B1-1', 'course_id': '2B1', 'lesson_code': '2B1-1-2'},
        ],
        'exam_index': 1,
        'exam_results': [],
        'exam_init_hello': False,
        'complexity_level': 3,
    }
    mock_researcher = MagicMock()

    orch._record_exam_answer(state, 'student@example.com', '2B1', 'My answer is B', mock_researcher)

    assert state['exam_results'] == [{
        'chapter_id': '2B1-1', 'question_id': 10, 'correct': False,
        'lesson_code': '2B1-1-2', 'topic': 'thickness', 'explanation': 'Use Barlow.',
        'question_text': 'Q1', 'options': ['A', 'B', 'C', 'D'],
        'correct_index': 0, 'selected_index': 1,
    }]


def test_exam_debrief_includes_question_review_alongside_existing_fields():
    """The new question_review array must not replace chapter_stats,
    objective_breakdowns, or next_attempt_allocation."""
    orch = Orchestrator()
    state = make_exam_state([
        {'question_id': 1, 'correct': False, 'chapter_id': '2B1-1', 'lesson_code': '2B1-1-2',
         'topic': 'friction', 'explanation': 'Use friction formula.',
         'question_text': 'Q1', 'options': ['A', 'B', 'C', 'D'], 'correct_index': 0, 'selected_index': 1},
        {'question_id': 2, 'correct': True, 'chapter_id': '2B1-1', 'lesson_code': '2B1-1-3',
         'topic': 'friction', 'explanation': '',
         'question_text': 'Q2', 'options': ['W', 'X', 'Y', 'Z'], 'correct_index': 2, 'selected_index': 2},
    ])
    mock_researcher = MagicMock()
    mock_researcher.get_questions_by_ids.return_value = {}
    mock_tutor = MagicMock()
    mock_tutor.respond.return_value = {'response': 'Solid effort!'}
    orch._call_llm_for_teaching_tips = MagicMock(return_value={1: 'Review friction.'})

    result = orch._generate_exam_debrief(
        state, 'student@example.com', '2B1', 'Jordan',
        mock_researcher, mock_tutor, {}, None,
    )

    display = result['display_update']
    assert display['chapter_stats'] == [{'chapter': '2B1-1', 'correct': 1, 'total': 2, 'pct': 50, 'status': 'Developing'}]
    assert len(display['objective_breakdowns']) == 1
    assert display['next_attempt_allocation'] is not None
    assert display['question_review'] == [
        {'question_text': 'Q1', 'options': ['A', 'B', 'C', 'D'], 'correct_index': 0,
         'selected_index': 1, 'correct': False, 'explanation': 'Use friction formula.'},
        {'question_text': 'Q2', 'options': ['W', 'X', 'Y', 'Z'], 'correct_index': 2,
         'selected_index': 2, 'correct': True, 'explanation': ''},
    ]


def test_fourth_class_exam_debrief_also_gets_question_review():
    """4th Class keeps zero prose (Task 8, unchanged) but still gets the
    review data — the reduced-AI debrief and question_review are independent."""
    orch = Orchestrator()
    state = make_exam_state([
        {'question_id': 1, 'correct': True, 'chapter_id': '4A-1', 'lesson_code': '4A-1-2',
         'topic': 'friction', 'explanation': '',
         'question_text': 'Q1', 'options': ['A', 'B'], 'correct_index': 0, 'selected_index': 0},
    ])
    mock_researcher = MagicMock()
    mock_tutor = MagicMock()

    result = orch._generate_exam_debrief(
        state, 'student@example.com', '4A', 'Jordan',
        mock_researcher, mock_tutor, {}, None,
    )

    assert result['tutor_response'] == ''
    assert result['display_update']['objective_breakdowns'] == []
    assert result['display_update']['question_review'] == [
        {'question_text': 'Q1', 'options': ['A', 'B'], 'correct_index': 0,
         'selected_index': 0, 'correct': True, 'explanation': ''},
    ]
    mock_tutor.respond.assert_not_called()
