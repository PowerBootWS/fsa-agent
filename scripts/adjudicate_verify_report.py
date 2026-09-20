"""
adjudicate_verify_report.py

Second gate on the mismatches from `repair_questions.py --mode verify`.

Why this is needed
------------------
The verify pass is reliable for gross errors. It found chapter 2B3-2, where the
key pointed at things like "dynamic braking = a mechanical friction brake is
applied to the motor shaft" — wrong in a way nobody could argue with.

It is NOT reliable for the marginal tail. Of the 220 mismatches it reported
across the full bank on 2026-09-19, a hand check of 8 found roughly half were
real catches (a relative density keyed as 8.52 when the arithmetic gives 0.852),
one was a clear false positive (ASME UG-116 really does require the code symbol
and serial number to be stamped — the model's "correction" was wrong), and the
rest were judgment calls that could not be settled from general knowledge.

Applying all 220 on the model's word would fix perhaps 130 questions and break
perhaps 90. That is worse than doing nothing, and it would be invisible damage:
freshly mis-keyed questions in chapters nobody is watching.

What this does
--------------
Re-grades each mismatch against the lesson content the question was generated
from. That is the actual authority — the question exists to test that material,
so the correct option must be traceable to it. A correction is only marked
`apply` when the grounded pass independently lands on the same option the
verify pass proposed AND cites the passage supporting it.

Everything else is marked `review`: not wrong, just not something a model should
be allowed to decide alone. Papers 4A, 4B, 3B2 and part of 3B1 have no
aggregated lesson content at all, so their mismatches always land in `review`.

Usage:
  python3 scripts/adjudicate_verify_report.py docs/verify/full-bank-20260919.json
  python3 scripts/adjudicate_verify_report.py <report> --apply
"""

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import psycopg2
from openai import OpenAI

SCRIPT_DIR = Path(__file__).parent
DOTENV_PATHS = [SCRIPT_DIR.parent.parent / ".env.shared",
                SCRIPT_DIR.parent / ".env"]
AGGREGATED_PATH = SCRIPT_DIR.parent / "docs" / "source" / "lesson_content_aggregated.json"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

LETTERS = ["A", "B", "C", "D"]

ADJUDICATE_SYSTEM = """You are checking the answer key of a multiple-choice question against the lesson material the question was written from.

The lesson content is the authority. The question exists to test that material, so the correct option must be supported by it. Do not answer from general knowledge where the lesson content settles the matter, and do not mark an option correct because it sounds more thorough or more technical.

Output ONLY a JSON object, no markdown fences:
{"letter": "A"|"B"|"C"|"D", "evidence": "<short verbatim quote from the lesson content that settles it>", "confidence": "high"|"low"}

Use "low" confidence, and an empty evidence string, if the lesson content does not actually settle which option is correct. That is a normal and useful answer — say it rather than picking the most plausible-looking option."""


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


def fetch_lesson_content(lesson_codes: set[str]) -> dict[str, str]:
    """Lesson text straight from the database.

    This used to read docs/source/lesson_content_aggregated.json, which covers
    669 lessons and stops at 3B1 — so every 4A, 4B and 3B2 mismatch fell through
    to "review" for want of source material, 130 of 220 on the first full-bank
    run. The lessons table has `source_content` populated for all 1,400 lessons
    across every paper, which is the same material the questions were generated
    from and is never stale.

    narration_text is the fallback but is empty for 4A and 4B, so source_content
    has to be the primary.
    """
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT lesson_code, COALESCE(NULLIF(source_content, ''), narration_text) "
        "FROM lessons WHERE lesson_code = ANY(%s)",
        (list(lesson_codes),))
    out = {code: text for code, text in cur.fetchall() if text and len(text) > 200}
    cur.close(); conn.close()
    return out


