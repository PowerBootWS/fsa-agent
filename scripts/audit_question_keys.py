#!/usr/bin/env python3
"""Audit the question bank for answer-key defects. READ-ONLY.

Written 2026-08-17 after a student reported, on the free 2A2 practice exam,
that several calculation questions marked his correct choice wrong while the
explanation below the question agreed with him, and that on others the right
answer was in none of the four options. 79 defective questions were found.

The generator's failure mode: it writes four plausible options first, then
writes a worked solution that lands on a different number, and nothing ever
reconciles the key. The tell is an explanation that *argues for* an answer
("closest to", "not among the options", "Wait, recalc") instead of deriving it.

  KEY_MISMATCH     the explanation derives a value equal to a NON-keyed option
  KEY_NOT_DERIVED  the keyed option's value appears nowhere in the working
  SELF_CONFESSED   the explanation admits it could not reach any option
  KEY_OUT_OF_RANGE correct_answer >= len(options): unanswerable by anyone

Run this over any newly generated bank BEFORE it reaches a student.

  POSTGRES_PASSWORD=... python3 scripts/audit_question_keys.py
  POSTGRES_PASSWORD=... python3 scripts/audit_question_keys.py --detail ALL
  POSTGRES_PASSWORD=... python3 scripts/audit_question_keys.py --detail 2A2 KEY_MISMATCH
  POSTGRES_PASSWORD=... python3 scripts/audit_question_keys.py --ids

Known blind spots, each found the hard way:
  - Questions whose four options do not all reduce to a distinct number are
    only checked for confessional language, never for a key/working mismatch.
    Options that repeat a value with a different qualifier ("80 km/h south" vs
    "80 km/h, no direction specified") are skipped entirely for the same
    reason, and one such question (id 10817) had a genuinely wrong key.
  - It cannot detect a question with TWO defensible answers; that has to be
    read by a human or an agent.

Defaults to localhost:5434 (fsa-postgres as seen from the host) and database
fsa_agent. Override with PGHOST / PGPORT / PGDATABASE. Note that a bare
localhost:5432 on this host is a DIFFERENT business's database.
"""
import re, json, sys, os
import psycopg2, psycopg2.extras

NUM = re.compile(r'-?\d[\d,]*\.?\d*')
# An option that is essentially "a number with an optional unit"
NUMERIC_OPT = re.compile(
    r'^[~≈about\s]*-?\d[\d,]*\.?\d*\s*'
    r'(%|[A-Za-z°·/³²µΩ%\.\s\-]{0,18})$'
)
# Where an explanation stops deriving the answer and starts explaining the
# wrong options. Numbers after this point are distractor values, not results.
DISTRACTOR_CUE = re.compile(
    r'distractor|option\s+[A-D]\b|comes? from|results?\s+from|omits?\b|'
    r'the error of|choosing\b|a result of|incorrectly|in error|'
    r'common (mistake|error)|forgett?ing|ignores?\b|misplaces?\b|'
    r'inverting|would give|if you\b|students who',
    re.I,
)
CONFESS = re.compile(
    r'not (among|an|one of|in) the (option|choice)|not among options|'
    r'none of the (given )?(option|choice)|no option matches|'
    r'closest (option|answer|value|match|to)|nearest option|'
    r'wait,?\s*recalc|let\'s recalc|recalc carefully|this doe?s not|'
    r'plausible distractor|distractor calculation|mis-?step|'
    r'a plausible student error|meaningless number',
    re.I,
)


def normalize(s):
    """Make numbers comparable across the notations these questions mix:
    unicode minus, LaTeX thin-space / brace thousands separators, and space-
    or comma-grouped thousands."""
    s = str(s)
    s = s.replace('{,}', '').replace('{}', '')
    # a dash between two digits is a RANGE (280-300), never a minus sign
    s = re.sub(r'(?<=\d)\s*[–—]\s*(?=\d)', ' to ', s)
    s = s.replace('−', '-').replace('–', '-').replace('—', '-')
    s = s.replace('\\ ', '')          # LaTeX escaped space: 79\ 526
    s = s.replace('\\,', '').replace('\\;', '').replace(' ', ' ')
    s = s.replace(' ', ' ').replace(' ', ' ')
    s = re.sub(r'(?<=\d)[ ,](?=\d{3}(?!\d))', '', s)
    return s


def nums(s):
    out = []
    for m in NUM.finditer(normalize(s)):
        try:
            out.append(float(m.group().replace(',', '')))
        except ValueError:
            pass
    return out


def is_numeric_option(t):
    """An option that is a bare quantity: leading number plus a short unit."""
    t = str(t).strip().rstrip('.')
    if len(t) > 40 or len(t.split()) > 6:
        return False
    if not re.match(r'^[~≈$\s]*[-+]?\d', t):
        return False
    # reject prose that merely starts with a number
    return not re.search(r'\b(the|of|is|are|that|which|and|because|when)\b', t, re.I)


