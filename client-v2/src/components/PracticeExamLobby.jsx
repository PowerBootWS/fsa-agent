import { useState, useEffect } from 'react';

const COUNT_OPTIONS = [
  { count: 25,  label: '25 Questions', sublabel: '~45 min' },
  { count: 50,  label: '50 Questions', sublabel: '~1.5 hrs' },
  { count: 100, label: '100 Questions', sublabel: '~3 hrs' },
];

export function PracticeExamLobby({ courseId, user, lessonTitle, onStartExam, onSelectChapter, onViewLastResults, leadMagnetMode = false }) {
  const [selectedCount, setSelectedCount] = useState(null);
  const [timed, setTimed] = useState(false);
  const [chapters, setChapters] = useState([]);
  const [chaptersLoading, setChaptersLoading] = useState(true);
  const [lastResults, setLastResults] = useState(null);

  useEffect(() => {
    fetch(`/api/exam/${encodeURIComponent(courseId)}/chapters`)
      .then(r => r.json())
      .then(data => setChapters(data.chapters || []))
      .catch(() => setChapters([]))
      .finally(() => setChaptersLoading(false));
  }, [courseId]);

  useEffect(() => {
    if (!user) return;
    if (leadMagnetMode) return;
    // Backlog #88: identity comes from the session cookie server-side now,
    // not a ?user= query param, so this must send credentials.
    fetch(`/api/exam/${encodeURIComponent(courseId)}/last-results`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { available: false }))
      .then(data => setLastResults(data.available ? data : null))
      .catch(() => setLastResults(null));
  }, [courseId, user]);

  const handleStart = () => {
    if (!selectedCount) return;
    onStartExam({ count: selectedCount, timed });
  };

  return (
    <div className="lobby-page">
      <h1 className="lobby-title">{lessonTitle || courseId}</h1>
      <p className="lobby-subtitle">Choose how you want to practice</p>

      <div className="lobby-panels">
        <div className="lobby-panel">
          <h2 className="lobby-panel-heading">Practice Exam</h2>
          <p className="lobby-panel-desc">
            Adaptive exam drawn from all chapters — weighted to your weak areas after each attempt.
          </p>

          <div className="lobby-count-options">
            {COUNT_OPTIONS.map(opt => (
              <button
                key={opt.count}
                className={`lobby-count-btn${selectedCount === opt.count ? ' lobby-count-btn--selected' : ''}`}
                onClick={() => setSelectedCount(opt.count)}
              >
                <span className="lobby-count-label">{opt.label}</span>
                <span className="lobby-count-sublabel">{opt.sublabel}</span>
              </button>
            ))}
          </div>

          <label className="lobby-timer-toggle">
            <input
              type="checkbox"
              checked={timed}
              onChange={e => setTimed(e.target.checked)}
            />
            <span className="lobby-timer-label">⏱ Timed Exam</span>
          </label>
          {timed && (
            <p className="lobby-timer-note">Countdown starts when your first question loads.</p>
          )}

          <button
            className="lobby-start-btn"
            onClick={handleStart}
            disabled={!selectedCount}
          >
            Start Exam →
          </button>

          {lastResults && onViewLastResults && (
            <button
              className="lobby-review-btn"
              onClick={() => onViewLastResults(lastResults)}
            >
              Review most recent results
            </button>
          )}
        </div>

        <div className="lobby-panel">
          <h2 className="lobby-panel-heading">Chapter Quizzes</h2>
          <p className="lobby-panel-desc">
            Drill a specific chapter with a focused quiz — up to 15 questions, drawn
            randomly each time.
          </p>

          {chaptersLoading ? (
            <p className="lobby-loading">Loading chapters…</p>
          ) : chapters.length === 0 ? (
            <p className="lobby-loading">No chapter quizzes available yet.</p>
          ) : (
            <div className="lobby-chapter-grid">
              {chapters.map(chapterId => {
                const parts = chapterId.split('-');
                const label = parts.length >= 2 ? `Chapter ${parts[parts.length - 1]}` : chapterId;
                if (leadMagnetMode) {
                  // Chapter quizzes are a member-only feature — show what's
                  // available on a subscription without letting a lead
                  // start one (matches the live v1 practice-preview flow).
                  return (
                    <button
                      key={chapterId}
                      className="lobby-chapter-btn lobby-chapter-btn--locked"
                      disabled
                      title="Subscribe to unlock chapter quizzes"
                    >
                      🔒 {label}
                    </button>
                  );
                }
                return (
                  <button
                    key={chapterId}
                    className="lobby-chapter-btn"
                    onClick={() => onSelectChapter(chapterId)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
