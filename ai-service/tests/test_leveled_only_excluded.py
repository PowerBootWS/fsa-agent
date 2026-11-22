"""
Leveled-only questions (migration 039, plan 2026-11-21 leveled exams Plan 2) are
for the leveled practice exam only. Owner decision 2026-11-21: chapter tests, the
current adaptive practice exam and the tutor keep today's pool, so every one of
those selections must skip questions.leveled_only = true.

DB test: runs ONLY when POSTGRES_DB is exactly 'fsa_agent_test'.

    POSTGRES_DB=fsa_agent_test POSTGRES_HOST=localhost POSTGRES_PORT=5434 \\
    POSTGRES_PASSWORD=... python3 -m pytest tests/test_leveled_only_excluded.py
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

if os.getenv('POSTGRES_DB') != 'fsa_agent_test':
    pytest.skip('DB test: needs POSTGRES_DB=fsa_agent_test', allow_module_level=True)

from agents.researcher import Researcher  # noqa: E402

COURSE, CHAPTER, LESSON = 'ZZ9', 'ZZ9-1', 'ZZ9-1-1'


@pytest.fixture
def r():
    return Researcher()


@pytest.fixture
def pool(r):
    """One normal and one leveled-only question of each type in a fixture chapter."""
    conn = r._get_connection()
    conn.autocommit = True
    cur = conn.cursor()
    ids = {}
    for qtype in ('objective_practice', 'chapter_quiz'):
        for leveled in (False, True):
            cur.execute(
                """INSERT INTO questions (course_id, chapter_id, lesson_code, question_text, options,
                                          correct_answer, difficulty, question_type, standalone, leveled_only)
                   VALUES (%s, %s, %s, %s, '["a","b","c","d"]', 1, 2, %s, true, %s) RETURNING id""",
                (COURSE, CHAPTER, LESSON, f'Fixture {qtype} leveled={leveled}', qtype, leveled))
            ids[(qtype, leveled)] = cur.fetchone()['id']
    yield ids
    cur.execute('DELETE FROM questions WHERE id = ANY(%s)', (list(ids.values()),))
    conn.close()


def _leveled(ids):
    return {v for (_, leveled), v in ids.items() if leveled}


def _normal(ids):
    return {v for (_, leveled), v in ids.items() if not leveled}


def test_practice_exam_selection_skips_leveled_only(r, pool):
    got = {q['id'] for q in r.get_exam_questions(COURSE, limit=50)}
    assert got == _normal(pool)


def test_chapter_test_selection_skips_leveled_only(r, pool):
    got = {q['id'] for q in r.get_chapter_quiz_questions(CHAPTER, limit=50)}
    assert got == _normal(pool)


@pytest.mark.parametrize('qtype', ['objective_practice', 'chapter_quiz'])
def test_tutor_practice_selection_skips_leveled_only(r, pool, qtype):
    got = {q['id'] for q in r.get_questions(LESSON, complexity_level=5, question_type=qtype, limit=50)}
    assert got == {pool[(qtype, False)]}
