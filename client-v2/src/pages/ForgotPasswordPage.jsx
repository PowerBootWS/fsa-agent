import { useState } from 'react';
import { Link } from 'react-router-dom';

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0f172a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  card: {
    width: '100%',
    maxWidth: '400px',
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '12px',
    padding: '40px 32px',
  },
  brand: {
    color: '#1d4ed8',
    fontSize: '22px',
    fontWeight: '700',
    marginBottom: '8px',
    textAlign: 'center',
  },
  heading: {
    color: '#e2e8f0',
    fontSize: '18px',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: '8px',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: '13px',
    textAlign: 'center',
    marginBottom: '28px',
  },
  label: {
    display: 'block',
    color: '#94a3b8',
    fontSize: '13px',
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '6px',
    color: '#e2e8f0',
    fontSize: '15px',
    padding: '10px 12px',
    marginBottom: '16px',
    boxSizing: 'border-box',
    outline: 'none',
  },
  button: {
    width: '100%',
    background: '#1d4ed8',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '15px',
    fontWeight: '600',
    padding: '12px 24px',
    cursor: 'pointer',
    marginTop: '8px',
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  success: {
    color: '#4ade80',
    fontSize: '14px',
    textAlign: 'center',
    marginTop: '16px',
    lineHeight: '1.5',
  },
  error: {
    color: '#f87171',
    fontSize: '13px',
    marginTop: '12px',
    textAlign: 'center',
  },
  backLink: {
    display: 'block',
    textAlign: 'center',
    marginTop: '20px',
    color: '#94a3b8',
    fontSize: '13px',
    textDecoration: 'none',
  },
};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      // Always show the generic success message — never reveal whether email exists
      if (res.ok || res.status === 404) {
        setSent(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Something went wrong. Please try again.');
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
        <div style={styles.heading}>Reset your password</div>
        <div style={styles.subtitle}>
          Enter your account email and we'll send a reset link.
        </div>

        {!sent ? (
          <>
            <form onSubmit={handleSubmit}>
              <label style={styles.label} htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={styles.input}
                placeholder="you@example.com"
              />

              <button
                type="submit"
                disabled={loading}
                style={{ ...styles.button, ...(loading ? styles.buttonDisabled : {}) }}
              >
                {loading ? 'Sending…' : 'Send Reset Link'}
              </button>
            </form>
            {error && <div style={styles.error}>{error}</div>}
          </>
        ) : (
          <div style={styles.success}>
            If that email exists in our system, a reset link has been sent. Check your inbox.
          </div>
        )}

        <Link to="/login" style={styles.backLink}>
          ← Back to login
        </Link>
      </div>
    </div>
  );
}
