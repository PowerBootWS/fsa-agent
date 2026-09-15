import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { track } from '../utils/usage';
import './SelectPaperPage.css';

export default function SelectPaperPage() {
  const navigate = useNavigate();
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(null); // paper code being switched to
  const [error, setError] = useState(null);

  // Reached either as first-time paper selection (no active_paper yet) or as an
  // explicit "Switch Paper" action (already has one) — both need the picker, so
  // this must NOT redirect away just because active_paper is already set.
  useEffect(() => {
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
        // The cooldown is the one failure a student can actually hit, and the
        // server already tells us how long is left. Surfacing the raw
        // `data.error` here printed the bare string "Paper switch cooldown",
        // which names the rule without saying what it means, how long it
        // lasts, or whether the paper they were on is still there.
        if (res.status === 429) {
          const days = Number(data.days_remaining);
          throw new Error(
            Number.isFinite(days) && days > 0
              ? `You've switched papers recently, so you can switch again in ${days} ${days === 1 ? 'day' : 'days'}. Your current paper stays open until then, and nothing is lost either way.`
              : 'You\'ve switched papers recently. Your current paper stays open in the meantime, and you can switch again shortly.'
          );
        }
        throw new Error(data.error || 'Failed to select paper');
      }
      // Update localStorage with new active_paper
      const stored = JSON.parse(localStorage.getItem('fsa_user') || '{}');
      localStorage.setItem('fsa_user', JSON.stringify({ ...stored, active_paper: paper }));
      track('feature_use', { action: 'paper_switched', props: { paper } });
      navigate('/lobby', { replace: true });
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setSwitching(null);
    }
  }

  return (
    <div className="sp-page">
      {/* Header */}
      <div className="sp-header">
        <div className="sp-eyebrow">
          Full Steam Ahead
        </div>
        <h1 className="sp-title">
          Select Your Study Paper
        </h1>
        <p className="sp-subtitle">
          Choose which exam paper you want to study
        </p>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="sp-loading">Loading papers…</div>
      )}

      {/* Error message */}
      {error && (
        <div className="sp-error">
          {error}
        </div>
      )}

      {/* Paper grid */}
      {!loading && papers.length > 0 && (
        <div className="sp-paper-grid">
          {papers.map((paper) => {
            const isSelecting = switching === paper;
            return (
              <button
                key={paper}
                onClick={() => handleSelectPaper(paper)}
                disabled={switching !== null}
                className={`sp-paper-btn${isSelecting ? ' sp-paper-btn--selecting' : ''}`}
              >
                <span className="sp-paper-code">
                  {isSelecting ? '…' : paper}
                </span>
                <span className="sp-paper-label">
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
