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


# ---------------------------------------------------------------- Phase D

def _answer(db, user, attempt_id, position, qid, correct, session='practice_exam', chapter='2B1-3'):
    db.execute(
        """INSERT INTO question_responses (user_email, question_id, session_type, course_id, chapter_id,
                                           correct, attempt_id, position)
           VALUES (%s, %s, %s, '2B1', %s, %s, %s, %s)""",
        (user, qid, session, chapter, correct, attempt_id, position))


@pytest.fixture
def extra_questions(db):
    ids = []
    for text, standalone in (('Extra wrong live', True), ('Extra retired', False), ('Extra right', True)):
        db.execute(
            """INSERT INTO questions (course_id, chapter_id, question_text, options, correct_answer,
                                      standalone, lesson_code)
               VALUES ('2B1', '2B1-4', %s, '["a","b","c","d"]', 1, %s, '2B1-4-2') RETURNING id""",
            (text, standalone))
        ids.append(db.fetchone()['id'])
    yield ids
    db.execute('DELETE FROM question_responses WHERE user_email = %s', (USER,))
    db.execute('DELETE FROM questions WHERE id = ANY(%s)', (ids,))


def test_get_retry_questions_serves_live_wrong_ones_in_order(r, db, question_id, extra_questions):
    wrong_live, retired, right = extra_questions
    aid = r.start_attempt(USER, '2B1', 'practice_exam', question_count=4)
    _answer(db, USER, aid, 1, right, True)
    _answer(db, USER, aid, 2, wrong_live, False, chapter='2B1-4')
    _answer(db, USER, aid, 3, question_id, False)
    _answer(db, USER, aid, 4, retired, False, chapter='2B1-4')
    r.finish_attempt(aid, 1, 25)
    db.execute("UPDATE questions SET question_text = 'Rewritten after the attempt' WHERE id = %s", (wrong_live,))

    parent, qs = r.get_retry_questions(USER, aid, '2B1')
    assert parent == {'id': aid, 'course_id': '2B1', 'chapter_id': None, 'kind': 'practice_exam'}
    assert [q['id'] for q in qs] == [wrong_live, question_id]  # position order; retired skipped
    assert qs[0]['question_text'] == 'Rewritten after the attempt'  # live, not the snapshot
    assert qs[0]['chapter_id'] == '2B1-4' and qs[0]['lesson_code'] == '2B1-4-2'
    assert qs[0]['correct_answer'] == 1


def test_get_retry_questions_refuses_other_users_wrong_paper_and_unfinished(r, db, question_id):
    aid = r.start_attempt(USER, '2B1', 'chapter_quiz', question_count=1, chapter_id='2B1-3')
    _answer(db, USER, aid, 1, question_id, False, session='chapter_quiz')
    assert r.get_retry_questions(USER, aid, '2B1') == (None, [])           # not finished
    r.finish_attempt(aid, 0, 0)
    assert r.get_retry_questions('someone-else@example.invalid', aid, '2B1') == (None, [])
    assert r.get_retry_questions(USER, aid, '3A1') == (None, [])           # wrong paper
    parent, qs = r.get_retry_questions(USER, aid, '2B1')
    assert parent['chapter_id'] == '2B1-3' and [q['id'] for q in qs] == [question_id]


def test_chapter_weights_ignore_retry_answers(r, db, question_id):
    _answer(db, USER, None, None, question_id, False, session='practice_exam')
    _answer(db, USER, None, None, question_id, True, session='retry_wrong')
    _answer(db, USER, None, None, question_id, True, session='retry_wrong')
    w = r.get_chapter_weights(USER, '2B1')
    assert w == {'2B1-3': {'accuracy': 0.0, 'total': 1}}
