import pytest
from unittest.mock import MagicMock
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.orchestrator import Orchestrator, PRACTICE_EXAM_QUESTION_COUNT


def _base_state():
    return {
        'exam_results': [
            {'question_id': 1, 'correct': False, 'chapter_id': '4A-1', 'lesson_code': '4A-1-2',
             'topic': 'friction', 'explanation': 'Coefficient of friction.'},
            {'question_id': 2, 'correct': True, 'chapter_id': '4A-1', 'lesson_code': '4A-1-3',
             'topic': 'friction', 'explanation': ''},
        ],
        'complexity_level': 3,
        'exam_question_count': PRACTICE_EXAM_QUESTION_COUNT,
        'chat_history': [],
    }


def test_fourth_class_debrief_has_no_objective_breakdowns_or_tutor_prose():
    orch = Orchestrator()
    mock_researcher = MagicMock()
    mock_tutor = MagicMock()

    result = orch._generate_exam_debrief(
        _base_state(), 'student@example.com', '4A', 'Jordan',
        mock_researcher, mock_tutor, {}, None,
    )

    assert result['tutor_response'] == ''
    assert result['display_update']['objective_breakdowns'] == []
    mock_tutor.respond.assert_not_called()


def test_fourth_class_debrief_still_includes_chapter_stats_and_next_allocation():
    orch = Orchestrator()
    mock_researcher = MagicMock()
    mock_tutor = MagicMock()

    result = orch._generate_exam_debrief(
        _base_state(), 'student@example.com', '4A', 'Jordan',
        mock_researcher, mock_tutor, {}, None,
    )

    display = result['display_update']
    assert display['score'] == 1
    assert display['total'] == 2
    assert display['chapter_stats'] == [
        {'chapter': '4A-1', 'correct': 1, 'total': 2, 'pct': 50, 'status': 'Developing'},
    ]
    assert display['next_attempt_allocation'] is not None


def test_second_class_debrief_unchanged_still_calls_tutor_and_builds_breakdowns():
    orch = Orchestrator()
    mock_researcher = MagicMock()
    mock_researcher.get_questions_by_ids.return_value = {}
    mock_tutor = MagicMock()
    mock_tutor.respond.return_value = {'response': 'Solid effort!'}
    orch._call_llm_for_teaching_tips = MagicMock(return_value={1: 'Review friction formulas.'})

    state = _base_state()
    state['exam_results'][0]['lesson_code'] = '2B1-1-2'
    state['exam_results'][0]['chapter_id'] = '2B1-1'
    state['exam_results'][1]['chapter_id'] = '2B1-1'

    result = orch._generate_exam_debrief(
        state, 'student@example.com', '2B1', 'Jordan',
        mock_researcher, mock_tutor, {}, None,
    )

    assert result['tutor_response'] == 'Solid effort!'
    assert len(result['display_update']['objective_breakdowns']) == 1
    mock_tutor.respond.assert_called_once()
