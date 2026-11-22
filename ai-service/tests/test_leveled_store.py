"""Leveled exam store (Plan 3, Task 3). DB test: runs ONLY when POSTGRES_DB is exactly
'fsa_agent_test'.

    POSTGRES_DB=fsa_agent_test POSTGRES_HOST=localhost POSTGRES_PORT=5434 \\
    POSTGRES_PASSWORD=... python3 -m pytest tests/test_leveled_store.py
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

if os.getenv('POSTGRES_DB') != 'fsa_agent_test':
    pytest.skip('DB test: needs POSTGRES_DB=fsa_agent_test', allow_module_level=True)

from agents.leveled_store import LeveledStore  # noqa: E402
from agents.researcher import Researcher  # noqa: E402

P = 'ZZ9'
EMAIL = 'leveled-store@test.invalid'
OPTED_OUT = 'leveled-store-adaptive@test.invalid'


@pytest.fixture
def store():
    return LeveledStore(Researcher())


@pytest.fixture
def bank(store):
    conn = store.researcher._get_connection()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("""INSERT INTO exam_topic_groups (paper_code, topic_key, display_name, exam_questions, chapter_ids, sort_order)
                   VALUES (%s, 'a', 'Topic A', 4, ARRAY['ZZ9-1'], 0), (%s, 'b', 'Topic B', 2, ARRAY['ZZ9-2'], 1),
                          (%s, 'z', 'Zero', 0, ARRAY['ZZ9-9'], 2)""", (P, P, P))
    ids = {}

    def add(key, chapter, level, standalone=True, leveled_only=False):
        cur.execute("""INSERT INTO questions (course_id, chapter_id, lesson_code, question_text, options, correct_answer,
                                              difficulty, question_type, standalone, leveled_only, exam_level)
                       VALUES (%s, %s, %s, %s, '["a","b","c","d"]', 0, 2, 'chapter_quiz', %s, %s, %s) RETURNING id""",
                    (P, chapter, chapter + '-1', f'leveled store fixture {key}', standalone, leveled_only, level))
        ids[key] = cur.fetchone()['id']

    for i in range(6):
        add(f'a2_{i}', 'ZZ9-1', 2)
    add('a1_0', 'ZZ9-1', 1)
    add('a1_1', 'ZZ9-1', 1, leveled_only=True)
    add('a3_0', 'ZZ9-1', 3)
    add('a_retired', 'ZZ9-1', 3, standalone=False)
    add('a_unleveled', 'ZZ9-1', None)
    add('b4_0', 'ZZ9-2', 4)
    for e, engine in ((EMAIL, None), (OPTED_OUT, 'adaptive')):
        cur.execute("INSERT INTO platform_users (email, first_name, last_name, exam_engine) VALUES (%s, 'T', 'T', %s)",
                    (e, engine))
    yield ids
    cur.execute('DELETE FROM leveled_exam_sittings WHERE user_email = ANY(%s)', ([EMAIL, OPTED_OUT],))
    cur.execute('DELETE FROM student_topic_levels WHERE user_email = ANY(%s)', ([EMAIL, OPTED_OUT],))
    cur.execute('DELETE FROM platform_users WHERE email = ANY(%s)', ([EMAIL, OPTED_OUT],))
    cur.execute('DELETE FROM questions WHERE id = ANY(%s)', (list(ids.values()),))
    cur.execute('DELETE FROM exam_topic_groups WHERE paper_code = %s', (P,))
    conn.close()


def _group(store, key):
    return next(g for g in store.topic_groups(P) if g['topic_key'] == key)


def test_engine_for_follows_env_and_opt_out(store, bank, monkeypatch):
    monkeypatch.setenv('LEVELED_PAPERS', '2B1, ZZ9')
    assert store.engine_for(EMAIL, P, False) == 'leveled'
    assert store.engine_for(OPTED_OUT, P, False) == 'adaptive'
    assert store.engine_for(OPTED_OUT, P, True) == 'leveled'
    assert store.engine_for('nobody@test.invalid', P, True) == 'leveled'
    assert store.engine_for(EMAIL, 'ZZ8', False) == 'adaptive'
    monkeypatch.setenv('LEVELED_PAPERS', '')
    assert store.engine_for(EMAIL, P, False) == 'adaptive'


def test_topic_groups_in_order_with_chapters(store, bank):
    gs = store.topic_groups(P)
    assert [g['topic_key'] for g in gs] == ['a', 'b', 'z']
    assert gs[0]['chapter_ids'] == ['ZZ9-1'] and gs[0]['display_name'] == 'Topic A'


def test_pick_prefers_level_then_lower(store, bank):
    qs, log = store.pick(P, _group(store, 'a'), 2, 4, set(), set())
    assert len(qs) == 4 and {q['exam_level'] for q in qs} == {2} and log == []
    assert all(q['topic_key'] == 'a' and q['chapter_id'] == 'ZZ9-1' for q in qs)
    assert {'id', 'question_text', 'options', 'correct_answer', 'explanation', 'topic', 'lesson_code'} <= set(qs[0])


def test_pick_falls_back_down_then_up(store, bank):
    qs, log = store.pick(P, _group(store, 'a'), 3, 4, set(), set())
    levels = sorted(q['exam_level'] for q in qs)
    assert levels == [2, 2, 2, 3]
    assert log and 'a' in log[0] and 'level 2' in log[0]
    qs, _ = store.pick(P, _group(store, 'a'), 1, 4, set(), set())
    assert sorted(q['exam_level'] for q in qs) == [1, 1, 2, 2]     # both level-1 rows (incl. leveled-only), then up


def test_fallback_any_level_keeps_slot_count(store, bank):
    qs, log = store.pick(P, _group(store, 'b'), 2, 1, set(), set())
    assert [q['id'] for q in qs] == [bank['b4_0']] and log


def test_pick_never_serves_unleveled_retired_or_taken(store, bank):
    taken = {bank['a2_0']}
    qs, _ = store.pick(P, _group(store, 'a'), 3, 20, set(), taken)
    got = {q['id'] for q in qs}
    assert bank['a_retired'] not in got and bank['a_unleveled'] not in got and bank['a2_0'] not in got
    assert len(got) == 8


def test_pick_prefers_unseen(store, bank):
    avoid = {bank[f'a2_{i}'] for i in range(5)}
    qs, _ = store.pick(P, _group(store, 'a'), 2, 1, avoid, set())
    assert [q['id'] for q in qs] == [bank['a2_5']]
    qs, _ = store.pick(P, _group(store, 'a'), 2, 3, avoid, set())
    assert len(qs) == 3 and all(q['exam_level'] == 2 for q in qs)  # seen ones fill before changing level


def test_levels_default_two_and_save_roundtrip(store, bank):
    assert store.levels(EMAIL, P) == {'a': 2, 'b': 2}
    store.save_levels(EMAIL, P, {'a': 3, 'b': 1})
    store.save_levels(EMAIL, P, {'a': 4})
    assert store.levels(EMAIL, P) == {'a': 4, 'b': 1}


def test_sitting_start_finish_and_round_parity(store, bank):
    assert store.next_round_up_first(EMAIL, P) is True
    assert store.last_topics(EMAIL, P) is None
    sid = store.start_sitting(EMAIL, P, 50, False, True, [bank['a2_0'], bank['b4_0']])
    assert store.next_round_up_first(EMAIL, P) is False
    assert store.recent_ids(EMAIL, P) == {bank['a2_0'], bank['b4_0']}
    assert store.last_topics(EMAIL, P) is None        # in progress doesn't count
    topics = {'a': {'level': 2, 'correct': 1, 'total': 1}}
    store.finish_sitting(sid, 'completed', None, topics, {'a': [2, 3]}, 71.5, 'solid')
    assert store.last_topics(EMAIL, P) == topics


def test_finish_is_once_only(store, bank):
    sid = store.start_sitting(EMAIL, P, 100, False, False, [])
    store.finish_sitting(sid, 'completed', None, {'a': {'level': 2, 'correct': 1, 'total': 1}}, {}, 80, 'solid')
    store.finish_sitting(sid, 'timed_out', None, {}, {}, 0, 'fail')
    assert store.last_topics(EMAIL, P) == {'a': {'level': 2, 'correct': 1, 'total': 1}}
