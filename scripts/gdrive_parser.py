"""
Google Docs / Markdown parser for FSA lesson content.

Parses the Section Heading / Content format used in FSA lesson documents.
Handles two input sources:
  - Google Docs exported as plain text (via API)
  - Local markdown files (for testing / dry-run with local files)

Section structure:
  Section Heading:
  <Title>

  Content:
  <body — may contain $$...$$ LaTeX blocks, step descriptions, etc.>

Sections whose title starts with "Step N" or "Step N —" are worked problems
and are grouped together into a single question row with step_data JSONB.

All other sections become key_points entries on the lesson.
"""

import re
import json


# -----------------------------------------------------------------------
# Public API
# -----------------------------------------------------------------------

def parse_text(raw_text):
    """
    Parse raw document text into structured lesson data.

    Args:
        raw_text: String of the full document text

    Returns:
        dict with:
          - key_points: list of {title, content} dicts (non-step sections)
          - worked_problems: list of step_data dicts (one per multi-step problem)
          - title: first section heading (lesson title)
    """
    sections = _split_sections(raw_text)
    key_points = []
    worked_problems = []

    for section_title, section_content in sections:
        # Check if this section's content contains embedded "Step N" sub-sections
        steps = _extract_embedded_steps(section_content)

        if steps:
            # This section is a worked problem (steps embedded in content)
            wp = _build_step_data(section_title, steps)
            worked_problems.append(wp)
        else:
            key_points.append({
                'title': section_title,
                'content': section_content,
            })

    lesson_title = key_points[0]['title'] if key_points else 'Untitled Lesson'

    return {
        'title': lesson_title,
        'key_points': key_points,
        'worked_problems': worked_problems,
    }


def parse_google_doc(doc_body):
    """
    Parse a Google Docs API body (list of paragraph dicts) into plain text,
    then call parse_text().

    Args:
        doc_body: dict with 'content' key from Google Docs API response

    Returns:
        Same as parse_text()
    """
    raw = _extract_text_from_doc_body(doc_body)
    return parse_text(raw)


# -----------------------------------------------------------------------
# Embedded step extraction
# -----------------------------------------------------------------------

def _extract_embedded_steps(content):
    """
    Given a section's content block, detect if it contains embedded Step N sub-sections.

    The document format embeds steps as paragraph headings within the content:
      Step 1 — Problem statement
      <step 1 text>

      Step 2 — Choose the correct code equation
      <step 2 text>
      ...

    Returns a list of step dicts [{step, title, content}] if found, else [].
    """
    # Look for lines that start with "Step N" (step label lines)
    # Patterns: "Step 1 — ...", "Step 1: ...", "Step 1 Problem...", "Step 1\n"
    # Note: Google Docs exports may add trailing spaces before newlines, so use \s* not just $
    step_pattern = re.compile(r'(?m)^(Step\s+\d+[^\n]*?)\s*$')
    matches = list(step_pattern.finditer(content))

    if len(matches) < 2:
        # Only 0 or 1 step header — not a worked problem
        return []

    steps = []
    for i, match in enumerate(matches):
        step_title = match.group(1).strip()
        step_num = _extract_step_number(step_title)
        if step_num is None:
            continue

        # Content spans from end of this header to start of next header (or end)
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        step_content = _clean_content(content[start:end])

        steps.append({
            'step': step_num,
            'title': step_title,
            'content': step_content,
        })

    return steps


# -----------------------------------------------------------------------
# Section splitting
# -----------------------------------------------------------------------

def _split_sections(raw_text):
    """
    Split raw text on 'Section Heading:' markers.
    Returns list of (title, content) tuples.
    """
    # Normalize line endings
    text = raw_text.replace('\r\n', '\n').replace('\r', '\n')

    # Split on 'Section Heading:' (case-insensitive, may have trailing spaces)
    parts = re.split(r'(?im)^Section Heading:\s*', text)

    sections = []
    for part in parts:
        if not part.strip():
            continue

        lines = part.split('\n')

        # Title: first non-blank line after the heading marker
        title = ''
        title_idx = 0
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped:
                title = stripped
                title_idx = i
                break

        # Content: everything after 'Content:' marker
        content_match = re.search(r'(?im)^Content:\s*', part)
        if content_match:
            content_raw = part[content_match.end():]
        else:
            # No explicit Content: marker — use everything after title
            content_raw = '\n'.join(lines[title_idx + 1:])

        content = _clean_content(content_raw)

        if title:
            sections.append((title, content))

    return sections


def _clean_content(text):
    """Clean up content text: remove escape chars added by Docs export."""
    # Google Docs markdown export escapes: \-, \*, \[, \= etc.
    text = re.sub(r'\\([*\-\[\]\\=+.#!|`])', r'\1', text)
    # Collapse 3+ blank lines to 2
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


# -----------------------------------------------------------------------
# Step detection
# -----------------------------------------------------------------------

def _extract_step_number(title):
    """
    Return integer step number if title matches 'Step N' pattern, else None.
    Handles: 'Step 1', 'Step 1 — ...', 'Step 1: ...', 'Step 1 Problem...'
    """
    m = re.match(r'(?i)^Step\s+(\d+)\b', title.strip())
    if m:
        return int(m.group(1))
    return None


# -----------------------------------------------------------------------
# Worked problem / step_data construction
# -----------------------------------------------------------------------

