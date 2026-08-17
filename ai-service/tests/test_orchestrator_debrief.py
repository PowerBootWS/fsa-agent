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


def test_exam_results_include_objective_enrichment():
    """Wrong answers in exam_results carry lesson_code, topic, explanation."""
    orch = Orchestrator()

    # Pre-seed state with two questions — first one the student gets wrong
    base_state = make_base_state()
    state = {**base_state,
        'exam_questions': [
            {
                'id': 10,
                'question_text': 'Q1',
                'options': ['A', 'B', 'C', 'D'],
                'correct_answer': 0,
                'explanation': 'Use Barlow formula.',
                'difficulty': 3,
                'topic': 'thickness_formula',
                'question_type': 'objective_practice',
                'chapter_id': '2B1-3',
                'course_id': '2B1',
                'lesson_code': '2B1-3-2',
            },
            {
                'id': 11,
                'question_text': 'Q2',
                'options': ['A', 'B', 'C', 'D'],
                'correct_answer': 1,
                'explanation': 'Pressure formula.',
                'difficulty': 3,
                'topic': 'pressure',
                'question_type': 'objective_practice',
                'chapter_id': '2B1-1',
                'course_id': '2B1',
                'lesson_code': '2B1-1-4',
            },
        ],
        'exam_index': 1,  # question 0 already presented
        'exam_results': [],
    }
    orch.conversation_state['test@example.com:2B1'] = state

    mock_researcher = MagicMock()
    mock_researcher.record_response.return_value = None

    mock_display = MagicMock()
    mock_display.create_initial_display.return_value = None

    mock_tutor = MagicMock()
    mock_tutor.respond.return_value = {'response': '', 'action': None}

    # Student answers 'B' (wrong — correct is 'A' = index 0)
    orch._process_practice_exam(
        state=state,
        user='test@example.com',
        lesson_id='2B1',
        message='My answer is B',
        researcher=mock_researcher,
        display=mock_display,
        tutor=mock_tutor,
        lesson_context={'title': '2B1', 'summary': '', 'key_points': [], 'narration_text': '', 'video_transcript': ''},
        progress=None,
    )

    assert len(state['exam_results']) == 1
    result = state['exam_results'][0]
    assert result['correct'] is False
    assert result['lesson_code'] == '2B1-3-2'
    assert result['topic'] == 'thickness_formula'
    assert result['explanation'] == 'Use Barlow formula.'


def test_parse_lesson_code_extracts_chapter_and_objective():
    orch = Orchestrator()
    ch, obj = orch._parse_lesson_code('2B1-3-2', '')
    assert ch == '3'
    assert obj == '2'


def test_parse_lesson_code_falls_back_gracefully():
    orch = Orchestrator()
    ch, obj = orch._parse_lesson_code('', '2B1-3')
    assert ch == '3'
    assert obj == '?'


def test_group_wrong_by_objective():
    orch = Orchestrator()
    results = [
        {'correct': False, 'lesson_code': '2B1-3-2', 'chapter_id': '2B1-3',
         'topic': 'thickness', 'explanation': 'Use Barlow.', 'question_id': 1},
        {'correct': True,  'lesson_code': '2B1-1-1', 'chapter_id': '2B1-1',
         'topic': 'scope',     'explanation': 'Scope def.',   'question_id': 2},
        {'correct': False, 'lesson_code': '2B1-3-2', 'chapter_id': '2B1-3',
         'topic': 'thickness', 'explanation': 'Use Barlow.', 'question_id': 3},
    ]
    grouped = orch._group_wrong_by_objective(results)
    assert len(grouped) == 1
    assert '2B1-3-2' in grouped
    assert grouped['2B1-3-2']['count'] == 2


def test_group_wrong_falls_back_to_chapter_id_key():
    orch = Orchestrator()
    results = [
        {'correct': False, 'lesson_code': '', 'chapter_id': '2B1-3',
         'topic': 'pressure', 'explanation': 'P formula.', 'question_id': 5},
    ]
    grouped = orch._group_wrong_by_objective(results)
    assert '2B1-3' in grouped
