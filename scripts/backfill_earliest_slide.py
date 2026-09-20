"""
backfill_earliest_slide.py

Fills questions.earliest_slide — the first slide_number at which a question
becomes answerable.

Why it matters (two jobs, one column)
-------------------------------------
1. Checkpoint gating (backlog #102): an in-lesson practice question must not be
   offered before the lesson has taught the answer.
2. Exam review (2026-09-20): the "Watch a lesson on this" link in the exam
   debrief opens the lesson AT this slide instead of at slide 1. Objectives run
   a median of 26 slides and up to 101, so without it "review the material"
   means "start at the top and hunt" — which is exactly what a student asked
   about.

State when this was written: 4,357 of 9,457 placed. 4A and 4B had NONE — 3,259
of the 5,100 gaps — because the original deterministic pass never ran on 4th
class. The other 1,841 are leftovers it could not match.

How it places a question
------------------------
`deterministic` mode ranks the lesson's own chunks against the question using
Postgres full-text search, weighting the CORRECT ANSWER text most heavily: the
answer is the best available signal for where the thing being tested is
actually taught. Among chunks scoring near the best match it takes the LOWEST
slide_number, so the value is the first slide that teaches the concept rather
than a later recap.

Navigational chunks (title, intro) are excluded — landing a student on a title
card teaches nothing, and gating a question behind one gates nothing.

`llm` mode handles what full text cannot: questions whose answer is a
calculation or a rephrasing that shares no vocabulary with the slide. It sends
the slide list (number, title, trimmed body) and asks for the first slide that
teaches what the question tests.

Safety
------
Dry run by default. Only ever fills rows where earliest_slide IS NULL — an
existing placement, however it was made, is never overwritten. Every write
records earliest_slide_source so a bad batch can be reverted wholesale:

    UPDATE questions SET earliest_slide = NULL, earliest_slide_source = NULL
     WHERE earliest_slide_source = 'deterministic_v2';

Usage:
  python3 scripts/backfill_earliest_slide.py --mode deterministic
  python3 scripts/backfill_earliest_slide.py --mode deterministic --apply
  python3 scripts/backfill_earliest_slide.py --mode deterministic --paper 4A --apply
  python3 scripts/backfill_earliest_slide.py --mode llm --apply
"""

import argparse
import json
import os
import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import psycopg2
import psycopg2.extras

SCRIPT_DIR = Path(__file__).parent
DOTENV_PATHS = [SCRIPT_DIR.parent.parent / ".env.shared",
                SCRIPT_DIR.parent / ".env"]
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Chunks that carry no teaching. A question gated behind a title card is not
# gated, and a student sent to one to "review the material" learns nothing.
NON_TEACHING_TYPES = ("title", "intro")

# Keep any chunk scoring at least this fraction of the best score, then take the
# earliest of them: the goal is the FIRST slide that teaches the concept, not
# the one matching the question's wording most closely.
#
# 0.80 was measured, not guessed. Replaying this placement against the 4,321
# questions the original pass already placed, and sweeping the ratio:
#
#   ratio   exact   within 3   mean delta   >3 early   >3 late
#   0.55     34%      63%         -3.0        120        29
#   0.70     39%      68%         -0.7         78        51
#   0.80     39%      73%         +0.8         43        64
#   0.90     38%      74%         +1.6         28        78
#   1.00     35%      70%         +2.6         22        99
#
# A loose floor drags placements systematically early, which is precisely the
# failure #102 was opened for — a question offered before the lesson teaches it.
# 0.80 is the point where the bias crosses zero.
RANK_FLOOR_RATIO = 0.80

SOURCE_TAG = {"deterministic": "deterministic_v2", "llm": "llm_v2"}


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
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


def fetch_unplaced(conn, paper: str | None, limit: int | None) -> list[dict]:
    cur = conn.cursor()
    sql = """
        SELECT id, lesson_code, question_text, options, correct_answer, topic
          FROM questions
         WHERE earliest_slide IS NULL
           AND lesson_code IS NOT NULL
    """
    params: list = []
    if paper:
        sql += " AND lesson_code LIKE %s"
        params.append(f"{paper}-%")
    sql += " ORDER BY id"
    if limit:
        sql += " LIMIT %s"
        params.append(limit)
    cur.execute(sql, params)
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    return rows


