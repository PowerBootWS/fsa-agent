"""
generate_questions.py

Generates multiple-choice questions for each lesson objective using an
OpenRouter-hosted model (OpenAI-compatible API), then inserts them into
the questions table.

Reads:
  - docs/source/lesson_content_aggregated.json  (run aggregate_lesson_content.py first)
  - docs/source/exam_samples/*.pdf              (optional style guides, one per course)
  - .env                                        (for API key and model)

Usage:
  # Dry-run first two objectives of a paper
  python3 scripts/generate_questions.py --paper 2A1 --limit 2 --dry-run

  # Dry-run a single lesson_code
  python3 scripts/generate_questions.py --lesson_code 2A1-1-1 --dry-run

  # Run all lessons for one paper
  python3 scripts/generate_questions.py --paper 2A1

  # Run everything
  python3 scripts/generate_questions.py

  # Regenerate even if questions already exist
  python3 scripts/generate_questions.py --paper 2A1 --force

Environment variables (loaded from .env automatically):
  OPENROUTER_API_KEY    required
  OPENROUTER_MODEL      required (e.g. deepseek/deepseek-v3.2)
  POSTGRES_HOST / POSTGRES_PORT / POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD
"""

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path

from openai import OpenAI

# Add scripts/ directory so db_inserter is importable
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))
import db_inserter  # noqa: E402

PROJECT_DIR = SCRIPT_DIR.parent
AGGREGATED_PATH = PROJECT_DIR / "docs" / "source" / "lesson_content_aggregated.json"
EXAM_SAMPLES_DIR = PROJECT_DIR / "docs" / "source" / "exam_samples"
ERROR_LOG = SCRIPT_DIR / "generation_errors.log"
DOTENV_PATH = PROJECT_DIR / ".env"

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

PRACTICE_COUNT = 5   # objective_practice questions per lesson_code
QUIZ_COUNT = 2       # chapter_quiz questions per lesson_code


# ---------------------------------------------------------------------------
# Load .env manually (avoid requiring python-dotenv on the host)
# ---------------------------------------------------------------------------

def load_dotenv(path: Path) -> None:
    """Parse a simple KEY=VALUE .env file and set missing env vars."""
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


# ---------------------------------------------------------------------------
# Style guide extraction from sample exam PDFs
# ---------------------------------------------------------------------------

def _load_pdf_text(pdf_path: Path) -> str:
    """Extract plain text from a PDF using pdfplumber."""
    try:
        import pdfplumber
        with pdfplumber.open(pdf_path) as pdf:
            pages = [page.extract_text() or "" for page in pdf.pages]
        return "\n".join(pages)
    except Exception as exc:
        print(f"  WARNING: Could not read {pdf_path.name}: {exc}")
        return ""


def load_exam_style_guides() -> dict[str, str]:
    """
    Returns a dict mapping paper code (e.g. '2A1') to a trimmed excerpt of
    the sample exam PDF for that course.
    """
    guides: dict[str, str] = {}
    if not EXAM_SAMPLES_DIR.exists():
        return guides
    for pdf_path in sorted(EXAM_SAMPLES_DIR.glob("*.pdf")):
        name_upper = pdf_path.stem.upper()
        paper = None
        for candidate in ["2A1", "2A2", "2A3", "2B1", "2B2", "2B3"]:
            if candidate.replace("2", "2").replace("A", "A").replace("B", "B") in name_upper:
                paper = candidate
                break
        if not paper:
            print(f"  WARNING: Cannot determine paper code from {pdf_path.name} — skipping")
            continue
        print(f"  Loading exam style from {pdf_path.name} ({paper}) ...", flush=True)
        text = _load_pdf_text(pdf_path)
        if text.strip():
            # First 4 000 chars is enough for style calibration
            guides[paper] = text.strip()[:4000]
            print(f"    {len(guides[paper])} chars extracted", flush=True)
        else:
            print(f"    WARNING: No text extracted from {pdf_path.name}", flush=True)
    return guides


# ---------------------------------------------------------------------------
# Prompt building
# ---------------------------------------------------------------------------

GENERIC_STYLE = """
Question style for Second Class Power Engineering (ABSA / BC Safety Authority) exams:
- Questions are direct and unambiguous. Most are calculation-based; some test conceptual
  understanding of code requirements.
- Four options; exactly one is correct.
- Difficulty 1-2: single-step recall or definition.
- Difficulty 3: standard multi-variable formula application.
- Difficulty 4: careful unit handling or multi-step reasoning.
- Difficulty 5: combines two sub-concepts or requires interpreting code boundary conditions.
- Explanations state which formula was used and show the key calculation step.
"""

