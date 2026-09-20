"""
repair_questions.py

Fixes two categories of question quality issues:
  1. Reasoning leaks — explanations containing the model's internal monologue
     ("Wait —", "Recalculating", "let me recheck", etc.). The options and
     correct_answer are preserved; only the explanation is rewritten.
  2. Broken questions — where the correct answer does not appear in options,
     or options are factually wrong. The whole question is deleted and
     regenerated from aggregated lesson content.

Usage:
  python3 scripts/repair_questions.py --ids 2940,3001,3017 --mode explain
  python3 scripts/repair_questions.py --ids 3312,3402,3730 --mode regen --paper 3A1
  python3 scripts/repair_questions.py --paper 3A1 --mode explain --auto
"""

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path

import psycopg2
from openai import OpenAI

SCRIPT_DIR = Path(__file__).parent
DOTENV_PATHS = [SCRIPT_DIR.parent.parent / ".env.shared",
                SCRIPT_DIR.parent / ".env"]
AGGREGATED_PATH = SCRIPT_DIR.parent / "docs" / "source" / "lesson_content_aggregated.json"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

LEAK_PATTERNS = ["Wait —", "Wait,", "Recalculating", "recalculate", "Let me recheck",
                 "let me recheck", "re-checking", "re-check", "Reformulating",
                 "Setting correct_answer", "Correction:", "correct_answer should be"]


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


def fetch_by_ids(ids: list[int]) -> list[dict]:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, lesson_code, question_type, difficulty, question_text, options, correct_answer, explanation "
        "FROM questions WHERE id = ANY(%s) ORDER BY id", (ids,)
    )
    rows = cur.fetchall()
    cur.close(); conn.close()
    return [dict(zip(["id","lesson_code","question_type","difficulty","question_text","options","correct_answer","explanation"], r)) for r in rows]


def fetch_leak_questions(paper: str) -> list[dict]:
    conn = get_conn()
    cur = conn.cursor()
    pattern = "|".join(LEAK_PATTERNS)
    cur.execute(
        "SELECT id, lesson_code, question_type, difficulty, question_text, options, correct_answer, explanation "
        "FROM questions WHERE lesson_code LIKE %s AND explanation ~ %s ORDER BY id",
        (f"{paper}-%", "(" + "|".join(LEAK_PATTERNS) + ")")
    )
    rows = cur.fetchall()
    cur.close(); conn.close()
    return [dict(zip(["id","lesson_code","question_type","difficulty","question_text","options","correct_answer","explanation"], r)) for r in rows]


def update_explanation(qid: int, explanation: str) -> None:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("UPDATE questions SET explanation = %s WHERE id = %s", (explanation, qid))
    conn.commit(); cur.close(); conn.close()


def delete_questions(ids: list[int]) -> None:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM questions WHERE id = ANY(%s)", (ids,))
    conn.commit(); cur.close(); conn.close()


EXPLAIN_SYSTEM = """You are an expert exam question writer for Power Engineering certification exams (SOPEEC).

Your task: rewrite the EXPLANATION for a multiple-choice question to be concise, correct, and free of any internal reasoning.

Rules:
- State the correct calculation or reasoning directly. No "Wait", no "Recalculating", no self-correction.
- Identify what mistake leads to each wrong option (distractor analysis).
- Use $...$ for inline math, $$...$$ for display equations. No nested delimiters.
- Maximum 4 sentences. No preamble, no trailing text.
- Output ONLY the explanation string. No JSON, no quotes around it."""


def rewrite_explanation(client: OpenAI, q: dict, model: str) -> str:
    options_display = "\n".join(
        f"  [{i}]{'*' if i == q['correct_answer'] else ' '} {opt}"
        for i, opt in enumerate(q["options"])
    )
    user = (
        f"Question: {q['question_text']}\n\n"
        f"Options (* = correct):\n{options_display}\n\n"
        f"Correct answer index: {q['correct_answer']}\n\n"
        f"Current (flawed) explanation:\n{q['explanation']}\n\n"
        f"Rewrite the explanation cleanly."
    )
    for attempt in range(1, 4):
        raw = (client.chat.completions.create(
            model=model, max_tokens=400,
            messages=[{"role": "system", "content": EXPLAIN_SYSTEM}, {"role": "user", "content": user}],
        ).choices[0].message.content or "").strip()
        if raw:
            return raw
        if attempt < 3:
            time.sleep(1)
    raise RuntimeError("Empty response after 3 attempts")


