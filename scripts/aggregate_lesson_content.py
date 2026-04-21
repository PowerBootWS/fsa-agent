"""
aggregate_lesson_content.py

Reads FSA_lesson_content.json and groups slides by lesson_code.
Produces docs/source/lesson_content_aggregated.json — a dict keyed by
lesson_code with combined text ready for question generation.

Usage:
    python3 scripts/aggregate_lesson_content.py
    python3 scripts/aggregate_lesson_content.py --input path/to/FSA_lesson_content.json
    python3 scripts/aggregate_lesson_content.py --paper 2A1   # filter to one paper
"""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path


SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
DEFAULT_INPUT = PROJECT_DIR / "docs" / "source" / "FSA_lesson_content.json"
DEFAULT_OUTPUT = PROJECT_DIR / "docs" / "source" / "lesson_content_aggregated.json"


def aggregate(input_path: Path, paper_filter: str | None = None) -> dict:
    print(f"Reading {input_path} ...", flush=True)
    with open(input_path, encoding="utf-8") as f:
        slides = json.load(f)

    print(f"  {len(slides):,} slides loaded", flush=True)

    # Group slides by lesson_code, preserving slide order
    by_code: dict[str, list] = defaultdict(list)
    for slide in slides:
        code = slide.get("lesson_code", "")
        if not code:
            continue
        if paper_filter and slide.get("paper") != paper_filter:
            continue
        by_code[code].append(slide)

    # Sort slides within each group by slideNumber
    for code in by_code:
        by_code[code].sort(key=lambda s: s.get("slideNumber", 0))

    result = {}
    for code, code_slides in sorted(by_code.items()):
        first = code_slides[0]

        # Narrations: full prose explanation, ordered by slide
        narrations = [s["narration"] for s in code_slides if s.get("narration", "").strip()]

        # Bodies: concise summaries, ordered by slide
        bodies = [s["body"] for s in code_slides if s.get("body", "").strip()]

        # Content blocks: LaTeX/markdown source — de-duplicate while preserving order
        seen_content: set[str] = set()
        unique_content_blocks: list[str] = []
        for s in code_slides:
            c = s.get("content", "").strip()
            if c and c not in seen_content:
                seen_content.add(c)
                unique_content_blocks.append(c)

        # Build combined text: narration is richest, body adds concise coverage,
        # content adds formulas and technical source
        sections = []
        if narrations:
            sections.append("=== NARRATION ===\n" + "\n\n".join(narrations))
        if bodies:
            sections.append("=== KEY POINTS ===\n" + "\n".join(f"- {b}" for b in bodies))
        if unique_content_blocks:
            sections.append("=== SOURCE CONTENT ===\n" + "\n\n---\n\n".join(unique_content_blocks))

        combined_text = "\n\n".join(sections)

        result[code] = {
            "paper": first.get("paper", ""),
            "chapter": first.get("chapter", 0),
            "objective": first.get("objective", 0),
            "slide_count": len(code_slides),
            "combined_text": combined_text,
            "char_count": len(combined_text),
        }

    return result


def main():
    parser = argparse.ArgumentParser(description="Aggregate FSA lesson slides by lesson_code")
    parser.add_argument("--input", default=str(DEFAULT_INPUT), help="Path to FSA_lesson_content.json")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output path for aggregated JSON")
    parser.add_argument("--paper", default=None, help="Filter to a single paper (e.g. 2A1)")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        print(f"ERROR: Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    result = aggregate(input_path, paper_filter=args.paper)

    print(f"  {len(result):,} lesson_codes aggregated", flush=True)

    # Summary stats
    char_counts = [v["char_count"] for v in result.values()]
    if char_counts:
        print(f"  Combined text — avg: {sum(char_counts)//len(char_counts):,} chars, "
              f"min: {min(char_counts):,}, max: {max(char_counts):,}", flush=True)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Written to {output_path}", flush=True)


if __name__ == "__main__":
    main()
