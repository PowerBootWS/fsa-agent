import sys, os
from unittest.mock import MagicMock, patch
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.researcher import Researcher


def make_researcher():
    r = Researcher.__new__(Researcher)
    r.db_config = {}
    return r


def test_get_chapter_quiz_questions_draws_from_both_question_types():
    r = make_researcher()
    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = []
    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    with patch.object(r, '_get_connection', return_value=mock_conn):
        r.get_chapter_quiz_questions('4A-1', limit=15)

    executed_sql = mock_cursor.execute.call_args[0][0]
    assert "question_type IN ('chapter_quiz', 'objective_practice')" in executed_sql
    assert "chapter_id = %s" in executed_sql
    executed_params = mock_cursor.execute.call_args[0][1]
    assert executed_params == ('4A-1', 15)
