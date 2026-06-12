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
DOTENV_PATH = SCRIPT_DIR.parent.parent / ".env"
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


def main():
    load_dotenv(DOTENV_PATH)
    parser = argparse.ArgumentParser()
    parser.add_argument("--ids", default=None, help="Comma-separated question IDs")
    parser.add_argument("--paper", default=None)
    parser.add_argument("--mode", choices=["explain", "regen"], required=True)
    parser.add_argument("--auto", action="store_true", help="Auto-find leak questions for --paper")
    parser.add_argument("--model", default=None)
    args = parser.parse_args()

    api_key = os.getenv("OPENROUTER_API_KEY")
    model = args.model or os.getenv("OPENROUTER_MODEL")
    if not api_key or not model:
        print("ERROR: OPENROUTER_API_KEY and OPENROUTER_MODEL required", file=sys.stderr)
        sys.exit(1)

    client = OpenAI(api_key=api_key, base_url=OPENROUTER_BASE_URL)

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