# Applied to every call regardless of whether a PDF style guide is present
DISTRACTOR_RULES = """
Distractor construction rules (apply to every question):
- Every wrong option must represent a mistake a real student could plausibly make.
  Acceptable distractor sources: wrong formula rearrangement, using inside diameter where
  outside diameter is required (or vice versa), forgetting to add the corrosion/expansion
  allowance term, applying the thin-shell equation when thick-shell limits are exceeded,
  a kPa/MPa unit conversion error, or using the wrong code coefficient (e.g. y=0.5 vs 0.4).
- Never use vague distractors like "it depends on the material" or "cannot be determined"
  unless the lesson specifically teaches that the answer is conditional — in that case the
  distractor must name the specific condition that makes it wrong.
- For numerical questions all four options must be distinct numbers that result from
  realistic calculation paths; do not pad with obviously unreasonable values.
"""


def build_system_prompt(paper: str, style_guides: dict[str, str]) -> str:
    style_section = style_guides.get(paper, "").strip()
    if style_section:
        style_block = (
            f"\nThe following are sample questions from actual {paper} exams. "
            f"Use these to calibrate phrasing, difficulty level, and distractor construction:\n\n"
            f"<exam_samples>\n{style_section}\n</exam_samples>\n"
        )
    else:
        style_block = GENERIC_STYLE

    return (
        "You are an expert exam question writer for the Second Class Power Engineering "
        "certification program in Canada (ABSA / BC Safety Authority).\n\n"
        "Your task is to write multiple-choice questions strictly grounded in the lesson "
        "content provided. Do not introduce concepts not covered in the lesson.\n"
        f"{style_block}\n"
        f"{DISTRACTOR_RULES}\n"
        "Output ONLY a valid JSON array — no markdown fences, no preamble, no trailing text.\n"
        "Each element must have exactly these keys:\n"
        "  question_text   string\n"
        "  options         array of exactly 4 strings (not prefixed with A/B/C/D)\n"
        "  correct_answer  integer 0-3 (index of correct option)\n"
        "  explanation     string (concise; state formula used and key step)\n"
        "  difficulty      integer 1-5\n"
        "  topic           string (short snake_case tag, e.g. \"mawp_formula\")\n"
        "  question_type   string (\"objective_practice\" or \"chapter_quiz\")\n"
    )


def build_user_prompt(lesson_code: str, meta: dict, practice_count: int, quiz_count: int) -> str:
    return (
        f"Lesson: {lesson_code}\n"
        f"Course: {meta['paper']}  |  Chapter {meta['chapter']}  |  Objective {meta['objective']}\n\n"
        f"Write {practice_count} questions with question_type \"objective_practice\" "
        f"(difficulty 2-4, spread across the key concepts in the lesson) "
        f"and {quiz_count} questions with question_type \"chapter_quiz\" "
        f"(difficulty 4-5, suitable for end-of-chapter assessment).\n\n"
        f"=== LESSON CONTENT ===\n{meta['combined_text']}\n"
    )


# ---------------------------------------------------------------------------
# OpenRouter API call
# ---------------------------------------------------------------------------

def _clean_json(raw: str) -> str:
    """
    Strip markdown fences and any prose before/after the JSON array.
    Finds the first '[' and last ']' and returns only what's between them.
    """
    # Strip markdown fences
    if raw.startswith("```"):
        lines = raw.splitlines()
        end = len(lines) - 1 if lines[-1].strip() == "```" else len(lines)
        raw = "\n".join(lines[1:end]).strip()

    # Find the outermost JSON array bounds regardless of any surrounding text
    start = raw.find("[")
    end = raw.rfind("]")
    if start != -1 and end != -1 and end > start:
        raw = raw[start:end + 1]

    return raw


