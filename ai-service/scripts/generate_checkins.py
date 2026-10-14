#!/usr/bin/env python3
"""
Generate, review and load lesson check-in cards (lesson tutor redesign,
slice 3 — docs/superpowers/specs/2026-10-13-lesson-tutor-redesign.md).

A check-in is a short recap of the slides since the previous one, shown at the
lesson player's checkpoint positions. Cards are generated once, written to a
JSONL file (the reviewable artifact, and what survives the nightly scratch
rebuild), and loaded into `lesson_checkins` as a separate step.

    # generate (reads lesson_chunks; resumable — re-run to continue)
    POSTGRES_DB=fsa_agent_scratch ... python3 generate_checkins.py generate --out FILE
    # 50 random cards as Markdown, for Russ to review before production
    python3 generate_checkins.py sample --in FILE --out review.md
    # load into a database (scratch by default; production needs the flag)
    POSTGRES_DB=fsa_agent_scratch ... python3 generate_checkins.py load --in FILE

Connection comes from POSTGRES_HOST/PORT/USER/PASSWORD/DB, with no default
database on purpose. From the host: POSTGRES_HOST=localhost POSTGRES_PORT=5434.
"""
import argparse
import json
import os
import random
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

# Must match CHECKPOINT_INTERVAL in client-v2/src/LessonPlayer.jsx: the player
# shows a checkpoint on arriving at the 5th, 9th, 13th... slide (0-based index
# 4, 8, 12...), so each card recaps the four slides before that.
CHECKPOINT_INTERVAL = 4

MAX_POINT_CHARS = 220
MAX_PROMPT_CHARS = 200
_CJK = re.compile(r'[　-鿿가-힯]')

SYSTEM = ('You write short check-in cards for a Canadian Power Engineering '
          'certification exam-prep course. Reply with JSON only.')

PROMPT = """Objective: {title}
{earlier}
Slides to recap (the student has just finished these):

{slides}

Write a check-in card as JSON:
{{"recap_points": ["...", "..."], "exercise_prompt": "..."}}

Rules:
- recap_points: the 3 to 5 most exam-relevant takeaways from the slides to recap (2 if they hold very little). Each is one plain sentence under 160 characters. Use only facts stated in those slides. Keep numbers, units and code references exactly as written. Add nothing from outside them.
- exercise_prompt: one short sentence offering a quick multiple-choice exercise on these points, for example "Want to try a few quick questions on staybolt spacing?" Do not ask the exercise question itself.
- Plain Canadian English, like an experienced instructor talking to a student. No em dashes, no emojis, no headings, no markdown."""


# ----------------------------------------------------------------------
# Pure helpers (unit-tested)
# ----------------------------------------------------------------------

def checkin_segments(slide_numbers, interval=CHECKPOINT_INTERVAL):
    """
    Given an objective's slide_numbers in order, return one (from_idx, to_idx)
    pair per checkpoint: the inclusive index range of slides that card recaps.
    """
    segments = []
    start = 0
    for idx in range(interval, len(slide_numbers), interval):
        segments.append((start, idx - 1))
        start = idx
    return segments


