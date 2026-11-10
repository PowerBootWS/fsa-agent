"""
E2E for attempt history (plan 2026-11-08-practice-attempt-history, Phase A):
takes a chapter quiz (2B1-3) and a 5-question practice exam (2B1) through the
real Flask /agent/chat route on fsa_agent_scratch, then checks one attempt per
sitting and that every stored answer's snapshot equals what was rendered.
Cleans up its own rows. Refuses to run anywhere but scratch.

  cd ai-service && POSTGRES_DB=fsa_agent_scratch POSTGRES_HOST=localhost \
    POSTGRES_PORT=5434 POSTGRES_PASSWORD=... python3 scripts/e2e_attempt_history_scratch.py
"""
import os, sys, re
assert os.environ['POSTGRES_DB'] == 'fsa_agent_scratch'
os.environ.pop('OPENROUTER_API_KEY', None)
sys.path.insert(0, '.')
import psycopg2
from psycopg2.extras import RealDictCursor
from app import app, researcher
conn = researcher._get_connection(); conn.autocommit = True; cur = conn.cursor()
cur.execute('SELECT 1 FROM _scratch_meta LIMIT 1')  # guard: errors on production
USER = 'e2e-attempt-history@scratch.invalid'
cur.execute('DELETE FROM question_responses WHERE user_email=%s', (USER,))
cur.execute('DELETE FROM assessment_attempts WHERE user_email=%s', (USER,))
c = app.test_client()
def chat(lesson, msg, cfg=None):
    body = {'user': USER, 'lessonId': lesson, 'message': msg}
    if cfg: body['examConfig'] = cfg
    r = c.post('/agent/chat', json=body); assert r.status_code == 200, r.data
    return r.get_json()
def run(lesson, cfg=None):
    resp = chat(lesson, 'hello', cfg); shown = []
    while True:
        d = resp.get('display_update') or {}
        if d.get('type') in ('quiz_done', 'exam_done'): return d, shown
        shown.append({'q': d.get('question'), 'opts': [o['text'] if isinstance(o, dict) else o for o in d.get('options', [])], 'id': d.get('question_id')})
        resp = chat(lesson, 'My answer is B')
quiz, quiz_shown = run('2B1-3')
exam, exam_shown = run('2B1', {'count': 5, 'timed': False})
cur.execute("SELECT id, kind, course_id, chapter_id, question_count, score, score_pct, finished_at IS NOT NULL AS done, chapter_stats FROM assessment_attempts WHERE user_email=%s ORDER BY id", (USER,))
atts = cur.fetchall()
for a in atts: print(dict(a))
assert [a["kind"] for a in atts] == ["chapter_quiz", "practice_exam"], "expected one attempt per sitting"
for a, d, shown in zip(atts, (quiz, exam), (quiz_shown, exam_shown)):
    cur.execute('SELECT position, question_id, correct, question_snapshot FROM question_responses WHERE attempt_id=%s ORDER BY position', (a['id'],))
    rows = cur.fetchall()
    assert [r['position'] for r in rows] == list(range(1, len(shown) + 1)), rows
    assert a['score'] == d['score'] == sum(r['correct'] for r in rows)
    for r, s in zip(rows, shown):
        snap = r['question_snapshot']
        assert snap['options'] == s['opts'], (snap['options'], s['opts'])
        if s['q'] is not None: assert snap['question_text'] == s['q']
        if s['id'] is not None: assert r['question_id'] == s['id']
    print(a['kind'], 'ok:', len(rows), 'answers match what was rendered; score', a['score'], '/', d['total'])
# Phase D: retry the wrong ones from the chapter quiz attempt.
quiz_attempt = atts[0]['id']
cur.execute('SELECT question_id FROM question_responses WHERE attempt_id=%s AND NOT correct ORDER BY position', (quiz_attempt,))
wrong_ids = [r['question_id'] for r in cur.fetchall()]
retry, retry_shown = run(f"2B1-R{quiz_attempt}")
cur.execute("SELECT id, kind, parent_attempt_id, chapter_id, question_count, finished_at IS NOT NULL done FROM assessment_attempts WHERE parent_attempt_id=%s", (quiz_attempt,))
r_att = cur.fetchone()
assert r_att and r_att['kind'] == 'retry_wrong' and r_att['done'] and r_att['chapter_id'] == '2B1-3', r_att
cur.execute('SELECT question_id, session_type FROM question_responses WHERE attempt_id=%s ORDER BY position', (r_att['id'],))
rows = cur.fetchall()
assert [r['question_id'] for r in rows] == wrong_ids, ([r['question_id'] for r in rows], wrong_ids)
assert {r['session_type'] for r in rows} == {'retry_wrong'}
assert retry.get('attempt_id') == r_att['id']
print('retry_wrong ok:', len(rows), 'missed questions re-served in order; parent', quiz_attempt)
cur.execute('DELETE FROM question_responses WHERE user_email=%s', (USER,))
cur.execute('DELETE FROM assessment_attempts WHERE user_email=%s', (USER,))
cur.execute("SELECT count(*) FROM exam_last_debrief WHERE user_email=%s", (USER,)); print('debrief rows', cur.fetchone())
cur.execute("DELETE FROM exam_last_debrief WHERE user_email=%s", (USER,))