def fetch_chunks(conn, lesson_codes: set[str]) -> dict[str, list[dict]]:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT lesson_code, slide_number, chunk_type, title, body
          FROM lesson_chunks
         WHERE lesson_code = ANY(%s)
         ORDER BY lesson_code, slide_number
        """,
        (list(lesson_codes),),
    )
    out: dict[str, list[dict]] = {}
    for r in cur.fetchall():
        out.setdefault(r["lesson_code"], []).append(dict(r))
    cur.close()
    return out


# Words that match everything and therefore locate nothing.
STOP = set("""
the a an and or of to in on for with is are was were be been being that this these those
what which who whom whose when where why how it its as at by from into than then there
following best describes primary main purpose reason result correct answer question
above below all none both either neither not only most least such very more less
""".split())

TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9\-]{2,}")


def query_terms(question: dict) -> list[str]:
    """Search terms, correct-answer first.

    The correct option is the strongest signal available for where the tested
    idea is taught — far better than the question stem, which is often generic
    scaffolding ("which of the following best describes...").
    """
    options = question.get("options") or []
    idx = question.get("correct_answer")
    answer = ""
    if isinstance(idx, int) and 0 <= idx < len(options):
        answer = str(options[idx])

    terms: list[str] = []
    for source, weight in ((answer, 3), (question.get("topic") or "", 2),
                           (question.get("question_text") or "", 1)):
        seen = set()
        for tok in TOKEN.findall(source):
            low = tok.lower()
            if low in STOP or low in seen:
                continue
            seen.add(low)
            terms.extend([low] * weight)
    return terms


def place_deterministic(conn, question: dict) -> tuple[int | None, str]:
    terms = query_terms(question)
    if not terms:
        return None, "no usable search terms"

    # websearch_to_tsquery treats the terms as an OR-ish bag and never raises on
    # punctuation, unlike to_tsquery — question text is full of it.
    query = " or ".join(dict.fromkeys(terms))

    cur = conn.cursor()
    cur.execute(
        """
        WITH scored AS (
          SELECT slide_number,
                 ts_rank(
                   to_tsvector('english',
                     coalesce(title,'') || ' ' || coalesce(body,'') || ' ' || coalesce(narration,'')),
                   websearch_to_tsquery('english', %s)
                 ) AS rank
            FROM lesson_chunks
           WHERE lesson_code = %s
             AND coalesce(chunk_type,'') <> ALL(%s)
        )
        SELECT slide_number, rank FROM scored WHERE rank > 0 ORDER BY rank DESC
        """,
        (query, question["lesson_code"], list(NON_TEACHING_TYPES)),
    )
    rows = cur.fetchall()
    cur.close()

    if not rows:
        return None, "no chunk matched"

    best = rows[0]["rank"]
    floor = best * RANK_FLOOR_RATIO
    candidates = [r["slide_number"] for r in rows if r["rank"] >= floor]
    return min(candidates), ""


LLM_SYSTEM = """You are placing a practice question against the slides of the lesson it belongs to.

Given a question and the lesson's slides in order, identify the FIRST slide at which a student has been taught enough to answer the question. That is the slide that introduces the needed idea, formula or fact — not a later slide that reuses it, and not an earlier slide that merely mentions the words.

Output ONLY a JSON object, no markdown fences:
{"slide_number": <integer from the list>, "confidence": "high"|"low"}

