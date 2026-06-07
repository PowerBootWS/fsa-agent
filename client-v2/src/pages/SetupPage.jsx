import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0D1117',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    fontFamily: "'Barlow', -apple-system, sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: '400px',
    background: '#1C2333',
    border: '1px solid #252F42',
    borderTop: '3px solid #E8720C',
    borderRadius: '4px',
    padding: '40px 32px',
  },
  brand: {
    color: '#E8720C',
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: '24px',
    fontWeight: '700',
    marginBottom: '6px',
    textAlign: 'center',
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
  },
  heading: {
    color: '#F4F5F7',
    fontSize: '18px',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: '8px',
  },
  subtitle: {
    color: '#a8b4c0',
    fontSize: '13px',
    textAlign: 'center',
    marginBottom: '28px',
  },
  label: {
    display: 'block',
    color: '#a8b4c0',
    fontSize: '13px',
    marginBottom: '6px',
    fontWeight: '500',
  },
  input: {
    width: '100%',
    background: '#0D1117',
    border: '1px solid #252F42',
    borderRadius: '4px',
    color: '#F4F5F7',
    fontSize: '15px',
    padding: '10px 12px',
    marginBottom: '16px',
    boxSizing: 'border-box',
    outline: 'none',
    fontFamily: 'inherit',
    transition: 'border-color 0.2s',
  },
  button: {
    width: '100%',
    background: '#E8720C',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '15px',
    fontWeight: '600',
    padding: '12px 24px',
    cursor: 'pointer',
    marginTop: '8px',
    fontFamily: 'inherit',
    transition: 'background 0.2s',
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  error: {
    color: '#f87171',
    fontSize: '13px',
    marginTop: '12px',
    textAlign: 'center',
  },
  muted: {
    color: '#a8b4c0',
    fontSize: '14px',
    textAlign: 'center',
    marginTop: '16px',
  },
};

export default function SetupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [tokenValid, setTokenValid] = useState(null); // null = loading, true/false
  const [firstName, setFirstName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setTokenValid(false);
      return;
    }
    fetch(`/api/auth/setup?token=${encodeURIComponent(token)}`)
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          setTokenValid(true);
          setFirstName(data.first_name || '');
        } else {
          setTokenValid(false);
        }
      })
      .catch(() => setTokenValid(false));
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Setup failed. Please try again.');
        return;
      }
      localStorage.setItem('fsa_user', JSON.stringify(data.user));
      if (!data.user.active_paper) {
        navigate('/select-paper', { replace: true });
      } else {
        navigate('/lobby', { replace: true });
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brand}>Full Steam Ahead</div>

        {tokenValid === null && (
          <div style={styles.muted}>Validating your link…</div>
        )}

        {tokenValid === false && (
          <div style={styles.error}>
            This setup link is invalid or has expired. Please contact support.
          </div>
        )}

        {tokenValid === true && (
          <>
            <div style={styles.heading}>
              Welcome{firstName ? `, ${firstName}` : ''}!
            </div>
            <div style={styles.subtitle}>Set your password to get started.</div>

            <form onSubmit={handleSubmit}>
              <label style={styles.label} htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={styles.input}
                placeholder="Minimum 8 characters"
              />

              <label style={styles.label} htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                style={styles.input}
                placeholder="Re-enter password"
              />

              <button
                type="submit"
                disabled={loading}
                style={{ ...styles.button, ...(loading ? styles.buttonDisabled : {}) }}
              >
                {loading ? 'Creating account…' : 'Create Account'}
              </button>
            </form>

            {error && <div style={styles.error}>{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}
