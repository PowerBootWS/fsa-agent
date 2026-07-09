"""
Resume/cover-letter tailoring agent — generates a job-specific tailored resume and/or
cover letter from a candidate's uploaded resume (and optional cover letter) plus a saved
job's snapshot. Uses OpenRouter directly (not the claude -p pattern used elsewhere in this
stack) so usage/cost for this customer-facing, potentially high-volume feature stays
isolated from the Claude Code Max subscription's own limits — an owner-approved, deliberate
exception (2026-07-08).

Unlike checkpoint.py's fallback-on-error pattern (fine for a throwaway chat nudge),
generation failures here propagate to the caller — this produces a paid deliverable the
candidate downloads, so silently returning placeholder content on an API error would be
worse than a visible failure.
"""
import pdfplumber
from docx import Document as DocxDocument


def extract_text(file_path: str, mime_type: str) -> str:
    """Extract plain text from an uploaded resume/cover-letter file (PDF or DOCX)."""
    if mime_type == 'application/pdf':
        text_parts = []
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
        text = '\n'.join(text_parts).strip()
    else:
        doc = DocxDocument(file_path)
        text = '\n'.join(p.text for p in doc.paragraphs).strip()

    if not text:
        raise ValueError('NO_EXTRACTABLE_TEXT')
    return text
