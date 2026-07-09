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


from unittest.mock import patch, MagicMock
from agents.resume_writer import _build_prompt, _call_openrouter


def test_build_prompt_includes_job_and_resume_and_omits_unrequested_types():
    job = {'title': 'Boiler Operator', 'company': 'Acme Plant', 'description_snapshot': 'Operate package boilers.'}
    prompt = _build_prompt(job, 'Jane Candidate, 3rd Class.', None, ['resume'])
    assert 'Boiler Operator' in prompt
    assert 'Jane Candidate, 3rd Class.' in prompt
    assert 'cover_letter_content to null' in prompt


def test_build_prompt_includes_cover_letter_context_when_provided():
    job = {'title': 'Boiler Operator', 'company': 'Acme Plant', 'description_snapshot': 'Operate package boilers.'}
    prompt = _build_prompt(job, 'Jane Candidate.', 'Dear Hiring Manager, existing cover letter text.', ['resume', 'cover_letter'])
    assert 'existing cover letter text' in prompt


@patch('agents.resume_writer.requests.post')
def test_call_openrouter_parses_json_response(mock_post):
    mock_response = MagicMock()
    mock_response.json.return_value = {
        'choices': [{'message': {'content': '{"resume_content": "Tailored resume text", "cover_letter_content": null, "changes_summary": "Moved cert to top.", "placeholder_count": 4, "flagged_gaps": []}'}}]
    }
    mock_response.raise_for_status.return_value = None
    mock_post.return_value = mock_response

    parsed, model_used = _call_openrouter('some prompt')

    assert parsed['resume_content'] == 'Tailored resume text'
    assert parsed['placeholder_count'] == 4
    assert model_used  # non-empty model id was used


@patch('agents.resume_writer.requests.post')
def test_call_openrouter_strips_markdown_fences(mock_post):
    mock_response = MagicMock()
    mock_response.json.return_value = {
        'choices': [{'message': {'content': '```json\n{"resume_content": "x", "cover_letter_content": null, "changes_summary": "y", "placeholder_count": 1, "flagged_gaps": []}\n```'}}]
    }
    mock_response.raise_for_status.return_value = None
    mock_post.return_value = mock_response

    parsed, _ = _call_openrouter('some prompt')
    assert parsed['resume_content'] == 'x'


@patch('agents.resume_writer.requests.post')
def test_call_openrouter_raises_on_non_json_response(mock_post):
    import pytest
    mock_response = MagicMock()
    mock_response.json.return_value = {'choices': [{'message': {'content': 'Sorry, I cannot help with that.'}}]}
    mock_response.raise_for_status.return_value = None
    mock_post.return_value = mock_response

    with pytest.raises(ValueError, match='MODEL_RESPONSE_NOT_JSON'):
        _call_openrouter('some prompt')