def call_model(client: OpenAI, system: str, user: str, model: str, retries: int = 2) -> list[dict]:
    """Call the model via OpenRouter and parse the returned JSON array.
    Retries up to `retries` times on JSON parse failure before raising.
    """
    last_exc = None
    for attempt in range(1, retries + 2):  # +2: initial attempt + retries
        try:
            response = client.chat.completions.create(
                model=model,
                max_tokens=4096,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            )
            raw = response.choices[0].message.content.strip()
            cleaned = _clean_json(raw)
            return json.loads(cleaned)
        except (json.JSONDecodeError, RecursionError, ValueError) as exc:
            last_exc = exc
            if attempt <= retries:
                print(f"  JSON parse error (attempt {attempt}/{retries + 1}): {exc} — retrying ...", flush=True)
                time.sleep(1)
            else:
                raise RuntimeError(f"Failed to parse model response after {retries + 1} attempts: {exc}") from exc
    raise last_exc  # unreachable, satisfies type checkers


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

REQUIRED_KEYS = {"question_text", "options", "correct_answer", "explanation",
                 "difficulty", "topic", "question_type"}
VALID_TYPES = {"objective_practice", "chapter_quiz"}


def validate_question(q: dict, lesson_code: str) -> bool:
    missing = REQUIRED_KEYS - set(q.keys())
    if missing:
        print(f"  INVALID ({lesson_code}): missing keys {missing}")
        return False
    if not isinstance(q["options"], list) or len(q["options"]) != 4:
        print(f"  INVALID ({lesson_code}): options must be a list of exactly 4 strings")
        return False
    if not isinstance(q["correct_answer"], int) or not (0 <= q["correct_answer"] <= 3):
        print(f"  INVALID ({lesson_code}): correct_answer must be integer 0-3")
        return False
    if q["question_type"] not in VALID_TYPES:
        print(f"  INVALID ({lesson_code}): question_type {q['question_type']!r}")
        return False
    if not isinstance(q.get("difficulty"), int) or not (1 <= q["difficulty"] <= 5):
        print(f"  INVALID ({lesson_code}): difficulty must be integer 1-5")
        return False
    return True


def print_question(q: dict, index: int) -> None:
    """Pretty-print a question for dry-run review."""
    qtype = q.get("question_type", "?")
    diff = q.get("difficulty", "?")
    topic = q.get("topic", "?")
    print(f"\n  Q{index} [{qtype}] difficulty={diff} topic={topic}")
    print(f"  {q['question_text']}")
    for i, opt in enumerate(q.get("options", [])):
        marker = ">>>" if i == q.get("correct_answer") else "   "
        print(f"  {marker} {i}: {opt}")
    print(f"  Explanation: {q.get('explanation', '')}")


# ---------------------------------------------------------------------------
# Per-lesson processing
# ---------------------------------------------------------------------------

