import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

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
  subtitle: {
    color: '#a8b4c0',
    fontSize: '13px',
    textAlign: 'center',
    marginBottom: '32px',
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
  forgotLink: {
    display: 'block',
    textAlign: 'center',
    marginTop: '16px',
    color: '#a8b4c0',
    fontSize: '13px',
    textDecoration: 'none',
  },
  enrollText: {
    textAlign: 'center',
    marginTop: '12px',
    color: '#a8b4c0',
    fontSize: '13px',
  },
  enrollLink: {
    color: '#4da3ff',
    textDecoration: 'none',
  },
};

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed. Please check your credentials.');
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
        <div style={styles.subtitle}>Power Engineering Exam Prep</div>

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

          <label style={styles.label} htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={styles.input}
            placeholder="••••••••"
          />

          <button
            type="submit"
            disabled={loading}
            style={{ ...styles.button, ...(loading ? styles.buttonDisabled : {}) }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        {error && <div style={styles.error}>{error}</div>}

        <Link to="/forgot-password" style={styles.forgotLink}>
          Forgot password?
        </Link>

        <div style={styles.enrollText}>
          Not enrolled?{' '}
          <a href="https://fullsteamahead.ca/enroll" style={styles.enrollLink}>
            Sign up here.
          </a>
        </div>
      </div>
    </div>
  );
}
