import React, { useState, useEffect } from 'react';

const COUNT_OPTIONS = [
  { count: 25,  label: '25 Questions', sublabel: '~45 min' },
  { count: 50,  label: '50 Questions', sublabel: '~1.5 hrs' },
  { count: 100, label: '100 Questions', sublabel: '~3 hrs' },
];

/**
 * Pre-exam lobby. Shows:
 *   Left panel  — question count selector, timer toggle, Start button.
 *   Right panel — per-chapter quiz buttons for inline chapter practice.
 *
 * Props:
 *   courseId           string   e.g. '2B1'
 *   user               string   user email (for fetching last results)
 *   lessonTitle        string   display name
 *   onStartExam        fn({count, timed}) — called when student clicks Start
 *   onSelectChapter    fn(chapterId)      — called when a chapter button is clicked
 *   onViewLastResults  fn(debrief)        — called when student wants to review last attempt
 */
export function PracticeExamLobby({ courseId, user, lessonTitle, onStartExam, onSelectChapter, onViewLastResults, leadMagnetMode = false }) {
  const [selectedCount, setSelectedCount] = useState(null);
  const [timed, setTimed] = useState(false);
  const [chapters, setChapters] = useState([]);
  const [chaptersLoading, setChaptersLoading] = useState(true);
  const [lastResults, setLastResults] = useState(null); // null = not yet checked

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
    fetch(`/api/exam/${encodeURIComponent(courseId)}/last-results?user=${encodeURIComponent(user)}`)
      .then(r => r.json())
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
        {/* ── Practice Exam panel ── */}
        <div className="lobby-panel">
          <h2 className="lobby-panel-heading">Practice Exam</h2>
          <p className="lobby-panel-desc">
            Adaptive exam drawn from all chapters — weighted to your weak areas after each attempt.
          </p>

          <div className="lobby-count-options">
            {(leadMagnetMode ? COUNT_OPTIONS.filter(o => o.count !== 100) : COUNT_OPTIONS).map(opt => (
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

          {lastResults && onViewLastResults && !leadMagnetMode && (
            <button
              className="lobby-review-btn"
              onClick={() => onViewLastResults(lastResults)}
            >
              Review most recent results
            </button>
          )}
        </div>

        {/* ── Chapter Quizzes panel ── */}
        <div className="lobby-panel">
          <h2 className="lobby-panel-heading">Chapter Quizzes</h2>
          <p className="lobby-panel-desc">
            Drill a specific chapter with a focused 8-question quiz.
          </p>

          {chaptersLoading ? (
            <p className="lobby-loading">Loading chapters…</p>
          ) : chapters.length === 0 ? (
            <p className="lobby-loading">No chapter quizzes available yet.</p>
          ) : (
            <div className="lobby-chapter-grid">
              {chapters.map(chapterId => {
                // Display as "Chapter N" by extracting the trailing number
                const parts = chapterId.split('-');
                const label = parts.length >= 2 ? `Chapter ${parts[parts.length - 1]}` : chapterId;
                if (leadMagnetMode) {
                  return (
                    <button
                      key={chapterId}
                      className="lobby-chapter-btn lobby-chapter-btn--locked"
                      disabled
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
          {leadMagnetMode && (
            <p className="lobby-chapter-locked-note">Chapter quizzes available with a full subscription</p>
          )}
        </div>
      </div>
    </div>
  );
}