def opt_value(opt):
    m = NUM.search(normalize(opt).replace(',', ''))
    if not m:
        return None
    try:
        return float(m.group())
    except ValueError:
        return None


def close(a, b, tol):
    if a is None or b is None:
        return False
    if a == b:
        return True
    if b == 0:
        return abs(a) < 1e-9
    return abs(a - b) / abs(b) <= tol


TOL = 0.002  # 0.2% - tight enough to separate adjacent distractors

conn = psycopg2.connect(
    host=os.environ.get('PGHOST', 'localhost'),
    port=int(os.environ.get('PGPORT', 5434)),
    user='postgres',
    password=os.environ.get('PGPASSWORD') or os.environ['POSTGRES_PASSWORD'],
    dbname=os.environ.get('PGDATABASE', 'fsa_agent'),
)
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
cur.execute("""SELECT id, course_id, chapter_id, question_text, options,
                      correct_answer, explanation
               FROM questions
               WHERE options IS NOT NULL AND jsonb_array_length(options) = 4
               ORDER BY course_id, id""")
rows = cur.fetchall()

findings = []
numeric_total = 0
confessed_total = 0

for r in rows:
    opts = r['options']
    if isinstance(opts, str):
        opts = json.loads(opts)
    expl = r['explanation'] or ''

    confessed = bool(CONFESS.search(expl))

    if not all(is_numeric_option(o) for o in opts):
        if confessed:
            findings.append((r, 'SELF_CONFESSED', None))
            confessed_total += 1
        continue

    vals = [opt_value(o) for o in opts]
    if any(v is None for v in vals) or len(set(vals)) < 4:
        continue
    numeric_total += 1

    enums = nums(expl)
    key = r['correct_answer']
    keyval = vals[key] if 0 <= key < len(vals) else None
    if keyval is None:
        findings.append((r, 'KEY_OUT_OF_RANGE', None))
        continue

    if not enums:
        continue

    # High-precision test: a sound worked solution always *states* the value it
    # is keying. If the keyed option's number appears nowhere in the working,
    # the key and the explanation disagree.
    key_mentioned = any(close(e, keyval, TOL) for e in enums)

    other_shown = [
        i for i, v in enumerate(vals)
        if i != key and any(close(e, v, TOL) for e in enums)
    ]

    if not key_mentioned and other_shown:
        # the explanation derives a DIFFERENT option than the one keyed
        findings.append((r, 'KEY_MISMATCH', other_shown[-1]))
    elif not key_mentioned:
        # the explanation derives a value that is not any of the four options
        findings.append((r, 'KEY_NOT_DERIVED', None))
    elif confessed:
        findings.append((r, 'SELF_CONFESSED', None))
        confessed_total += 1

print(f"four-option questions: {len(rows)}   pure-numeric MCQs: {numeric_total}")

by_course = {}
for r, kind, other in findings:
    by_course.setdefault(r['course_id'], {}).setdefault(kind, []).append((r, other))

print("\n=== SUMMARY (suspect questions) ===")
grand = {}
for c in sorted(by_course):
    parts = ", ".join(f"{k}={len(v)}" for k, v in sorted(by_course[c].items()))
    tot = sum(len(v) for v in by_course[c].values())
    print(f"{c}: {tot:4d}   ({parts})")
    for k, v in by_course[c].items():
        grand[k] = grand.get(k, 0) + len(v)
print(f"TOTAL: {sum(grand.values())}   {grand}")

if len(sys.argv) > 1 and sys.argv[1] == '--detail':
    course_filter = sys.argv[2] if len(sys.argv) > 2 else None
    kind_filter = sys.argv[3] if len(sys.argv) > 3 else None
    print("\n=== DETAIL ===")
    for r, kind, other in findings:
        if course_filter and course_filter != 'ALL' and r['course_id'] != course_filter:
            continue
        if kind_filter and kind != kind_filter:
            continue
        opts = r['options']
        if isinstance(opts, str):
            opts = json.loads(opts)
        print(f"\n[{kind}] id={r['id']} {r['course_id']} {r['chapter_id']}")
        print(f"  Q: {r['question_text'][:170]}")
        for i, o in enumerate(opts):
            mark = ' <-KEY' if i == r['correct_answer'] else ''
            mark += ' <-EXPL' if other == i else ''
            print(f"    {chr(65+i)}. {o}{mark}")
        print(f"  EXPL: {(r['explanation'] or '')[:350]}")

if len(sys.argv) > 1 and sys.argv[1] == '--ids':
    print("\n".join(str(r['id']) for r, k, o in findings))
