"""
review_distractors.py

Reviews difficulty 4-5 questions for a given paper and ensures each question's
wrong options (distractors) clearly represent one of the four distractor types
from the FSA exam strategy article:

  1. true-but-irrelevant  — factually correct, doesn't answer the question
  2. cause-effect         — describes downstream effect rather than root cause
  3. plausible-numbers    — numerically in-range but wrong for the condition
  4. reversed-relationship — direction/relationship inverted (direct↔inverse, increase↔decrease)

Usage:
  python3 scripts/review_distractors.py --paper 3A1 --dry-run
  python3 scripts/review_distractors.py --paper 3A1
  python3 scripts/review_distractors.py --paper 3A1 --limit 10
  python3 scripts/review_distractors.py --lesson_code 3A1-1-2
"""

import argparse
import json
import os
import random
import sys
import time
import traceback
from pathlib import Path

import psycopg2
from openai import OpenAI

SCRIPT_DIR = Path(__file__).parent
DOTENV_PATH = SCRIPT_DIR.parent.parent / ".env"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
ERROR_LOG = SCRIPT_DIR / "distractor_review_errors.log"

DISTRACTOR_TYPES = [
    "true-but-irrelevant",
    "cause-effect",
    "plausible-numbers",
    "reversed-relationship",
]

DISTRACTOR_DESCRIPTIONS = {
    "true-but-irrelevant": (
        "Each wrong option is a factually correct statement about the topic but does NOT "
        "answer the specific question being asked. A student who skims the stem selects it "
        "because it sounds right in isolation."
    ),
    "cause-effect": (
        "Each wrong option confuses cause and effect — it describes a downstream consequence "
        "or a related symptom rather than the direct answer. Students who know the system "
        "generally but not precisely fall for these."
    ),
    "plausible-numbers": (
        "Each wrong option is a numerical value in the right ballpark but derived from a "
        "realistic calculation error: wrong formula rearrangement, unit mix-up (kPa vs MPa), "
        "using inside diameter instead of outside diameter, forgetting a correction term, "
        "or misapplying a coefficient. All four numbers must look credible."
    ),
    "reversed-relationship": (
        "Each wrong option reverses a key relationship: increases where the correct answer "
        "decreases, direct proportionality where it should be inverse, or flips a cause-effect "
        "direction. These catch candidates who are moving too fast or are fatigued."
    ),
}


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def get_connection():
    return psycopg2.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=int(os.environ.get("POSTGRES_PORT", "5432")),
        dbname=os.environ.get("POSTGRES_DB", "fsa_agent"),
        user=os.environ.get("POSTGRES_USER", "postgres"),
        password=os.environ.get("POSTGRES_PASSWORD", ""),
    )


def fetch_questions(paper: str | None, lesson_code: str | None) -> list[dict]:
    conn = get_connection()
    cur = conn.cursor()
    if lesson_code:
        cur.execute(
            "SELECT id, lesson_code, question_type, difficulty, question_text, options, correct_answer, explanation "
            "FROM questions WHERE lesson_code = %s AND difficulty >= 4 ORDER BY id",
            (lesson_code,),
        )
    else:
        cur.execute(
            "SELECT id, lesson_code, question_type, difficulty, question_text, options, correct_answer, explanation "
            "FROM questions WHERE lesson_code LIKE %s AND difficulty >= 4 ORDER BY lesson_code, id",
            (f"{paper}-%",),
        )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [
        {
            "id": r[0],
            "lesson_code": r[1],
            "question_type": r[2],
            "difficulty": r[3],
            "question_text": r[4],
            "options": r[5],
            "correct_answer": r[6],
            "explanation": r[7],
        }
        for r in rows
    ]


def update_question(qid: int, options: list[str], explanation: str) -> None:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "UPDATE questions SET options = %s, explanation = %s WHERE id = %s",
        (json.dumps(options), explanation, qid),
    )
    conn.commit()
    cur.close()
    conn.close()


def assign_distractor_type(qid: int) -> str:
    """Deterministically assign a distractor type based on question ID."""
    rng = random.Random(qid)
    return rng.choice(DISTRACTOR_TYPES)


ASSESS_SYSTEM = """You are an expert exam question reviewer for Power Engineering certification exams.

The four recognized distractor types are:
1. true-but-irrelevant: wrong option is factually correct but doesn't answer the question asked
2. cause-effect: wrong option describes a downstream consequence rather than the direct answer
3. plausible-numbers: wrong option is a numerically credible value from a realistic calculation error
4. reversed-relationship: wrong option inverts a key direction, proportion, or relationship

You will be shown a multiple-choice question. Examine ONLY the wrong options (not the correct one).
Respond with exactly one word: YES if the wrong options already clearly represent one of the four types, or NO if they do not."""

REWRITE_SYSTEM = """You are an expert exam question writer for Power Engineering certification exams (SOPEEC / ABSA / TSBC).

You will rewrite ONLY the wrong options of a multiple-choice question to use a specified distractor type.
Rules:
- Keep the correct answer text word-for-word unchanged.
- All four options must be plausible to a student with approximate knowledge.
- Do NOT reference "the lesson", "the video", or equation numbers without giving the formula text.
- Preserve LaTeX formatting ($...$ inline, $$...$$ display).
- For numerical questions, wrong options must use distinct realistic calculation paths — not absurd values.
- Output ONLY valid JSON with exactly these keys (no markdown, no preamble):
    {"options": ["string","string","string","string"], "explanation": "string"}
  The correct answer must remain at the SAME index position as given."""


