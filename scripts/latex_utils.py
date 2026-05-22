"""
Shared LaTeX sanitization utility for question generation and database repair.
"""

import re

# Splits text into alternating non-math / math spans.
# $$...$$ is tried before $...$ so block delimiters are not mis-parsed as two inlines.
_MATH_SPAN = re.compile(r'(\$\$[\s\S]*?\$\$|\$[^$]+?\$)')

# Bare LaTeX commands to wrap when found outside any delimiter.
_BARE_CMD = re.compile(
    r'(\\(?:frac|sqrt|sum|int|prod|lim|infty|partial|cdot|times|div|pm|'
    r'leq|geq|neq|approx|propto|Delta|alpha|beta|gamma|theta|lambda|mu|pi|sigma|omega)'
    r'(?:\{[^}]*\})*)'
)


def sanitize_latex(text: str) -> str:
    """Normalise LaTeX delimiters in a string to KaTeX-compatible $...$ / $$...$$ format.

    Fixes:
    - \\[...\\] → $$...$$ and \\(...\\) → $...$
    - Triple-or-more consecutive $ collapsed to $$ (double-wrap artefact like $$$)
    - Inner $ delimiters inside $$...$$ blocks stripped
    - Bare LaTeX commands outside any delimiter wrapped in $...$
    """
    if not text:
        return text

    # Normalise alternate delimiter styles that some models output despite instructions.
    text = re.sub(r'\\\[([\s\S]*?)\\\]', r'$$\1$$', text)
    text = re.sub(r'\\\((.*?)\\\)', r'$\1$', text)

    # Collapse 3+ consecutive $ to $$.  Triple-dollar has no valid LaTeX meaning; it is
    # always the result of a double-wrap artefact, e.g. $$t = $\frac{...}$$$
    text = re.sub(r'\${3,}', '$$', text)

    # Strip inner $ delimiters from inside $$...$$ blocks.
    def _strip_inner_dollars(m: re.Match) -> str:
        return '$$' + m.group(1).replace('$', '') + '$$'

    text = re.sub(r'\$\$([\s\S]*?)\$\$', _strip_inner_dollars, text)

    # Wrap bare LaTeX commands, but only in text segments that are NOT already inside
    # a $...$ or $$...$$ delimiter.  Split on math spans, process only the prose parts.
    parts = _MATH_SPAN.split(text)
    for i in range(0, len(parts), 2):  # even indices are non-math prose
        parts[i] = _BARE_CMD.sub(r'$\1$', parts[i])
    text = ''.join(parts)

    # Collapse leftover extra whitespace from prior cleaning steps.
    text = re.sub(r'  +', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)

    return text.strip()


def sanitize_question(q: dict) -> dict:
    """Apply sanitize_latex to all text fields of a question dict (mutates in place)."""
    for field in ('question_text', 'explanation'):
        if isinstance(q.get(field), str):
            q[field] = sanitize_latex(q[field])
    if isinstance(q.get('options'), list):
        q['options'] = [sanitize_latex(o) if isinstance(o, str) else o for o in q['options']]
    return q