def process_lesson_code(
    lesson_code: str,
    meta: dict,
    client: OpenAI,
    style_guides: dict[str, str],
    model: str,
    dry_run: bool,
    force: bool,
) -> tuple[int, int]:
    """Generate and insert questions for one lesson_code. Returns (inserted, skipped)."""
    paper = meta["paper"]
    chapter = meta["chapter"]
    chapter_id = f"{paper}-{chapter}"
    course_id = paper

    if not force and not dry_run:
        existing = db_inserter.get_question_count(lesson_code)
        if existing > 0:
            print(f"  → {existing} questions already exist, skipping (--force to regenerate)")
            return 0, existing

    system_prompt = build_system_prompt(paper, style_guides)
    user_prompt = build_user_prompt(lesson_code, meta, PRACTICE_COUNT, QUIZ_COUNT)

    if dry_run:
        print(f"\n{'='*65}")
        print(f"  Lesson : {lesson_code}  ({paper} chapter {chapter}, objective {meta['objective']})")
        print(f"  Content: {meta['char_count']:,} chars across {meta['slide_count']} slides")
        print(f"  Model  : {model}")

    questions = call_model(client, system_prompt, user_prompt, model)

    inserted = 0
    skipped = 0
    for idx, q in enumerate(questions, 1):
        if not validate_question(q, lesson_code):
            skipped += 1
            continue
        if dry_run:
            print_question(q, idx)
            inserted += 1
        else:
            result = db_inserter.insert_question(lesson_code, chapter_id, course_id, q)
            if result is not None:
                inserted += 1
            else:
                skipped += 1

    return inserted, skipped


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    load_dotenv(DOTENV_PATH)

    parser = argparse.ArgumentParser(description="Generate MCQ questions for FSA lesson objectives")
    parser.add_argument("--lesson_code", default=None, help="Process a single lesson_code (e.g. 2A1-1-1)")
    parser.add_argument("--paper", default=None, help="Process all lesson_codes for one paper (e.g. 2A1)")
    parser.add_argument("--limit", type=int, default=None, help="Cap number of lesson_codes to process")
    parser.add_argument("--dry-run", action="store_true", help="Print questions, do not write to DB")
    parser.add_argument("--force", action="store_true", help="Regenerate even if questions exist")
    parser.add_argument("--delay", type=float, default=0.5, help="Seconds between API calls (default 0.5)")
    parser.add_argument("--model", default=None, help="Model ID (overrides OPENROUTER_MODEL env var)")
    parser.add_argument("--aggregated", default=str(AGGREGATED_PATH), help="Path to aggregated JSON")
    args = parser.parse_args()

    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        print("ERROR: OPENROUTER_API_KEY is not set (checked .env and environment)", file=sys.stderr)
        sys.exit(1)

    model = args.model or os.getenv("OPENROUTER_MODEL")
    if not model:
        print("ERROR: OPENROUTER_MODEL is not set (checked .env and environment)", file=sys.stderr)
        sys.exit(1)

    aggregated_path = Path(args.aggregated)
    if not aggregated_path.exists():
        print(f"ERROR: Aggregated content not found: {aggregated_path}", file=sys.stderr)
        print("       Run first: python3 scripts/aggregate_lesson_content.py", file=sys.stderr)
        sys.exit(1)

    with open(aggregated_path, encoding="utf-8") as f:
        aggregated: dict[str, dict] = json.load(f)
    print(f"Loaded {len(aggregated):,} lesson_codes from {aggregated_path.name}", flush=True)

    # --- Scope filtering ---
    if args.lesson_code:
        if args.lesson_code not in aggregated:
            print(f"ERROR: {args.lesson_code!r} not found in aggregated content", file=sys.stderr)
            sys.exit(1)
        targets = {args.lesson_code: aggregated[args.lesson_code]}
    elif args.paper:
        targets = {k: v for k, v in aggregated.items() if v["paper"] == args.paper}
        if not targets:
            print(f"ERROR: No lesson_codes found for paper {args.paper!r}", file=sys.stderr)
            sys.exit(1)
        print(f"Filtered to {len(targets):,} lesson_codes for paper {args.paper}", flush=True)
    else:
        targets = aggregated

    lesson_codes = sorted(targets.keys())
    if args.limit:
        lesson_codes = lesson_codes[: args.limit]
        print(f"Limiting to first {len(lesson_codes)} lesson_codes", flush=True)

    # --- Style guides ---
    print(f"\nLoading exam style guides from {EXAM_SAMPLES_DIR.name}/ ...", flush=True)
    style_guides = load_exam_style_guides()
    if style_guides:
        print(f"  Guides loaded for: {', '.join(sorted(style_guides.keys()))}", flush=True)
    else:
        print("  No PDFs found — using generic style guide", flush=True)

    # --- OpenRouter client ---
    client = OpenAI(api_key=api_key, base_url=OPENROUTER_BASE_URL)

    total_inserted = total_skipped = total_errors = 0
    error_log_lines: list[str] = []

    print(f"\nProcessing {len(lesson_codes)} lesson_code(s) with model: {model}\n", flush=True)

    for i, lesson_code in enumerate(lesson_codes, 1):
        meta = targets[lesson_code]
        print(
            f"[{i}/{len(lesson_codes)}] {lesson_code} "
            f"({meta['paper']} ch{meta['chapter']} obj{meta['objective']}) ...",
            end=" ", flush=True,
        )
        try:
            inserted, skipped = process_lesson_code(
                lesson_code, meta, client, style_guides, model,
                dry_run=args.dry_run, force=args.force,
            )
            if not args.dry_run:
                print(f"inserted={inserted} skipped={skipped}", flush=True)
            total_inserted += inserted
            total_skipped += skipped
        except Exception as exc:
            print(f"ERROR: {exc}", flush=True)
            total_errors += 1
            error_log_lines.append(f"--- {lesson_code} ---\n{traceback.format_exc()}\n")
        finally:
            if i < len(lesson_codes) and args.delay > 0:
                time.sleep(args.delay)

    if error_log_lines and not args.dry_run:
        with open(ERROR_LOG, "a", encoding="utf-8") as f:
            f.write("\n".join(error_log_lines))
        print(f"\nErrors logged to {ERROR_LOG}")

    print(f"\n{'='*65}")
    print(f"Done.  inserted={total_inserted}  skipped={total_skipped}  errors={total_errors}")


if __name__ == "__main__":
    main()