def _build_step_data(problem_title, steps):
    """
    Convert a list of step dicts into a step_data JSONB structure.

    Each step is typed based on keyword patterns in its title/content.
    """
    built_steps = []
    for s in steps:
        step_num = s['step']
        title = s['title']
        content = s['content']
        step_type = _infer_step_type(step_num, title, content)
        built_step = _build_step(step_num, step_type, title, content)
        built_steps.append(built_step)

    # Build a human-readable question text for the whole problem
    question_text = _extract_problem_statement(steps)

    return {
        'problem_title': problem_title or steps[0]['title'] if steps else 'Worked Problem',
        'question_text': question_text,
        'step_data': {
            'steps': built_steps,
        },
    }


def _infer_step_type(step_num, title, content):
    """Infer step type from title and content keywords."""
    title_lower = title.lower()
    content_lower = content.lower()

    if step_num == 1:
        return 'problem_statement'

    if any(kw in title_lower for kw in ['choose', 'equation', 'code case', 'applicable', 'correct code']):
        return 'formula_choice'

    if any(kw in title_lower for kw in ['unit', 'convert', 'conversion']):
        return 'unit_check'

    if any(kw in title_lower for kw in ['insert', 'substitute', 'substitut', 'known values', 'governing equation']):
        return 'substitution'

    if any(kw in title_lower for kw in ['state', 'result', 'minimum', 'maximum', 'final', 'ans']):
        return 'final_answer'

    if any(kw in title_lower for kw in ['note', 'post-calculation', 'apply the post']):
        return 'notes'

    if any(kw in title_lower for kw in ['confirm', 'check', 'thin-shell', 'assumption']):
        return 'verification'

    # Fallback: if content has an equation, likely substitution
    if '$$' in content:
        return 'substitution'

    return 'explanation'


def _build_step(step_num, step_type, title, content):
    """Build a single step dict for step_data.steps."""
    step = {
        'step': step_num,
        'type': step_type,
        'title': title,
        'content': content,
    }

    # For formula_choice: try to extract formula options mentioned
    if step_type == 'formula_choice':
        formula_options = _extract_formula_refs(content)
        if formula_options:
            step['formula_options'] = formula_options
            # Try to identify which is correct
            correct = _identify_correct_formula(content, formula_options)
            if correct:
                step['correct'] = correct

    # For final_answer: try to extract the answer
    if step_type == 'final_answer':
        answer = _extract_final_answer(content)
        if answer:
            step['correct_answer'] = answer
            step['tolerance'] = '0.05'

    # For substitution: try to capture expected setup
    if step_type == 'substitution':
        setup = _extract_substitution_setup(content)
        if setup:
            step['expected_setup'] = setup

    return step


def _extract_problem_statement(steps):
    """Extract the problem statement text from step 1."""
    if not steps:
        return ''
    step1 = steps[0]
    content = step1['content']
    # First paragraph of step 1 content is usually the problem statement
    paragraphs = [p.strip() for p in content.split('\n\n') if p.strip()]
    if paragraphs:
        return paragraphs[0][:500]
    return content[:500]


def _extract_formula_refs(content):
    """Extract equation references like 'equation 1.1', 'Eq. 1.2', etc."""
    matches = re.findall(r'(?i)(?:equation|eq\.?)\s*(\d+\.\d+)', content)
    # Deduplicate preserving order
    seen = set()
    result = []
    for m in matches:
        if m not in seen:
            seen.add(m)
            result.append(m)
    return result


def _identify_correct_formula(content, formula_options):
    """Try to identify which formula is stated as correct."""
    if not formula_options:
        return None

    content_lower = content.lower()

    # Patterns like "equation 1.1 is the applicable", "use equation 1.2"
    for formula in formula_options:
        patterns = [
            rf'(?i)equation\s+{re.escape(formula)}\s+is\s+(?:the\s+)?(?:applicable|correct|appropriate|governing)',
            rf'(?i)use\s+equation\s+{re.escape(formula)}',
            rf'(?i)equation\s+{re.escape(formula)}\s+(?:\(UG-\d+\))?\.?\s*$',
        ]
        for p in patterns:
            if re.search(p, content):
                return formula

    return formula_options[0] if formula_options else None


def _extract_final_answer(content):
    """Try to extract the final numeric answer."""
    # Look for patterns like "= 1.9 mm (Ans.)" or "= 12640 kPa"
    patterns = [
        r'=\s*([\d.,]+\s*(?:mm|kPa|MPa|m))\s*(?:\(Ans\.?\))?',
        r'([\d.,]+\s*(?:mm|kPa|MPa|m))\s*\(Ans\.?\)',
    ]
    for p in patterns:
        m = re.search(p, content, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None


def _extract_substitution_setup(content):
    """Try to extract the first substitution line from content."""
    # Look for lines that look like formula substitution
    lines = content.split('\n')
    for line in lines:
        line = line.strip()
        if '=' in line and len(line) > 10 and ('t =' in line.lower() or 'p =' in line.lower()):
            return line[:200]
    return None


# -----------------------------------------------------------------------
# Google Docs API body → plain text
# -----------------------------------------------------------------------

def _extract_text_from_doc_body(body):
    """
    Convert Google Docs API body content to plain text.

    The Docs API returns a list of structural elements (paragraphs, tables, etc.)
    each with text runs.
    """
    lines = []
    content = body.get('content', [])

    for element in content:
        if 'paragraph' in element:
            para = element['paragraph']
            text = ''
            for run in para.get('elements', []):
                text_run = run.get('textRun', {})
                text += text_run.get('content', '')
            # Strip trailing newline that Docs API adds
            lines.append(text.rstrip('\n'))

        elif 'table' in element:
            # Skip tables for now — they're rare in these docs
            pass

    return '\n'.join(lines)
