import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './ProfilePage.css';

// Job-only accounts (no active_paper, no class_code) have no lobby/course to go back
// to — send them to /jobs instead. Mirrors the same check used in App.jsx's DefaultRedirect.
function homeRoute() {
  const user = JSON.parse(localStorage.getItem('fsa_user') || 'null');
  if (user && !user.active_paper && !user.class_code) return '/jobs';
  return '/lobby';
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // 'success' | 'error' | null
  const [saveError, setSaveError] = useState('');
  const [pwStatus, setPwStatus] = useState(null); // 'sent' | 'error' | null
  const [pwSending, setPwSending] = useState(false);
  const [documents, setDocuments] = useState({});
  const [docUploadError, setDocUploadError] = useState('');

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    address: '',
  });

  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch('/api/platform/me', { credentials: 'include' });
        if (!res.ok) {
          navigate('/login', { replace: true });
          return;
        }
        const data = await res.json();
        setForm({
          first_name: data.first_name || '',
          last_name: data.last_name || '',
          email: data.email || '',
          phone: data.phone || '',
          address: data.address || '',
        });
      } catch {
        navigate('/login', { replace: true });
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, [navigate]);

  useEffect(() => {
    fetch('/api/platform/documents', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        const byType = {};
        (data.documents || []).forEach(d => { byType[d.doc_type] = d; });
        setDocuments(byType);
      })
      .catch(() => {});
  }, []);

  async function handleDocUpload(docType, file) {
    if (!file) return;
    setDocUploadError('');
    const formData = new FormData();
    formData.append('doc_type', docType);
    formData.append('file', file);
    try {
      const res = await fetch('/api/platform/documents', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Upload failed.');
      }
      const refreshed = await fetch('/api/platform/documents', { credentials: 'include' }).then(r => r.json());
      const byType = {};
      (refreshed.documents || []).forEach(d => { byType[d.doc_type] = d; });
      setDocuments(byType);
    } catch (err) {
      setDocUploadError(err.message);
    }
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
    setSaveStatus(null);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setSaveStatus('error');
      setSaveError('First and last name are required.');
      return;
    }
    setSaving(true);
    setSaveStatus(null);
    try {
      const res = await fetch('/api/platform/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to save profile');
      }
      // Update localStorage so the lobby header reflects the new name
      const stored = JSON.parse(localStorage.getItem('fsa_user') || '{}');
      localStorage.setItem('fsa_user', JSON.stringify({
        ...stored,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
      }));
      setSaveStatus('success');
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  async function handleSendPasswordReset() {
    setPwSending(true);
    setPwStatus(null);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email }),
      });
      setPwStatus('sent');
    } catch {
      setPwStatus('error');
    } finally {
      setPwSending(false);
    }
  }

  if (loading) {
    return <div className="pf-loading-wrap">Loading your profile…</div>;
  }

  return (
    <div className="pf-page">
      <header className="pf-header">
        <div className="pf-brand">Full Steam Ahead</div>
        <button className="pf-back-btn" onClick={() => navigate(homeRoute())}>← Back</button>
      </header>

      <div className="pf-content">
        <h1 className="pf-page-title">Your Profile</h1>
        <p className="pf-page-subtitle">Update your personal information below.</p>

        {/* Profile form */}
        <div className="pf-card">
          <div className="pf-card-title">Personal Information</div>

          {saveStatus === 'success' && (
            <div className="pf-success-banner">Profile saved successfully.</div>
          )}
          {saveStatus === 'error' && (
            <div className="pf-error-banner">{saveError}</div>
          )}

          <form onSubmit={handleSave}>
            <div className="pf-field-row">
              <div>
                <label className="pf-label" htmlFor="first_name">First Name</label>
                <input
                  id="first_name"
                  name="first_name"
                  className="pf-input"
                  value={form.first_name}
                  onChange={handleChange}
                  autoComplete="given-name"
                />
              </div>
              <div>
                <label className="pf-label" htmlFor="last_name">Last Name</label>
                <input
                  id="last_name"
                  name="last_name"
                  className="pf-input"
                  value={form.last_name}
                  onChange={handleChange}
                  autoComplete="family-name"
                />
              </div>
            </div>

            <div className="pf-field">
              <label className="pf-label">Email Address</label>
              <input
                className="pf-input-readonly"
                value={form.email}
                readOnly
                tabIndex={-1}
                autoComplete="email"
              />
              <div className="pf-readonly-note">Email cannot be changed. Contact support if needed.</div>
            </div>

            <div className="pf-field">
              <label className="pf-label" htmlFor="phone">Phone Number <span className="pf-optional">(optional)</span></label>
              <input
                id="phone"
                name="phone"
                className="pf-input"
                value={form.phone}
                onChange={handleChange}
                placeholder="e.g. 780-555-0100"
                autoComplete="tel"
              />
            </div>

            <div className="pf-field">
              <label className="pf-label" htmlFor="address">Mailing Address <span className="pf-optional">(optional)</span></label>
              <textarea
                id="address"
                name="address"
                className="pf-textarea"
                value={form.address}
                onChange={handleChange}
                placeholder="Street, City, Province, Postal Code"
                autoComplete="street-address"
              />
            </div>

            <div className="pf-btn-row">
              <button type="submit" className="pf-btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button type="button" className="pf-btn-secondary" onClick={() => navigate(homeRoute())}>
                Cancel
              </button>
            </div>
          </form>
        </div>

        {/* Change password */}
        <div className="pf-card">
          <div className="pf-card-title">Password</div>
          {pwStatus === 'sent' && (
            <div className="pf-success-banner">
              Password reset email sent to {form.email}. Check your inbox.
            </div>
          )}
          {pwStatus === 'error' && (
            <div className="pf-error-banner">Failed to send reset email. Please try again.</div>
          )}
          <p className="pf-password-desc">
            To change your password, we'll send a reset link to your email address.
          </p>
          <button
            className="pf-btn-secondary"
            onClick={handleSendPasswordReset}
            disabled={pwSending || pwStatus === 'sent'}
          >
            {pwSending ? 'Sending…' : pwStatus === 'sent' ? 'Email Sent' : 'Send Password Reset Email'}
          </button>
        </div>

        {/* Documents */}
        <div className="pf-card">
          <div className="pf-card-title">Documents</div>
          {docUploadError && <div className="pf-error-banner">{docUploadError}</div>}
          {['resume', 'cover_letter'].map(type => (
            <div key={type} className="pf-doc-row">
              <div className="pf-doc-label">{type === 'resume' ? 'Resume' : 'Cover Letter'}</div>
              {documents[type] ? (
                <div className="pf-doc-info">
                  <span>{documents[type].original_filename}</span>
                  <a href={`/api/platform/documents/${type}/download`} className="pf-doc-link">Download</a>
                </div>
              ) : (
                <div className="pf-doc-info pf-doc-info--empty">No file on file</div>
              )}
              <label className="pf-btn-secondary pf-upload-label">
                {documents[type] ? 'Replace' : 'Upload'}
                <input
                  type="file"
                  accept=".pdf,.docx"
                  style={{ display: 'none' }}
                  onChange={e => {
                    handleDocUpload(type, e.target.files[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