REGEN_SYSTEM = """You are an expert exam question writer for Power Engineering certification exams (SOPEEC / ABSA).

Generate multiple-choice questions strictly grounded in the provided lesson content.
Rules:
- 4 options, exactly 1 correct.
- Do NOT reference "the lesson", "the video", or equation numbers.
- Use $...$ for inline math, $$...$$ for display. No nested delimiters.
- Distractor sources: wrong formula rearrangement, unit errors, omitting a term, inverting a ratio.
- Output ONLY a valid JSON array. No markdown fences, no preamble.
Each element: {"question_text","options":["","","",""],"correct_answer":0-3,"explanation","difficulty":1-5,"topic","question_type"}"""


def regen_questions(client: OpenAI, lesson_code: str, question_type: str, difficulty: int,
                    aggregated: dict, model: str) -> list[dict]:
    meta = aggregated.get(lesson_code)
    if not meta:
        raise ValueError(f"{lesson_code} not in aggregated content")
    user = (
        f"Lesson: {lesson_code}\n"
        f"Generate 1 question with question_type \"{question_type}\" and difficulty {difficulty}.\n\n"
        f"=== LESSON CONTENT ===\n{meta['combined_text'][:8000]}\n"
    )
    for attempt in range(1, 4):
        raw = (client.chat.completions.create(
            model=model, max_tokens=1200,
            messages=[{"role": "system", "content": REGEN_SYSTEM}, {"role": "user", "content": user}],
        ).choices[0].message.content or "").strip()
        if raw.startswith("```"):
            lines = raw.splitlines()
            end = len(lines)-1 if lines[-1].strip() == "```" else len(lines)
            raw = "\n".join(lines[1:end]).strip()
        try:
            qs = json.loads(raw)
            assert isinstance(qs, list) and len(qs) > 0
            return qs
        except (json.JSONDecodeError, AssertionError) as exc:
            if attempt < 3:
                time.sleep(1)
            else:
                raise RuntimeError(f"Regen parse failed: {exc}") from exc
    return []


def insert_question(lesson_code: str, q: dict) -> None:
    paper = lesson_code.split("-")[0]
    chapter = lesson_code.split("-")[1]
    chapter_id = f"{paper}-{chapter}"
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO questions (lesson_code, chapter_id, course_id, question_text, options, correct_answer, "
        "explanation, difficulty, topic, question_type) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (lesson_code, chapter_id, paper, q["question_text"], json.dumps(q["options"]),
         q["correct_answer"], q["explanation"], q["difficulty"], q.get("topic",""), q["question_type"])
    )
    conn.commit(); cur.close(); conn.close()


# ---------------------------------------------------------------------------
# verify mode — regrade correct_answer against the options themselves.
#
# Added 2026-09-19 after a student reported that chapter 2B3-2 marked the right
# answer wrong. 16 of that chapter's 20 practice questions carried
# correct_answer = 2 while the genuinely correct option sat at index 1: a bulk
# mis-key, invisible to any query because a chapter *can* legitimately cluster
# on one index (4A-6 is 100% index 0 and entirely correct — the calculation
# answer is simply listed first). The only way to find the rest is to grade
# each question against its own options.
#
# Two safety properties, because this mode rewrites answer keys at scale:
#   1. The model is never shown the stored correct_answer. Telling it what we
#      already believe just buys agreement.
#   2. A disagreement is never written on one opinion. It is re-graded with the
#      options in a different order, which also stops the model's own position
#      bias from reproducing the same wrong pick twice. Only a disagreement
#      that survives both passes, consistently, is applied.
# ---------------------------------------------------------------------------

VERIFY_SYSTEM = """You are a SOPEEC Power Engineering examiner checking the answer key of a multiple-choice question.

Exactly one option is correct. Decide which, on the technical merits alone.

Output ONLY a JSON object, no markdown fences:
{"letter": "A"|"B"|"C"|"D", "quote": "<first 6 words of that option, verbatim>", "confidence": "high"|"low"}

Use "low" confidence if more than one option could defensibly be correct, if none are, or if the question is ambiguous or unanswerable as written."""

LETTERS = ["A", "B", "C", "D"]


def _norm(text: str) -> str:
    return " ".join(str(text).lower().split())


def grade_once(client: OpenAI, q: dict, model: str, order: list[int]) -> tuple[int | None, str, str]:
    """Grade one question with options presented in `order`.

    Returns (original_index | None, confidence, note). None means the answer
    could not be resolved and the caller must not write anything.
    """
    shown = [q["options"][i] for i in order]
    options_display = "\n".join(f"  {LETTERS[pos]}. {opt}" for pos, opt in enumerate(shown))
    user = f"Question: {q['question_text']}\n\nOptions:\n{options_display}"

    raw = (client.chat.completions.create(
        model=model, max_tokens=400,
        messages=[{"role": "system", "content": VERIFY_SYSTEM},
                  {"role": "user", "content": user}],
    ).choices[0].message.content or "").strip()

    if raw.startswith("```"):
        lines = raw.splitlines()
        end = len(lines) - 1 if lines[-1].strip() == "```" else len(lines)
        raw = "\n".join(lines[1:end]).strip()

    try:
        data = json.loads(raw)
        pos = LETTERS.index(str(data["letter"]).strip().upper())
    except (json.JSONDecodeError, KeyError, ValueError, TypeError):
        return None, "low", f"unparseable response: {raw[:80]}"

    confidence = str(data.get("confidence", "low")).lower()

    # Cross-check the quote against the option the letter points at. A model
    # that reasons its way to the right option and then emits the wrong letter
    # is the exact failure this mode exists to catch, so catch it here too.
    quote = _norm(data.get("quote", ""))
    if quote and not _norm(shown[pos]).startswith(quote[:40]):
        return None, "low", "letter and quote disagree"

    return order[pos], confidence, ""


