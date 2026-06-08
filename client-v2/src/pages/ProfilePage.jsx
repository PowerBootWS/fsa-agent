import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const s = {
  page: {
    minHeight: '100vh',
    background: '#0D1117',
    color: '#F4F5F7',
    fontFamily: "'Barlow', -apple-system, sans-serif",
  },
  header: {
    background: '#1C2333',
    borderBottom: '2px solid #E8720C',
    padding: '0 24px',
    height: '56px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    color: '#E8720C',
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: '700',
    fontSize: '20px',
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
  },
  backBtn: {
    background: 'transparent',
    border: '1px solid #252F42',
    borderRadius: '4px',
    color: '#a8b4c0',
    fontSize: '13px',
    padding: '6px 14px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  content: {
    maxWidth: '600px',
    margin: '0 auto',
    padding: '40px 24px 64px',
  },
  pageTitle: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: '28px',
    fontWeight: '700',
    color: '#F4F5F7',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    marginBottom: '8px',
  },
  pageSubtitle: {
    color: '#a8b4c0',
    fontSize: '14px',
    marginBottom: '32px',
  },
  card: {
    background: '#1C2333',
    border: '1px solid #252F42',
    borderRadius: '4px',
    padding: '28px 32px',
    marginBottom: '24px',
  },
  cardTitle: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: '13px',
    fontWeight: '700',
    color: '#a8b4c0',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: '20px',
  },
  fieldRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
    marginBottom: '16px',
  },
  field: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    color: '#a8b4c0',
    fontSize: '12px',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    background: '#0D1117',
    border: '1px solid #252F42',
    borderRadius: '4px',
    color: '#F4F5F7',
    fontSize: '14px',
    padding: '10px 12px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    outline: 'none',
  },
  inputReadonly: {
    width: '100%',
    background: '#0a0e17',
    border: '1px solid #1a2030',
    borderRadius: '4px',
    color: '#616f80',
    fontSize: '14px',
    padding: '10px 12px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    cursor: 'not-allowed',
  },
  textarea: {
    width: '100%',
    background: '#0D1117',
    border: '1px solid #252F42',
    borderRadius: '4px',
    color: '#F4F5F7',
    fontSize: '14px',
    padding: '10px 12px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    outline: 'none',
    minHeight: '80px',
    resize: 'vertical',
  },
  readonlyNote: {
    color: '#4a5568',
    fontSize: '11px',
    marginTop: '4px',
  },
  btnPrimary: {
    background: '#E8720C',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: '600',
    padding: '10px 24px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnSecondary: {
    background: 'transparent',
    color: '#a8b4c0',
    border: '1px solid #252F42',
    borderRadius: '4px',
    fontSize: '14px',
    padding: '10px 24px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnRow: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    marginTop: '8px',
  },
  successBanner: {
    background: 'rgba(82,168,130,0.12)',
    border: '1px solid rgba(82,168,130,0.3)',
    color: '#52A882',
    borderRadius: '4px',
    padding: '10px 16px',
    fontSize: '14px',
    marginBottom: '16px',
  },
  errorBanner: {
    background: 'rgba(220,38,38,0.12)',
    border: '1px solid rgba(220,38,38,0.25)',
    color: '#f87171',
    borderRadius: '4px',
    padding: '10px 16px',
    fontSize: '14px',
    marginBottom: '16px',
  },
  passwordBtn: {
    background: 'transparent',
    border: 'none',
    color: '#E8720C',
    fontSize: '14px',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'inherit',
    textDecoration: 'underline',
  },
  loadingWrap: {
    minHeight: '100vh',
    background: '#0D1117',
    color: '#a8b4c0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    fontFamily: "'Barlow', -apple-system, sans-serif",
  },
};

export default function ProfilePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // 'success' | 'error' | null
  const [saveError, setSaveError] = useState('');
  const [pwStatus, setPwStatus] = useState(null); // 'sent' | 'error' | null
  const [pwSending, setPwSending] = useState(false);

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
    return <div style={s.loadingWrap}>Loading your profile…</div>;
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.brand}>Full Steam Ahead</div>
        <button style={s.backBtn} onClick={() => navigate('/lobby')}>← Back to Lobby</button>
      </header>

      <div style={s.content}>
        <h1 style={s.pageTitle}>Your Profile</h1>
        <p style={s.pageSubtitle}>Update your personal information below.</p>

        {/* Profile form */}
        <div style={s.card}>
          <div style={s.cardTitle}>Personal Information</div>

          {saveStatus === 'success' && (
            <div style={s.successBanner}>Profile saved successfully.</div>
          )}
          {saveStatus === 'error' && (
            <div style={s.errorBanner}>{saveError}</div>
          )}

          <form onSubmit={handleSave}>
            <div style={s.fieldRow}>
              <div>
                <label style={s.label} htmlFor="first_name">First Name</label>
                <input
                  id="first_name"
                  name="first_name"
                  style={s.input}
                  value={form.first_name}
                  onChange={handleChange}
                  autoComplete="given-name"
                />
              </div>
              <div>
                <label style={s.label} htmlFor="last_name">Last Name</label>
                <input
                  id="last_name"
                  name="last_name"
                  style={s.input}
                  value={form.last_name}
                  onChange={handleChange}
                  autoComplete="family-name"
                />
              </div>
            </div>

            <div style={s.field}>
              <label style={s.label}>Email Address</label>
              <input
                style={s.inputReadonly}
                value={form.email}
                readOnly
                tabIndex={-1}
                autoComplete="email"
              />
              <div style={s.readonlyNote}>Email cannot be changed. Contact support if needed.</div>
            </div>

            <div style={s.field}>
              <label style={s.label} htmlFor="phone">Phone Number <span style={{ color: '#4a5568', fontWeight: 400 }}>(optional)</span></label>
              <input
                id="phone"
                name="phone"
                style={s.input}
                value={form.phone}
                onChange={handleChange}
                placeholder="e.g. 780-555-0100"
                autoComplete="tel"
              />
            </div>

            <div style={s.field}>
              <label style={s.label} htmlFor="address">Mailing Address <span style={{ color: '#4a5568', fontWeight: 400 }}>(optional)</span></label>
              <textarea
                id="address"
                name="address"
                style={s.textarea}
                value={form.address}
                onChange={handleChange}
                placeholder="Street, City, Province, Postal Code"
                autoComplete="street-address"
              />
            </div>

            <div style={s.btnRow}>
              <button type="submit" style={s.btnPrimary} disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button type="button" style={s.btnSecondary} onClick={() => navigate('/lobby')}>
                Cancel
              </button>
            </div>
          </form>
        </div>

        {/* Change password */}
        <div style={s.card}>
          <div style={s.cardTitle}>Password</div>
          {pwStatus === 'sent' && (
            <div style={s.successBanner}>
              Password reset email sent to {form.email}. Check your inbox.
            </div>
          )}
          {pwStatus === 'error' && (
            <div style={s.errorBanner}>Failed to send reset email. Please try again.</div>
          )}
          <p style={{ color: '#a8b4c0', fontSize: '14px', margin: '0 0 16px 0' }}>
            To change your password, we'll send a reset link to your email address.
          </p>
          <button
            style={s.btnSecondary}
            onClick={handleSendPasswordReset}
            disabled={pwSending || pwStatus === 'sent'}
          >
            {pwSending ? 'Sending…' : pwStatus === 'sent' ? 'Email Sent' : 'Send Password Reset Email'}
          </button>
        </div>
      </div>
    </div>
  );
}
