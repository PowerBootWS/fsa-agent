"""
fix_latex_formulas.py

One-time script to repair malformed LaTeX delimiters in the questions table.

Fixes the double-wrap artefact where AI-generated content contains patterns
like $$t = $\frac{5 P L}{4.8 S}$$$ (inner $ delimiters inside a $$ block).

Usage:
  python3 scripts/fix_latex_formulas.py           # preview changes (dry run)
  python3 scripts/fix_latex_formulas.py --apply   # write changes to DB
"""

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))

# Split config (env-split Step 8). NOTE: .env.shared carries the *container*
# Postgres coordinates (POSTGRES_HOST=postgres). This script runs on the host,
# where that name does not resolve — export POSTGRES_HOST=localhost and
# POSTGRES_PORT=5434 when running it, exactly as before this change.
for _env in (Path("/home/debian/.env.shared"),
             SCRIPT_DIR.parent / ".env"):
    if _env.exists():
        load_dotenv(_env, override=True)

import db_inserter  # noqa: E402
from latex_utils import sanitize_question  # noqa: E402


def fix_questions(apply: bool) -> None:
    conn = db_inserter.get_connection()
    cur = conn.cursor()

    cur.execute(
        "SELECT id, question_text, options, explanation FROM questions ORDER BY id"
    )
    rows = cur.fetchall()

    scanned = 0
    changed = 0

    for row in rows:
        scanned += 1
        qid = row['id']

        # Build a mutable copy of the fields we care about.
        q = {
            'question_text': row['question_text'] or '',
            'options': row['options'] if isinstance(row['options'], list) else json.loads(row['options'] or '[]'),
            'explanation': row['explanation'] or '',
        }

        original = json.dumps(q, ensure_ascii=False)
        sanitize_question(q)
        updated = json.dumps(q, ensure_ascii=False)

        if updated == original:
            continue

        changed += 1

        if not apply:
            print(f"\n[DRY RUN] id={qid}")
            if q['question_text'] != (row['question_text'] or ''):
                print(f"  question_text BEFORE: {row['question_text'][:120]}")
                print(f"  question_text AFTER : {q['question_text'][:120]}")
            for i, (before, after) in enumerate(zip(
                row['options'] if isinstance(row['options'], list) else json.loads(row['options'] or '[]'),
                q['options']
            )):
                if before != after:
                    print(f"  option[{i}] BEFORE: {before[:120]}")
                    print(f"  option[{i}] AFTER : {after[:120]}")
            if q['explanation'] != (row['explanation'] or ''):
                print(f"  explanation BEFORE: {row['explanation'][:120]}")
                print(f"  explanation AFTER : {q['explanation'][:120]}")
        else:
            cur.execute(
                """
                UPDATE questions
                SET question_text = %s,
                    options       = %s,
                    explanation   = %s
                WHERE id = %s
                """,
                (
                    q['question_text'],
                    json.dumps(q['options']),
                    q['explanation'],
                    qid,
                ),
            )

    if apply:
        conn.commit()

    conn.close()

    mode = "Applied" if apply else "Dry run"
    print(f"\n{mode}: {scanned} rows scanned, {changed} rows {'updated' if apply else 'would be updated'}.")
    if not apply and changed:
        print("Re-run with --apply to write changes.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Fix malformed LaTeX in questions table")
    parser.add_argument('--apply', action='store_true', help='Write fixes to DB (default is dry run)')
    args = parser.parse_args()
    fix_questions(apply=args.apply)


if __name__ == '__main__':
    main()