def verify_question(client: OpenAI, q: dict, model: str) -> dict:
    """Grade a question, and re-grade under a different option order if the
    first pass disagrees with what is stored."""
    stored = q["correct_answer"]
    result = {"id": q["id"], "lesson_code": q["lesson_code"], "stored": stored,
              "question_text": q["question_text"], "options": q["options"]}

    first, conf1, note1 = grade_once(client, q, model, [0, 1, 2, 3])
    result["pass1"] = first
    result["confidence"] = conf1

    if first is None:
        result["status"] = "unresolved"
        result["note"] = note1
        return result

    if first == stored:
        result["status"] = "agree"
        return result

    # Disagreement: re-grade with the options reversed, so a position-biased
    # pick cannot simply repeat itself.
    second, conf2, note2 = grade_once(client, q, model, [3, 2, 1, 0])
    result["pass2"] = second

    if second is None:
        result["status"] = "unresolved"
        result["note"] = note2
        return result
    if second != first:
        result["status"] = "unstable"
        result["note"] = f"pass1={first} pass2={second}"
        return result

    result["status"] = "mismatch"
    result["proposed"] = first
    result["confidence"] = "low" if "low" in (conf1, conf2) else "high"
    return result


def update_correct_answer(qid: int, index: int) -> None:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("UPDATE questions SET correct_answer = %s WHERE id = %s", (index, qid))
    conn.commit(); cur.close(); conn.close()


def fetch_for_verify(paper: str | None, lesson: str | None, ids: list[int] | None) -> list[dict]:
    cols = ("id, lesson_code, question_type, difficulty, question_text, options, "
            "correct_answer, explanation")
    conn = get_conn()
    cur = conn.cursor()
    if ids:
        cur.execute(f"SELECT {cols} FROM questions WHERE id = ANY(%s) ORDER BY id", (ids,))
    elif lesson:
        cur.execute(
            f"SELECT {cols} FROM questions WHERE lesson_code LIKE %s AND correct_answer >= 0 "
            "ORDER BY id", (f"{lesson}%",))
    elif paper:
        cur.execute(
            f"SELECT {cols} FROM questions WHERE lesson_code LIKE %s AND correct_answer >= 0 "
            "ORDER BY id", (f"{paper}-%",))
    else:
        cur.execute(f"SELECT {cols} FROM questions WHERE correct_answer >= 0 ORDER BY id")
    rows = cur.fetchall()
    cur.close(); conn.close()
    keys = [c.strip() for c in cols.split(",")]
    return [dict(zip(keys, r)) for r in rows]


def run_verify(client: OpenAI, questions: list[dict], model: str, workers: int,
               apply_changes: bool, report_path: Path) -> None:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    results: list[dict] = []
    done = 0
    total = len(questions)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(verify_question, client, q, model): q for q in questions}
        for fut in as_completed(futures):
            q = futures[fut]
            try:
                results.append(fut.result())
            except Exception as exc:
                results.append({"id": q["id"], "lesson_code": q["lesson_code"],
                                "status": "error", "note": str(exc)})
            done += 1
            if done % 25 == 0 or done == total:
                print(f"  graded {done}/{total}", flush=True)

    results.sort(key=lambda r: r["id"])
    counts: dict[str, int] = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1

    mismatches = [r for r in results if r["status"] == "mismatch"]
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(results, indent=2, default=str))

    print(f"\n  agree={counts.get('agree',0)}  mismatch={counts.get('mismatch',0)}  "
          f"unresolved={counts.get('unresolved',0)}  unstable={counts.get('unstable',0)}  "
          f"error={counts.get('error',0)}")
    print(f"  report: {report_path}")

    for r in mismatches:
        opts = r["options"]
        print(f"\n  id={r['id']} {r['lesson_code']}  stored={r['stored']} -> "
              f"proposed={r['proposed']}  ({r['confidence']} confidence)")
        print(f"    Q: {r['question_text'][:110]}")
        print(f"    stored:   [{r['stored']}] {str(opts[r['stored']])[:100]}")
        print(f"    proposed: [{r['proposed']}] {str(opts[r['proposed']])[:100]}")

    if not apply_changes:
        print(f"\n  DRY RUN — nothing written. Re-run with --apply to write "
              f"{len(mismatches)} correction(s).")
        return

    for r in mismatches:
        update_correct_answer(r["id"], r["proposed"])
    print(f"\n  APPLIED {len(mismatches)} correction(s).")