def build_messages(title, slides, from_idx, to_idx):
    earlier = [s for s in slides[:from_idx] if (s.get('title') or '').strip()]
    earlier_text = ''
    if earlier:
        titles = '; '.join(dict.fromkeys(s['title'].strip() for s in earlier))
        earlier_text = f'Earlier slides in this objective (already recapped): {titles}\n'
    blocks = []
    for s in slides[from_idx:to_idx + 1]:
        block = [f"### Slide {s['slide_number']} - {(s.get('title') or '').strip()}"]
        if (s.get('body') or '').strip():
            block.append(s['body'].strip())
        if (s.get('narration') or '').strip():
            block.append('Narration: ' + s['narration'].strip())
        blocks.append('\n'.join(block))
    prompt = PROMPT.format(title=title, earlier=earlier_text, slides='\n\n'.join(blocks))
    return [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': prompt}]


def _tidy(text):
    text = ' '.join(str(text).split())
    return text.replace(' — ', ', ').replace('—', ', ').replace(' – ', ', ')


def validate_card(reply_text):
    """Parse and check a model reply. Returns (card, None) or (None, reason)."""
    match = re.search(r'\{.*\}', reply_text or '', re.DOTALL)
    if not match:
        return None, 'no JSON object'
    try:
        raw = json.loads(match.group(0))
    except ValueError:
        return None, 'invalid JSON'
    points = raw.get('recap_points')
    prompt = raw.get('exercise_prompt')
    if not isinstance(points, list) or not isinstance(prompt, str):
        return None, 'wrong shape'
    points = [_tidy(p) for p in points if isinstance(p, str) and p.strip()]
    prompt = _tidy(prompt)
    if not 2 <= len(points) <= 6:
        return None, f'{len(points)} recap points'
    if any(len(p) > MAX_POINT_CHARS for p in points):
        return None, 'recap point too long'
    if not prompt or len(prompt) > MAX_PROMPT_CHARS:
        return None, 'bad exercise prompt'
    if _CJK.search(' '.join(points) + prompt):
        return None, 'non-English output'
    return {'recap_points': points, 'exercise_prompt': prompt}, None


# ----------------------------------------------------------------------
# I/O
# ----------------------------------------------------------------------

def connect():
    import psycopg2
    import psycopg2.extras
    db = os.environ.get('POSTGRES_DB')
    if not db:
        sys.exit('POSTGRES_DB must be set explicitly (no default on purpose).')
    return psycopg2.connect(
        host=os.environ.get('POSTGRES_HOST', 'localhost'),
        port=int(os.environ.get('POSTGRES_PORT', '5434')),
        user=os.environ.get('POSTGRES_USER', 'postgres'),
        password=os.environ.get('POSTGRES_PASSWORD'),
        dbname=db,
        cursor_factory=psycopg2.extras.RealDictCursor,
    ), db


def load_objectives(conn, only=None):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT c.lesson_code, c.slide_number, c.title, c.body, c.narration,
               coalesce(l.title, c.lesson_code) AS lesson_title
        FROM lesson_chunks c
        LEFT JOIN lessons l ON l.lesson_code = c.lesson_code
        WHERE c.lesson_code ~ '^[0-9][A-Z][0-9]?-[0-9]+-[0-9]+$'
        ORDER BY c.lesson_code, c.slide_number
        """
    )
    objectives = {}
    for row in cur.fetchall():
        if only and row['lesson_code'] not in only:
            continue
        objectives.setdefault(row['lesson_code'], {'title': row['lesson_title'], 'slides': []})
        objectives[row['lesson_code']]['slides'].append(dict(row))
    cur.close()
    return objectives


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def call_model(messages, model, api_key):
    import requests
    resp = requests.post(
        'https://openrouter.ai/api/v1/chat/completions',
        headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json',
                 'X-Title': 'FSA check-in generator'},
        json={'model': model, 'messages': messages, 'max_tokens': 2000,
              'reasoning': {'effort': 'low'}, 'usage': {'include': True}},
        timeout=90,
    )
    resp.raise_for_status()
    data = resp.json()
    return data['choices'][0]['message'].get('content') or '', (data.get('usage') or {}).get('cost') or 0


# ----------------------------------------------------------------------
# Commands
# ----------------------------------------------------------------------

def cmd_generate(args):
    api_key = os.environ.get('OPENROUTER_API_KEY')
    if not api_key:
        sys.exit('OPENROUTER_API_KEY is not set.')
    model = args.model or os.environ.get('OPENROUTER_MODEL', 'google/gemini-3-flash-preview')
    conn, db = connect()
    only = set(args.lessons.split(',')) if args.lessons else None
    objectives = load_objectives(conn, only)
    conn.close()

    done = {(c['lesson_code'], c['after_slide']) for c in read_jsonl(args.out)}
    jobs = []
    for code, obj in objectives.items():
        slides = obj['slides']
        for from_idx, to_idx in checkin_segments([s['slide_number'] for s in slides]):
            after = slides[to_idx]['slide_number']
            if (code, after) not in done:
                jobs.append((code, obj, from_idx, to_idx))
    if args.limit:
        jobs = jobs[:args.limit]
    print(f'{db}: {len(objectives)} objectives, {len(done)} cards already in {args.out}, '
          f'{len(jobs)} to generate with {model}', flush=True)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    lock = threading.Lock()
    stats = {'ok': 0, 'failed': 0, 'cost': 0.0}
    failures = []

    def work(job):
        code, obj, from_idx, to_idx = job
        slides = obj['slides']
        messages = build_messages(obj['title'], slides, from_idx, to_idx)
        reason = None
        cost = 0.0
        for attempt in range(3):
            try:
                text, c = call_model(messages, model, api_key)
                cost += c
                card, reason = validate_card(text)
                if card:
                    return code, slides, from_idx, to_idx, card, cost, None
            except Exception as e:  # network, 429, 5xx
                reason = f'{type(e).__name__}: {e}'
                time.sleep(2 * (attempt + 1))
        return code, slides, from_idx, to_idx, None, cost, reason

    started = time.time()
    with open(args.out, 'a') as out, ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, fut in enumerate(as_completed([pool.submit(work, j) for j in jobs]), 1):
            code, slides, from_idx, to_idx, card, cost, reason = fut.result()
            with lock:
                stats['cost'] += cost
                if card:
                    out.write(json.dumps({
                        'lesson_code': code,
                        'from_slide': slides[from_idx]['slide_number'],
                        'after_slide': slides[to_idx]['slide_number'],
                        **card,
                        'model': model,
                        'cost': round(cost, 6),
                    }) + '\n')
                    out.flush()
                    stats['ok'] += 1
                else:
                    stats['failed'] += 1
                    failures.append({'lesson_code': code, 'after_slide': slides[to_idx]['slide_number'], 'reason': reason})
                if i % 100 == 0 or i == len(jobs):
                    print(f'{i}/{len(jobs)} ok={stats["ok"]} failed={stats["failed"]} '
                          f'cost=${stats["cost"]:.2f} {time.time() - started:.0f}s', flush=True)
    if failures:
        with open(args.out + '.failures.json', 'w') as f:
            json.dump(failures, f, indent=1)
        print(f'{len(failures)} failures written to {args.out}.failures.json (re-run to retry)')
    print('DONE', json.dumps(stats))


def cmd_sample(args):
    cards = read_jsonl(args.inp)
    rng = random.Random(args.seed)
    picked = sorted(rng.sample(cards, min(args.n, len(cards))),
                    key=lambda c: (c['lesson_code'], c['after_slide']))
    conn = None
    titles = {}
    if os.environ.get('POSTGRES_DB'):
        conn, _ = connect()
        cur = conn.cursor()
        cur.execute('SELECT lesson_code, title FROM lessons')
        titles = {r['lesson_code']: r['title'] for r in cur.fetchall()}
        conn.close()
    lines = [f'# Check-in card review: {len(picked)} random cards of {len(cards)}', '',
             'Each card recaps the slides named. Mark anything wrong against the slides, '
             'awkward, or not how you would say it.', '']
    for n, c in enumerate(picked, 1):
        lines.append(f"## {n}. {c['lesson_code']}, slides {c['from_slide']}–{c['after_slide']}"
                     + (f" ({titles[c['lesson_code']]})" if c['lesson_code'] in titles else ''))
        lines += [f'- {p}' for p in c['recap_points']]
        lines += ['', f"*Exercise offer:* {c['exercise_prompt']}", '']
    with open(args.out, 'w') as f:
        f.write('\n'.join(lines))
    print(f'wrote {len(picked)} cards to {args.out}')


def cmd_load(args):
    conn, db = connect()
    cur = conn.cursor()
    if db == 'fsa_agent_scratch':
        cur.execute('SELECT 1 FROM _scratch_meta LIMIT 1')
    elif not args.allow_production:
        sys.exit(f'Refusing to load into {db} without --allow-production (take a backup first).')
    cards = read_jsonl(args.inp)
    for c in cards:
        cur.execute(
            """
            INSERT INTO lesson_checkins
                (lesson_code, from_slide, after_slide, recap_points, exercise_prompt, model)
            VALUES (%s, %s, %s, %s::jsonb, %s, %s)
            ON CONFLICT (lesson_code, after_slide) DO UPDATE SET
                from_slide = EXCLUDED.from_slide,
                recap_points = EXCLUDED.recap_points,
                exercise_prompt = EXCLUDED.exercise_prompt,
                model = EXCLUDED.model,
                generated_at = now(),
                reviewed_at = NULL
            """,
            (c['lesson_code'], c['from_slide'], c['after_slide'],
             json.dumps(c['recap_points']), c['exercise_prompt'], c['model'])
        )
    conn.commit()
    cur.execute('SELECT count(*) AS n FROM lesson_checkins')
    print(f'{db}: loaded {len(cards)} cards; lesson_checkins now holds {cur.fetchone()["n"]}')
    conn.close()


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    g = sub.add_parser('generate')
    g.add_argument('--out', required=True)
    g.add_argument('--lessons', help='comma-separated lesson codes (default: all)')
    g.add_argument('--limit', type=int)
    g.add_argument('--workers', type=int, default=8)
    g.add_argument('--model')
    s = sub.add_parser('sample')
    s.add_argument('--in', dest='inp', required=True)
    s.add_argument('--out', required=True)
    s.add_argument('--n', type=int, default=50)
    s.add_argument('--seed', type=int, default=20261013)
    ld = sub.add_parser('load')
    ld.add_argument('--in', dest='inp', required=True)
    ld.add_argument('--allow-production', action='store_true')
    args = p.parse_args(argv)
    {'generate': cmd_generate, 'sample': cmd_sample, 'load': cmd_load}[args.cmd](args)


if __name__ == '__main__':
    main()
