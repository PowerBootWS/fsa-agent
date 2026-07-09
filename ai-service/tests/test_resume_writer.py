import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.resume_writer import extract_text

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), 'fixtures')


def test_extract_text_from_docx():
    text = extract_text(os.path.join(FIXTURES_DIR, 'sample_resume.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    assert 'Jane Candidate' in text
    assert 'package boilers' in text


def test_extract_text_from_pdf():
    text = extract_text(os.path.join(FIXTURES_DIR, 'sample_resume.pdf'), 'application/pdf')
    assert 'Jane Candidate' in text


def test_extract_text_raises_on_empty_document():
    import tempfile
    from docx import Document
    doc = Document()
    with tempfile.NamedTemporaryFile(suffix='.docx', delete=False) as f:
        doc.save(f.name)
        path = f.name
    try:
        import pytest
        with pytest.raises(ValueError, match='NO_EXTRACTABLE_TEXT'):
            extract_text(path, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    finally:
        os.unlink(path)
