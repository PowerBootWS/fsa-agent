#!/usr/bin/env python3
"""One-time fix (content audit 2026-10-21): spread correct answers evenly across
A-D for the existing question bank. See option_order.py for why.

Only the order of options changes; the correct option's text is checked to be
identical before and after for every row. Staged multi-step questions and
position-dependent questions are skipped. Deterministic per question id.

  POSTGRES_DB=fsa_agent_scratch python3 rebalance_option_order.py            # dry run
  POSTGRES_DB=fsa_agent_scratch python3 rebalance_option_order.py --apply    # write
Production: take a backup first (sudo /usr/local/bin/fsa-backup.sh daily).
"""
import argparse
import json
import os
import random
import sys
from collections import Counter

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from option_order import shuffle_options  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()
    db = os.environ.get('POSTGRES_DB')
    if not db:
        sys.exit('Set POSTGRES_DB explicitly (fsa_agent_scratch to rehearse, fsa_agent for production).')
    conn = psycopg2.connect(host=os.environ.get('POSTGRES_HOST', 'localhost'), port=int(os.environ.get('POSTGRES_PORT', '5434')),
                            dbname=db, user=os.environ.get('POSTGRES_USER', 'postgres'), password=os.environ['POSTGRES_PASSWORD'])
    cur = conn.cursor()
    cur.execute("""SELECT id, question_text, options, correct_answer, explanation FROM questions
                    WHERE step_data IS NULL AND jsonb_typeof(options) = 'array' AND jsonb_array_length(options) >= 2
                    ORDER BY id""")
    rows = cur.fetchall()
    before, after, changes, skipped = Counter(), Counter(), [], 0
    for qid, text, opts, ans, expl in rows:
        before[ans] += 1
        new_opts, new_ans = shuffle_options(opts, ans, text or '', expl or '', rng=random.Random(qid))
        if new_opts is opts:
            skipped += 1
        assert new_opts[new_ans] == opts[ans], qid
        assert sorted(map(str, new_opts)) == sorted(map(str, opts)), qid
        after[new_ans] += 1
        if new_opts != opts or new_ans != ans:
            changes.append((qid, opts, new_opts, new_ans))
    print(f'{db}: {len(rows)} questions, {len(changes)} to reorder, {skipped} left alone (position-dependent)')
    print('correct position before:', dict(sorted(before.items())))
    print('correct position after: ', dict(sorted(after.items())))
    if not args.apply:
        print('dry run — nothing written'); return
    updated = 0
    for qid, old, new, new_ans in changes:
        cur.execute('UPDATE questions SET options = %s::jsonb, correct_answer = %s WHERE id = %s AND options = %s::jsonb',
                    (json.dumps(new), new_ans, qid, json.dumps(old)))
        updated += cur.rowcount
    if updated != len(changes):
        conn.rollback(); sys.exit(f'expected {len(changes)} updates, got {updated} — rolled back')
    conn.commit()
    print(f'applied: {updated} questions reordered')


if __name__ == '__main__':
    main()
