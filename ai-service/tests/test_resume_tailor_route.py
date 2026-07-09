import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from unittest.mock import patch
import tempfile
import shutil

import app as app_module

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), 'fixtures')


def make_client():
    app_module.app.config['TESTING'] = True
    return app_module.app.test_client()


def test_missing_params_returns_400():
    client = make_client()
    res = client.post('/agent/resume-tailor', json={})
    assert res.status_code == 400


@patch('app.generate_tailored_documents')
def test_successful_generation_returns_result(mock_generate):
    mock_generate.return_value = {
        'documents': [{'doc_type': 'resume', 'docx_path': '/tmp/x/resume.docx', 'pdf_path': '/tmp/x/resume.pdf'}],
        'changes_summary': 'Moved certification to the top.',
        'placeholder_count': 3,
        'flagged_gaps': [],
        'model_used': 'anthropic/claude-sonnet-5',
    }
    client = make_client()
    res = client.post('/agent/resume-tailor', json={
        'job': {'title': 'Boiler Operator', 'company': 'Acme Plant', 'description_snapshot': 'Operate boilers.'},
        'user_id': 42,
        'saved_job_id': 7,
        'resume': {'path': os.path.join(FIXTURES_DIR, 'sample_resume.docx'), 'mime_type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},
        'cover_letter': None,
        'doc_types': ['resume'],
    })
    assert res.status_code == 200
    assert res.get_json()['changes_summary'] == 'Moved certification to the top.'


@patch('app.generate_tailored_documents')
def test_unreadable_source_document_returns_422(mock_generate):
    mock_generate.side_effect = ValueError('NO_EXTRACTABLE_TEXT')
    client = make_client()
    res = client.post('/agent/resume-tailor', json={
        'job': {'title': 'Boiler Operator', 'company': 'Acme Plant', 'description_snapshot': 'x'},
        'user_id': 42,
        'saved_job_id': 7,
        'resume': {'path': '/tmp/whatever.pdf', 'mime_type': 'application/pdf'},
        'cover_letter': None,
        'doc_types': ['resume'],
    })
    assert res.status_code == 422
    assert res.get_json()['error'] == 'UNREADABLE_SOURCE_DOCUMENT'


@patch('app.generate_tailored_documents')
def test_other_generation_failure_returns_502(mock_generate):
    mock_generate.side_effect = ValueError('MODEL_DID_NOT_RETURN_RESUME')
    client = make_client()
    res = client.post('/agent/resume-tailor', json={
        'job': {'title': 'Boiler Operator', 'company': 'Acme Plant', 'description_snapshot': 'x'},
        'user_id': 42,
        'saved_job_id': 7,
        'resume': {'path': '/tmp/whatever.pdf', 'mime_type': 'application/pdf'},
        'cover_letter': None,
        'doc_types': ['resume'],
    })
    assert res.status_code == 502