def adjudicate(client: OpenAI, entry: dict, lesson_text: str, model: str) -> dict:
    options = entry["options"]
    shown = "\n".join(f"  {LETTERS[i]}. {opt}" for i, opt in enumerate(options))
    user = (
        f"=== LESSON CONTENT ===\n{lesson_text[:12000]}\n\n"
        f"=== QUESTION ===\n{entry['question_text']}\n\n"
        f"Options:\n{shown}"
    )
    raw = (client.chat.completions.create(
        model=model, max_tokens=500,
        messages=[{"role": "system", "content": ADJUDICATE_SYSTEM},
                  {"role": "user", "content": user}],
    ).choices[0].message.content or "").strip()

    if raw.startswith("```"):
        lines = raw.splitlines()
        end = len(lines) - 1 if lines[-1].strip() == "```" else len(lines)
        raw = "\n".join(lines[1:end]).strip()

    try:
        data = json.loads(raw)
        idx = LETTERS.index(str(data["letter"]).strip().upper())
    except (json.JSONDecodeError, KeyError, ValueError, TypeError):
        return {"grounded": None, "evidence": "", "confidence": "low",
                "note": f"unparseable: {raw[:80]}"}

    return {
        "grounded": idx,
        "evidence": str(data.get("evidence", ""))[:400],
        "confidence": str(data.get("confidence", "low")).lower(),
        "note": "",
    }


def main():
    for p in DOTENV_PATHS:
        load_dotenv(p)

    parser = argparse.ArgumentParser()
    parser.add_argument("report")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--model", default=None)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--out", default=None)
    parser.add_argument("--review-verdicts", action="store_true", dest="review_verdicts",
                        help="also re-adjudicate entries an earlier run left as review")
    args = parser.parse_args()

    api_key = os.getenv("OPENROUTER_API_KEY")
    model = args.model or os.getenv("OPENROUTER_MODEL")
    if not api_key or not model:
        print("ERROR: OPENROUTER_API_KEY and OPENROUTER_MODEL required", file=sys.stderr)
        sys.exit(1)
    client = OpenAI(api_key=api_key, base_url=OPENROUTER_BASE_URL)

    report = json.loads(Path(args.report).read_text())
    mismatches = [r for r in report if r.get("status") == "mismatch"
                  or (args.review_verdicts and r.get("verdict") == "review")]
    aggregated = fetch_lesson_content({m["lesson_code"] for m in mismatches})

    grounded_set = [m for m in mismatches if m["lesson_code"] in aggregated]
    ungrounded = [m for m in mismatches if m["lesson_code"] not in aggregated]

    print(f"{len(mismatches)} mismatch(es): {len(grounded_set)} with lesson content, "
          f"{len(ungrounded)} without (always 'review')")

    results = []
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(adjudicate, client, m,
                        aggregated[m["lesson_code"]], model): m
            for m in grounded_set
        }
        for fut in as_completed(futures):
            m = futures[fut]
            try:
                out = fut.result()
            except Exception as exc:
                out = {"grounded": None, "evidence": "", "confidence": "low",
                       "note": str(exc)}
            entry = dict(m)
            entry.update(out)
            # Only a grounded pass that independently lands on the same option
            # the verify pass proposed, with high confidence and a citation,
            # is allowed to be written without a human looking at it.
            entry["verdict"] = (
                "apply"
                if (out["grounded"] == m["proposed"]
                    and out["confidence"] == "high"
                    and out["evidence"].strip())
                else "review"
            )
            results.append(entry)
            done += 1
            if done % 20 == 0 or done == len(grounded_set):
                print(f"  adjudicated {done}/{len(grounded_set)}", flush=True)

    for m in ungrounded:
        entry = dict(m)
        entry.update({"grounded": None, "evidence": "", "confidence": "low",
                      "note": "no aggregated lesson content for this paper",
                      "verdict": "review"})
        results.append(entry)

    results.sort(key=lambda r: r["id"])
    to_apply = [r for r in results if r["verdict"] == "apply"]
    to_review = [r for r in results if r["verdict"] == "review"]

    out_path = Path(args.out) if args.out else Path(args.report).with_name(
        Path(args.report).stem + "-adjudicated.json")
    out_path.write_text(json.dumps(results, indent=2, default=str))

    print(f"\n  apply={len(to_apply)}  review={len(to_review)}")
    print(f"  report: {out_path}")

    if not args.apply:
        print(f"\n  DRY RUN — nothing written. Re-run with --apply to write "
              f"{len(to_apply)} correction(s).")
        return

    conn = get_conn()
    cur = conn.cursor()
    for r in to_apply:
        cur.execute("UPDATE questions SET correct_answer = %s WHERE id = %s",
                    (r["proposed"], r["id"]))
    conn.commit()
    cur.close(); conn.close()
    print(f"\n  APPLIED {len(to_apply)} correction(s). {len(to_review)} left for review.")


if __name__ == "__main__":
    main()
