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
      background: '#0D1117',
      color: '#F4F5F7',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 16px',
      fontFamily: "'Barlow', -apple-system, sans-serif",
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '40px', maxWidth: '480px' }}>
        <div style={{ color: '#E8720C', fontFamily: "'Barlow Condensed', sans-serif", fontSize: '13px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '12px' }}>
          Full Steam Ahead
        </div>
        <h1 style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: '30px',
          fontWeight: '700',
          color: '#F4F5F7',
          margin: '0 0 12px 0',
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
        }}>
          Select Your Study Paper
        </h1>
        <p style={{ color: '#a8b4c0', fontSize: '15px', margin: 0 }}>
          Choose which exam paper you want to study
        </p>
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{ color: '#a8b4c0', fontSize: '16px' }}>Loading papers…</div>
      )}

      {/* Error message */}
      {error && (
        <div style={{
          background: 'rgba(220,38,38,0.12)',
          border: '1px solid rgba(220,38,38,0.3)',
          color: '#fca5a5',
          borderRadius: '4px',
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
                  background: isSelecting ? 'rgba(232,114,12,0.15)' : '#1C2333',
                  border: `2px solid ${isSelecting ? '#E8720C' : '#252F42'}`,
                  borderRadius: '4px',
                  padding: '28px 16px',
                  cursor: switching !== null ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'border-color 0.15s, background 0.15s',
                  opacity: switching !== null && !isSelecting ? 0.5 : 1,
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => {
                  if (switching === null) {
                    e.currentTarget.style.borderColor = '#E8720C';
                    e.currentTarget.style.background = 'rgba(232,114,12,0.1)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (switching === null) {
                    e.currentTarget.style.borderColor = '#252F42';
                    e.currentTarget.style.background = '#1C2333';
                  }
                }}
              >
                <span style={{
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontSize: '32px',
                  fontWeight: '800',
                  color: isSelecting ? '#E8720C' : '#F4F5F7',
                  letterSpacing: '1px',
                }}>
                  {isSelecting ? '…' : paper}
                </span>
                <span style={{
                  fontSize: '11px',
                  color: '#a8b4c0',
                  textAlign: 'center',
                  lineHeight: '1.4',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
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
