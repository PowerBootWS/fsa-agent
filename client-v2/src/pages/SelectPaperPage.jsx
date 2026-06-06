import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function SelectPaperPage() {
  const navigate = useNavigate();
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(null); // paper code being switched to
  const [error, setError] = useState(null);

  // If user already has an active paper, send them to lobby
  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('fsa_user') || '{}');
    if (stored.active_paper) {
      navigate('/lobby', { replace: true });
      return;
    }
    fetchPapers();
  }, []);

  async function fetchPapers() {
    try {
      const res = await fetch('/api/platform/papers-for-class', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load papers');
      const data = await res.json();
      setPapers(data.papers || []);
    } catch (err) {
      setError('Could not load available papers. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectPaper(paper) {
    setSwitching(paper);
    setError(null);
    try {
      const res = await fetch('/api/platform/switch-paper', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to select paper');
      }
      // Update localStorage with new active_paper
      const stored = JSON.parse(localStorage.getItem('fsa_user') || '{}');
      localStorage.setItem('fsa_user', JSON.stringify({ ...stored, active_paper: paper }));
      navigate('/lobby', { replace: true });
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setSwitching(null);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0f172a',
      color: '#e2e8f0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 16px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '40px', maxWidth: '480px' }}>
        <h1 style={{
          fontSize: '28px',
          fontWeight: '700',
          color: '#e2e8f0',
          margin: '0 0 12px 0',
        }}>
          Select Your Study Paper
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '16px', margin: 0 }}>
          Choose which exam paper you want to study
        </p>
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{ color: '#94a3b8', fontSize: '16px' }}>Loading papers…</div>
      )}

      {/* Error message */}
      {error && (
        <div style={{
          background: '#450a0a',
          border: '1px solid #7f1d1d',
          color: '#fca5a5',
          borderRadius: '8px',
          padding: '12px 20px',
          marginBottom: '24px',
          maxWidth: '480px',
          width: '100%',
          textAlign: 'center',
          fontSize: '14px',
        }}>
          {error}
        </div>
      )}

      {/* Paper grid */}
      {!loading && papers.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '16px',
          maxWidth: '480px',
          width: '100%',
        }}>
          {papers.map((paper) => {
            const isSelecting = switching === paper;
            return (
              <button
                key={paper}
                onClick={() => handleSelectPaper(paper)}
                disabled={switching !== null}
                style={{
                  background: isSelecting ? '#1e3a8a' : '#1e293b',
                  border: `2px solid ${isSelecting ? '#1d4ed8' : '#334155'}`,
                  borderRadius: '12px',
                  padding: '28px 16px',
                  cursor: switching !== null ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'border-color 0.15s, background 0.15s',
                  opacity: switching !== null && !isSelecting ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (switching === null) {
                    e.currentTarget.style.borderColor = '#1d4ed8';
                    e.currentTarget.style.background = '#1e3a8a';
                  }
                }}
                onMouseLeave={(e) => {
                  if (switching === null) {
                    e.currentTarget.style.borderColor = '#334155';
                    e.currentTarget.style.background = '#1e293b';
                  }
                }}
              >
                <span style={{
                  fontSize: '32px',
                  fontWeight: '800',
                  color: isSelecting ? '#93c5fd' : '#e2e8f0',
                  letterSpacing: '1px',
                }}>
                  {isSelecting ? '…' : paper}
                </span>
                <span style={{
                  fontSize: '11px',
                  color: '#94a3b8',
                  textAlign: 'center',
                  lineHeight: '1.4',
                }}>
                  Power Engineering{'\n'}Exam Paper
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
