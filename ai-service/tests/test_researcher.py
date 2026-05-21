import pytest
from unittest.mock import MagicMock, patch
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.researcher import Researcher


def make_researcher():
    r = Researcher.__new__(Researcher)
    r.db_config = {}
    return r


def test_get_questions_by_ids_returns_dict_keyed_by_id():
    r = make_researcher()
    mock_rows = [
        {'id': 1, 'lesson_code': '2B1-3-2', 'topic': 'thickness_formula', 'explanation': 'Use Barlow.'},
        {'id': 2, 'lesson_code': '2B1-1-4', 'topic': 'pressure',          'explanation': 'Pressure rises.'},
    ]
    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = mock_rows
    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    with patch.object(r, '_get_connection', return_value=mock_conn):
        result = r.get_questions_by_ids([1, 2])

    assert result[1]['lesson_code'] == '2B1-3-2'
    assert result[2]['topic'] == 'pressure'
    assert result[1]['explanation'] == 'Use Barlow.'


def test_get_questions_by_ids_empty_input_returns_empty():
    r = make_researcher()
    result = r.get_questions_by_ids([])
    assert result == {}


def test_get_questions_by_ids_handles_null_fields():
    r = make_researcher()
    mock_rows = [
        {'id': 5, 'lesson_code': None, 'topic': None, 'explanation': None},
    ]
    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = mock_rows
    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    with patch.object(r, '_get_connection', return_value=mock_conn):
        result = r.get_questions_by_ids([5])

    assert result[5]['lesson_code'] == ''
    assert result[5]['topic'] == ''
    assert result[5]['explanation'] == ''