Use "low" confidence if the lesson does not appear to teach what the question asks."""


def place_llm(client, question: dict, chunks: list[dict], model: str) -> tuple[int | None, str]:
    options = question.get("options") or []
    idx = question.get("correct_answer")
    answer = str(options[idx]) if isinstance(idx, int) and 0 <= idx < len(options) else ""

    teaching = [c for c in chunks if (c.get("chunk_type") or "") not in NON_TEACHING_TYPES]
    if not teaching:
        return None, "lesson has no teaching slides"

    listing = "\n".join(
        f"  slide {c['slide_number']}: {(c.get('title') or '').strip()[:80]} — "
        f"{(c.get('body') or '').strip()[:220]}"
        for c in teaching
    )[:14000]

    user = (
        f"=== LESSON SLIDES ({question['lesson_code']}) ===\n{listing}\n\n"
        f"=== QUESTION ===\n{question['question_text']}\n\n"
        f"Correct answer: {answer}"
    )

    raw = (client.chat.completions.create(
        model=model, max_tokens=150,
        messages=[{"role": "system", "content": LLM_SYSTEM},
                  {"role": "user", "content": user}],
    ).choices[0].message.content or "").strip()

    if raw.startswith("```"):
        lines = raw.splitlines()
        end = len(lines) - 1 if lines[-1].strip() == "```" else len(lines)
        raw = "\n".join(lines[1:end]).strip()

    try:
        data = json.loads(raw)
        slide = int(data["slide_number"])
    except (json.JSONDecodeError, KeyError, ValueError, TypeError):
        return None, f"unparseable: {raw[:60]}"

    valid = {c["slide_number"] for c in teaching}
    if slide not in valid:
        # A hallucinated number would gate a question behind a slide that does
        # not exist, or open the review player at nothing.
        return None, f"slide {slide} not in this lesson"
    if str(data.get("confidence", "low")).lower() != "high":
        return None, "low confidence"
    return slide, ""


def main():
    for p in DOTENV_PATHS:
        load_dotenv(p)

    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["deterministic", "llm"], required=True)
    parser.add_argument("--paper", default=None)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--model", default=None)
    args = parser.parse_args()

    conn = get_conn()
    questions = fetch_unplaced(conn, args.paper, args.limit)
    db = os.environ.get("POSTGRES_DB", "?")
    print(f"{len(questions)} unplaced question(s) in '{db}'"
          f"{' for ' + args.paper if args.paper else ''}, mode={args.mode}")
    if not questions:
        conn.close()
        return

    chunks = fetch_chunks(conn, {q["lesson_code"] for q in questions})
    placed: list[tuple[int, int]] = []
    skipped = Counter()

    if args.mode == "deterministic":
        for q in questions:
            if q["lesson_code"] not in chunks:
                skipped["lesson has no slides"] += 1
                continue
            slide, why = place_deterministic(conn, q)
            if slide is None:
                skipped[why] += 1
            else:
                placed.append((q["id"], slide))
    else:
        from openai import OpenAI
        api_key = os.getenv("OPENROUTER_API_KEY")
        model = args.model or os.getenv("OPENROUTER_MODEL")
        if not api_key or not model:
            print("ERROR: OPENROUTER_API_KEY and OPENROUTER_MODEL required", file=sys.stderr)
            sys.exit(1)
        client = OpenAI(api_key=api_key, base_url=OPENROUTER_BASE_URL)

        done = 0
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {
                pool.submit(place_llm, client, q, chunks.get(q["lesson_code"], []), model): q
                for q in questions
            }
            for fut in as_completed(futures):
                q = futures[fut]
                try:
                    slide, why = fut.result()
                except Exception as exc:
                    slide, why = None, str(exc)[:60]
                if slide is None:
                    skipped[why] += 1
                else:
                    placed.append((q["id"], slide))
                done += 1
                if done % 100 == 0 or done == len(questions):
                    print(f"  placed {done}/{len(questions)}", flush=True)

    print(f"\n  would place: {len(placed)}   skipped: {sum(skipped.values())}")
    for reason, n in skipped.most_common(8):
        print(f"    {n:5d}  {reason}")

    if placed:
        print("\n  sample:")
        for qid, slide in placed[:8]:
            q = next(x for x in questions if x["id"] == qid)
            lo = min(c["slide_number"] for c in chunks[q["lesson_code"]])
            hi = max(c["slide_number"] for c in chunks[q["lesson_code"]])
            print(f"    q{qid} {q['lesson_code']}: slide {slide} (lesson spans {lo}..{hi})")

    if not args.apply:
        print(f"\n  DRY RUN — nothing written. Re-run with --apply.")
        conn.close()
        return

    cur = conn.cursor()
    tag = SOURCE_TAG[args.mode]
    for qid, slide in placed:
        cur.execute(
            """UPDATE questions
                  SET earliest_slide = %s, earliest_slide_source = %s
                WHERE id = %s AND earliest_slide IS NULL""",
            (slide, tag, qid),
        )
    conn.commit()
    cur.close()
    conn.close()
    print(f"\n  APPLIED {len(placed)} placement(s), source='{tag}'.")


if __name__ == "__main__":
    main()
