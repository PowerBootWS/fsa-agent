"""
shuffle_question_options.py

Redistributes which position holds the correct answer across the question bank.

Why this exists
---------------
Every question in the bank has exactly 4 options. As of 2026-09-19 the correct
answer sat at:

    A  2357  24.9%
    B  4335  45.8%
    C  2512  26.6%
    D   253   2.7%

Answering B every time scores 46% without reading the question, and D is
effectively never right. That is an artifact of how the questions were
generated — a model writing a question tends to put the real answer second or
third and pad the end with obvious filler — and students feel it long before
they could articulate it. A bank that can be beaten by position is not
measuring what we are charging people to measure.

Design
------
The permutation is seeded on the question id, so it is stable: the same
question always renders its options in the same order, on every appearance and
on every machine. Russ's requirement was specifically that a question must not
reshuffle under a student who is seeing it a second time — only that positions
are spread out *across* questions.

Skipped questions
-----------------
A question is left alone when any option refers to another option or to a
position ("all of the above", "both A and B", "none of the above"), or when the
explanation names a position, because moving the options would make that text
wrong. These are reported, not silently passed over.

Run this AFTER `repair_questions.py --mode verify --apply`. The verify report
stores indices into the current option order, so shuffling first would make
those corrections point at the wrong options.

Usage:
  python3 scripts/shuffle_question_options.py                 # dry run
  python3 scripts/shuffle_question_options.py --apply
  python3 scripts/shuffle_question_options.py --paper 3A1 --apply
"""

import argparse
import json
import os
import random
import re
import sys
from collections import Counter
from pathlib import Path

import psycopg2

SCRIPT_DIR = Path(__file__).parent
DOTENV_PATHS = [SCRIPT_DIR.parent.parent / ".env.shared",
                SCRIPT_DIR.parent / ".env"]

# An option that talks about the other options cannot be moved.
POSITIONAL_OPTION = re.compile(
    r"\b(all|none|both|either|neither)\s+of\s+the\s+(above|below|these|options)\b"
    r"|\b(a|b|c|d)\s+and\s+(a|b|c|d)\b"
    r"|\bboth\s+\(?[abcd]\)?\s+and\s+\(?[abcd]\)?\b"
    r"|\b(the\s+)?(first|second|third|fourth|last)\s+(option|answer|choice)\b",
    re.IGNORECASE,
)

# An explanation that names a position stops being true once options move.
POSITIONAL_EXPLANATION = re.compile(
    r"\boption\s+\(?[abcd1-4]\)?\b"
    r"|\banswer\s+\(?[abcd]\)?\b"
    r"|\bchoice\s+\(?[abcd]\)?\b"
    r"|\b(the\s+)?(first|second|third|fourth|last)\s+(option|answer|choice)\b",
    re.IGNORECASE,
)


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def get_conn():
    return psycopg2.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=int(os.environ.get("POSTGRES_PORT", "5432")),
        dbname=os.environ.get("POSTGRES_DB", "fsa_agent"),
        user=os.environ.get("POSTGRES_USER", "postgres"),
        password=os.environ.get("POSTGRES_PASSWORD", ""),
    )


def should_skip(options, explanation) -> str | None:
    for opt in options:
        if POSITIONAL_OPTION.search(str(opt)):
            return f"option refers to another option: {str(opt)[:60]}"
    if explanation and POSITIONAL_EXPLANATION.search(str(explanation)):
        return "explanation names a position"
    return None


def permutation_for(qid: int, n: int) -> list[int]:
    """A stable permutation for this question. Seeded on the id alone, so it
    survives re-runs, other databases and a restore from backup."""
    order = list(range(n))
    random.Random(qid).shuffle(order)
    return order


def main():
    for p in DOTENV_PATHS:
        load_dotenv(p)

    parser = argparse.ArgumentParser()
    parser.add_argument("--paper", default=None)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    conn = get_conn()
    cur = conn.cursor()
    if args.paper:
        cur.execute(
            "SELECT id, options, correct_answer, explanation FROM questions "
            "WHERE lesson_code LIKE %s AND correct_answer >= 0 ORDER BY id",
            (f"{args.paper}-%",))
    else:
        cur.execute(
            "SELECT id, options, correct_answer, explanation FROM questions "
            "WHERE correct_answer >= 0 ORDER BY id")
    rows = cur.fetchall()

    db = os.environ.get("POSTGRES_DB", "?")
    print(f"{len(rows)} question(s) in database '{db}'"
          f"{' for ' + args.paper if args.paper else ''}")

    before = Counter()
    after = Counter()
    skipped = []
    updates = []

    for qid, options, correct, explanation in rows:
        before[correct] += 1
        reason = should_skip(options, explanation)
        if reason:
            skipped.append((qid, reason))
            after[correct] += 1
            continue

        order = permutation_for(qid, len(options))
        new_options = [options[i] for i in order]
        new_correct = order.index(correct)
        after[new_correct] += 1
        if new_options != list(options):
            updates.append((qid, new_options, new_correct))

    letters = "ABCD"
    print("\n  position of the correct answer")
    print("        before          after")
    total = len(rows)
    for i in range(4):
        print(f"    {letters[i]}  {before[i]:5d} {100*before[i]/total:5.1f}%   "
              f"{after[i]:5d} {100*after[i]/total:5.1f}%")

    print(f"\n  {len(updates)} question(s) to reorder, {len(skipped)} skipped")
    for qid, reason in skipped[:20]:
        print(f"    skip {qid}: {reason}")
    if len(skipped) > 20:
        print(f"    ... and {len(skipped) - 20} more")

    if not args.apply:
        print("\n  DRY RUN — nothing written. Re-run with --apply.")
        cur.close(); conn.close()
        return

    for qid, new_options, new_correct in updates:
        cur.execute(
            "UPDATE questions SET options = %s, correct_answer = %s WHERE id = %s",
            (json.dumps(new_options), new_correct, qid))
    conn.commit()
    print(f"\n  APPLIED to {len(updates)} question(s).")
    cur.close(); conn.close()


if __name__ == "__main__":
    main()
