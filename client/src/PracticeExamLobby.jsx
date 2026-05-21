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
 *   courseId       string   e.g. '2B1'
 *   lessonTitle    string   display name
 *   onStartExam    fn({count, timed}) — called when student clicks Start
 *   onSelectChapter fn(chapterId)     — called when a chapter button is clicked
 */
export function PracticeExamLobby({ courseId, lessonTitle, onStartExam, onSelectChapter }) {
  const [selectedCount, setSelectedCount] = useState(null);
  const [timed, setTimed] = useState(false);
  const [chapters, setChapters] = useState([]);
  const [chaptersLoading, setChaptersLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/exam/${encodeURIComponent(courseId)}/chapters`)
      .then(r => r.json())
      .then(data => setChapters(data.chapters || []))
      .catch(() => setChapters([]))
      .finally(() => setChaptersLoading(false));
  }, [courseId]);

  const handleStart = () => {
    if (!selectedCount) return;
    onStartExam({ count: selectedCount, timed });
  };

  return (
    <div className="lobby-page">
      <h1 className="lobby-title">{lessonTitle || courseId}</h1>
      <p className="lobby-subtitle">Choose how you want to practise</p>

      <div className="lobby-panels">
        {/* ── Practice Exam panel ── */}
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