def main():
    for _p in DOTENV_PATHS:
        load_dotenv(_p)
    parser = argparse.ArgumentParser()
    parser.add_argument("--ids", default=None, help="Comma-separated question IDs")
    parser.add_argument("--paper", default=None)
    parser.add_argument("--mode", choices=["explain", "regen", "verify"], required=True)
    parser.add_argument("--auto", action="store_true", help="Auto-find leak questions for --paper")
    parser.add_argument("--model", default=None)
    parser.add_argument("--lesson", default=None, help="verify: lesson_code prefix, e.g. 2B3-2")
    parser.add_argument("--all", action="store_true", help="verify: the entire question bank")
    parser.add_argument("--apply", action="store_true", help="verify: write corrections (default is dry run)")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--report", default=None, help="verify: path for the JSON report")
    parser.add_argument("--apply-report", default=None, dest="apply_report",
                        help="verify: apply the mismatches from an existing report, no re-grading")
    args = parser.parse_args()

    api_key = os.getenv("OPENROUTER_API_KEY")
    model = args.model or os.getenv("OPENROUTER_MODEL")
    if not api_key or not model:
        print("ERROR: OPENROUTER_API_KEY and OPENROUTER_MODEL required", file=sys.stderr)
        sys.exit(1)

    client = OpenAI(api_key=api_key, base_url=OPENROUTER_BASE_URL)

    if args.mode == "verify" and args.apply_report:
        report = json.loads(Path(args.apply_report).read_text())
        mismatches = [r for r in report if r.get("status") == "mismatch"]
        db = os.environ.get("POSTGRES_DB", "?")
        print(f"Applying {len(mismatches)} correction(s) from {args.apply_report} "
              f"to database '{db}'")
        for r in mismatches:
            update_correct_answer(r["id"], r["proposed"])
        print(f"APPLIED {len(mismatches)} correction(s).")
        return

    if args.mode == "verify":
        ids = [int(x.strip()) for x in args.ids.split(",")] if args.ids else None
        if not (ids or args.lesson or args.paper or args.all):
            print("ERROR: verify needs --ids, --lesson, --paper or --all", file=sys.stderr)
            sys.exit(1)
        questions = fetch_for_verify(args.paper, args.lesson, ids)
        scope = args.lesson or args.paper or ("ALL" if args.all else "ids")
        db = os.environ.get("POSTGRES_DB", "?")
        print(f"Verifying {len(questions)} question(s) [{scope}] in database '{db}' "
              f"with {model}")
        stamp = time.strftime("%Y%m%d-%H%M%S")
        default_report = SCRIPT_DIR.parent / "docs" / "verify" / f"verify-{scope.replace('/','_')}-{stamp}.json"
        run_verify(client, questions, model, args.workers, args.apply,
                   Path(args.report) if args.report else default_report)
        return

    if args.auto and args.paper and args.mode == "explain":
        questions = fetch_leak_questions(args.paper)
        print(f"Auto-found {len(questions)} questions with reasoning leaks for {args.paper}")
    elif args.ids:
        ids = [int(x.strip()) for x in args.ids.split(",")]
        questions = fetch_by_ids(ids)
    else:
        print("ERROR: provide --ids or --paper --auto", file=sys.stderr)
        sys.exit(1)

    aggregated = {}
    if args.mode == "regen" and AGGREGATED_PATH.exists():
        with open(AGGREGATED_PATH) as f:
            aggregated = json.load(f)

    ok = errors = 0
    for i, q in enumerate(questions, 1):
        print(f"[{i}/{len(questions)}] id={q['id']} {q['lesson_code']} ...", end=" ", flush=True)
        try:
            if args.mode == "explain":
                clean = rewrite_explanation(client, q, model)
                update_explanation(q["id"], clean)
                print("FIXED", flush=True)
            else:  # regen
                new_qs = regen_questions(client, q["lesson_code"], q["question_type"],
                                         q["difficulty"], aggregated, model)
                delete_questions([q["id"]])
                for nq in new_qs:
                    insert_question(q["lesson_code"], nq)
                print(f"REGENNED ({len(new_qs)} inserted)", flush=True)
            ok += 1
        except Exception as exc:
            print(f"ERROR: {exc}", flush=True)
            errors += 1
        time.sleep(0.3)

    print(f"\nDone. ok={ok} errors={errors}")


if __name__ == "__main__":
    main()