def _question_context(q: dict) -> str:
    options_display = "\n".join(
        f"  [{i}]{'*' if i == q['correct_answer'] else ' '} {opt}"
        for i, opt in enumerate(q["options"])
    )
    return (
        f"Lesson: {q['lesson_code']} | Type: {q['question_type']} | Difficulty: {q['difficulty']}\n\n"
        f"QUESTION:\n{q['question_text']}\n\n"
        f"OPTIONS (* = correct):\n{options_display}\n\n"
        f"EXPLANATION:\n{q['explanation']}"
    )


def _call(client: OpenAI, system: str, user: str, model: str, max_tokens: int) -> str:
    resp = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    return (resp.choices[0].message.content or "").strip()


def call_model(client: OpenAI, q: dict, assigned_type: str, model: str) -> dict | None:
    """Returns None if KEEP, or dict with new options+explanation."""
    ctx = _question_context(q)

    # Step 1: assess
    assess_raw = _call(client, ASSESS_SYSTEM, ctx, model, max_tokens=10).upper()
    if assess_raw.startswith("YES"):
        return None

    # Step 2: rewrite using assigned type
    rewrite_prompt = (
        f"{ctx}\n\n"
        f"ASSIGNED DISTRACTOR TYPE: {assigned_type}\n"
        f"Description: {DISTRACTOR_DESCRIPTIONS[assigned_type]}\n\n"
        f"Rewrite the three wrong options using this distractor type. Keep correct answer unchanged."
    )
    for attempt in range(1, 4):
        try:
            raw = _call(client, REWRITE_SYSTEM, rewrite_prompt, model, max_tokens=1200)
            if not raw:
                print("  rewrite returned empty — keeping original", flush=True)
                return None
            if raw.startswith("```"):
                lines = raw.splitlines()
                end = len(lines) - 1 if lines[-1].strip() == "```" else len(lines)
                raw = "\n".join(lines[1:end]).strip()
            data = json.loads(raw)
            assert isinstance(data["options"], list) and len(data["options"]) == 4
            assert isinstance(data["explanation"], str)
            return data
        except (json.JSONDecodeError, AssertionError, KeyError) as exc:
            if attempt < 3:
                print(f"  rewrite parse error attempt {attempt}: {exc} — retrying...", flush=True)
                time.sleep(1)
            else:
                print(f"  rewrite failed after 3 attempts — keeping original", flush=True)
                return None
    return None


def main():
    load_dotenv(DOTENV_PATH)

    parser = argparse.ArgumentParser(description="Review and improve distractors for difficulty 4-5 questions")
    parser.add_argument("--paper", default=None, help="Paper code e.g. 3A1")
    parser.add_argument("--lesson_code", default=None, help="Single lesson e.g. 3A1-1-2")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--delay", type=float, default=0.4)
    parser.add_argument("--model", default=None)
    args = parser.parse_args()

    if not args.paper and not args.lesson_code:
        print("ERROR: provide --paper or --lesson_code", file=sys.stderr)
        sys.exit(1)

    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        print("ERROR: OPENROUTER_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    model = args.model or os.getenv("OPENROUTER_MODEL")
    if not model:
        print("ERROR: OPENROUTER_MODEL not set", file=sys.stderr)
        sys.exit(1)

    questions = fetch_questions(args.paper, args.lesson_code)
    print(f"Fetched {len(questions)} difficulty 4-5 questions", flush=True)

    if args.limit:
        questions = questions[: args.limit]
        print(f"Limiting to {len(questions)}", flush=True)

    client = OpenAI(api_key=api_key, base_url=OPENROUTER_BASE_URL)

    kept = updated = errors = 0
    error_lines: list[str] = []

    for i, q in enumerate(questions, 1):
        assigned = assign_distractor_type(q["id"])
        print(
            f"[{i}/{len(questions)}] id={q['id']} {q['lesson_code']} diff={q['difficulty']} "
            f"assigned={assigned} ...",
            end=" ", flush=True,
        )
        try:
            result = call_model(client, q, assigned, model)
            if result is None:
                print("KEEP", flush=True)
                kept += 1
            else:
                if args.dry_run:
                    print(f"WOULD UPDATE", flush=True)
                    print(f"  new options: {result['options']}", flush=True)
                else:
                    update_question(q["id"], result["options"], result["explanation"])
                    print("UPDATED", flush=True)
                updated += 1
        except Exception as exc:
            print(f"ERROR: {exc}", flush=True)
            errors += 1
            error_lines.append(f"--- id={q['id']} {q['lesson_code']} ---\n{traceback.format_exc()}\n")

        if i < len(questions) and args.delay > 0:
            time.sleep(args.delay)

    if error_lines and not args.dry_run:
        with open(ERROR_LOG, "a") as f:
            f.write("\n".join(error_lines))

    print(f"\n{'='*60}")
    print(f"Done. kept={kept} updated={updated} errors={errors}")


if __name__ == "__main__":
    main()
