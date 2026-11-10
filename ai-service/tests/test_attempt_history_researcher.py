"""
Attempt history write path (plan 2026-11-08-practice-attempt-history, Phase A):
Researcher.start_attempt / finish_attempt and the new record_response columns,
run against a real database.

Runs ONLY when POSTGRES_DB is exactly 'fsa_agent_test' (schema-only copy of
production, rebuilt by server/scripts/rebuild-test-db.sh). Any other value,
including unset, skips the module, so this can never write to production:

    POSTGRES_DB=fsa_agent_test POSTGRES_HOST=localhost POSTGRES_PORT=5434 \\
    POSTGRES_PASSWORD=... python3 -m pytest tests/test_attempt_history_researcher.py
"""
import os
import sys
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

if os.getenv('POSTGRES_DB') != 'fsa_agent_test':
    pytest.skip('DB test: needs POSTGRES_DB=fsa_agent_test', allow_module_level=True)

from agents.researcher import Researcher  # noqa: E402

USER = 'attempt-history-test@example.invalid'


@pytest.fixture
def r():
    return Researcher()


@pytest.fixture
def db(r):
    conn = r._get_connection()
    conn.autocommit = True
    yield conn.cursor()
    conn.close()


@pytest.fixture
def question_id(db):
    db.execute(
        """INSERT INTO questions (course_id, chapter_id, question_text, options, correct_answer)
           VALUES ('2B1', '2B1-3', 'Fixture question', '["a","b","c","d"]', 2) RETURNING id"""
    )
    qid = db.fetchone()['id']
    yield qid
    db.execute('DELETE FROM question_responses WHERE user_email = %s', (USER,))
    db.execute('DELETE FROM assessment_attempts WHERE user_email = %s', (USER,))
    db.execute('DELETE FROM questions WHERE id = %s', (qid,))


def test_start_attempt_creates_an_open_live_attempt(r, db, question_id):
    aid = r.start_attempt(USER, '2B1', 'chapter_quiz', question_count=10, chapter_id='2B1-3')
    assert isinstance(aid, int)
    db.execute('SELECT * FROM assessment_attempts WHERE id = %s', (aid,))
    row = db.fetchone()
    assert row['user_email'] == USER
    assert row['course_id'] == '2B1'
    assert row['chapter_id'] == '2B1-3'
    assert row['kind'] == 'chapter_quiz'
    assert row['question_count'] == 10
    assert row['source'] == 'live'
    assert row['finished_at'] is None
    assert row['parent_attempt_id'] is None


def test_record_response_stores_attempt_position_and_snapshot(r, db, question_id):
    aid = r.start_attempt(USER, '2B1', 'practice_exam', question_count=100)
    snap = {'question_text': 'Fixture question', 'options': ['a', 'b', 'c', 'd'],
            'correct_index': 2, 'explanation': 'Because.', 'lesson_code': '2B1-3-1',
            'topic': 't', 'chapter_id': '2B1-3'}
    r.record_response(USER, question_id, 'practice_exam', '2B1', '2B1-3', False,
                      selected_index=1, attempt_id=aid, position=7, question_snapshot=snap)
    db.execute('SELECT * FROM question_responses WHERE user_email = %s', (USER,))
    rows = db.fetchall()
    assert len(rows) == 1
    assert rows[0]['attempt_id'] == aid
    assert rows[0]['position'] == 7
    assert rows[0]['question_snapshot'] == snap
    assert rows[0]['selected_index'] == 1


def test_record_response_without_attempt_still_works(r, db, question_id):
    """Existing callers pass none of the new arguments."""
    r.record_response(USER, question_id, 'chapter_quiz', '2B1', '2B1-3', True, selected_index=2)
    db.execute('SELECT attempt_id, position, question_snapshot FROM question_responses WHERE user_email = %s', (USER,))
    row = db.fetchone()
    assert row == {'attempt_id': None, 'position': None, 'question_snapshot': None}


def test_finish_attempt_sets_score_once(r, db, question_id):
    aid = r.start_attempt(USER, '2B1', 'practice_exam', question_count=4)
    stats = {'2B1-1': {'correct': 2, 'total': 3}, '2B1-2': {'correct': 1, 'total': 1}}
    r.finish_attempt(aid, score=3, score_pct=75, chapter_stats=stats)
    db.execute('SELECT * FROM assessment_attempts WHERE id = %s', (aid,))
    row = db.fetchone()
    assert (row['score'], row['score_pct'], row['chapter_stats']) == (3, 75, stats)
    first_finish = row['finished_at']
    assert first_finish is not None

    # A second finish (e.g. a resumed debrief) must not overwrite the first.
    r.finish_attempt(aid, score=0, score_pct=0, chapter_stats={})
    db.execute('SELECT * FROM assessment_attempts WHERE id = %s', (aid,))
    row = db.fetchone()
    assert (row['score'], row['score_pct'], row['finished_at']) == (3, 75, first_finish)


def test_finish_attempt_with_no_id_is_a_noop(r):
    r.finish_attempt(None, score=1, score_pct=100)


def test_start_attempt_failure_is_non_fatal(r):
    with patch.object(r, '_get_connection', side_effect=RuntimeError('db down')):
        assert r.start_attempt(USER, '2B1', 'practice_exam', question_count=1) is None
        r.finish_attempt(1, score=1, score_pct=100)  # must not raise
