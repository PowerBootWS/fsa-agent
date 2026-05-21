import pytest
from unittest.mock import MagicMock, patch
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.orchestrator import Orchestrator, PRACTICE_EXAM_QUESTION_COUNT


def make_base_state():
    """Minimal state dict for testing."""
    return {
        'user': 'test@example.com',
        'lesson_id': '2B1',
        'mode': 'practice_exam',
        'first_name': 'Jordan',
        'initialized': True,
        'exchange_count': 0,
        'score': 100, 'struggles': [], 'attempts': {},
        'complexity_level': 3,
        'activity': 'greeting',
        'questions_done': 0,
        'session_limit_reached': False,
        'seen_question_ids': [],
        'staged_step': 1, 'staged_problem_id': None, 'staged_context': {},
        'staged_step1_answer': None, 'staged_step2_answer': None, 'staged_step3_answer': None,
        'review_index': 0,
        'chat_history': [],
        'profanity_count': 0,
        'quiz_questions': [], 'quiz_index': 0, 'quiz_correct': 0,
        'quiz_awaiting_feedback': False, 'quiz_current_correct_answer': None,
        'exam_questions': [], 'exam_index': 0, 'exam_results': [],
        'exam_phase': 'answering',
        'exam_question_count': PRACTICE_EXAM_QUESTION_COUNT,
        'exam_timed': False,
    }


def _make_mocks():
    mock_researcher = MagicMock()
    mock_researcher.get_user_by_email.return_value = {'first_name': 'Jordan'}
    mock_researcher.get_chapter_weights.return_value = {}
    mock_researcher.get_exam_questions.return_value = []
    mock_researcher.get_relevant_chunks.return_value = []
    mock_tutor = MagicMock()
    mock_tutor.respond.return_value = {'response': 'hi', 'action': None}
    mock_display = MagicMock()
    mock_display.create_initial_display.return_value = None
    mock_display.determine_update.return_value = None
    return mock_researcher, mock_tutor, mock_display


def test_state_uses_exam_config_count():
    """exam_question_count in state comes from exam_config passed to process()."""
    orch = Orchestrator()
    orch._api_key = None
    mock_researcher, mock_tutor, mock_display = _make_mocks()
    lesson_context = {'title': '2B1', 'summary': '', 'key_points': [],
                      'narration_text': '', 'video_transcript': '', 'lesson_code': '2B1'}

    orch.process(
        user='test@example.com', lesson_id='2B1', message='hello',
        lesson_context=lesson_context, progress=None,
        tutor=mock_tutor, display=mock_display, researcher=mock_researcher,
        exam_config={'count': 25, 'timed': True},
    )

    state = orch.conversation_state['test@example.com:2B1']
    assert state['exam_question_count'] == 25
    assert state['exam_timed'] is True


def test_state_defaults_to_constant_when_no_config():
    """Without exam_config, exam_question_count defaults to PRACTICE_EXAM_QUESTION_COUNT."""
    orch = Orchestrator()
    orch._api_key = None
    mock_researcher, mock_tutor, mock_display = _make_mocks()
    lesson_context = {'title': '2B1', 'summary': '', 'key_points': [],
                      'narration_text': '', 'video_transcript': '', 'lesson_code': '2B1'}

    orch.process(
        user='test2@example.com', lesson_id='2B1', message='hello',
        lesson_context=lesson_context, progress=None,
        tutor=mock_tutor, display=mock_display, researcher=mock_researcher,
        exam_config=None,
    )

    state = orch.conversation_state['test2@example.com:2B1']
    assert state['exam_question_count'] == PRACTICE_EXAM_QUESTION_COUNT
    assert state['exam_timed'] is False
