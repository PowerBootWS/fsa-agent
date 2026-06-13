import { useState } from 'react';
import { MathContent } from './MathContent.jsx';
import { InlineLessonPlayer } from './InlineLessonPlayer.jsx';

export function TeachingNotes({ objectiveBreakdowns, chapterStats, onSelectChapter }) {
  // Which card's lesson is expanded — accordion: only one open at a time.
  const [openIdx, setOpenIdx] = useState(null);

  if (!objectiveBreakdowns || objectiveBreakdowns.length === 0) return null;

  const chapterPctMap = {};
  (chapterStats || []).forEach(c => { chapterPctMap[c.chapter] = c.pct; });

  return (
    <div className="teaching-notes">
      <h2 className="teaching-notes-heading">Where to focus</h2>
      {objectiveBreakdowns.map((obj, i) => {
        const chapterPct = chapterPctMap[obj.chapter_id] ?? 100;
        const showQuizBtn = chapterPct < 50;
        const isOpen = openIdx === i;
        return (
          <div key={i} className="teaching-card">
            <div className="teaching-card-header">
              <span className="teaching-card-location">
                Chapter {obj.chapter_num} · Objective {obj.objective_num}
              </span>
              {obj.topic && (
                <span className="teaching-card-topic">{obj.topic}</span>
              )}
            </div>
            <p className="teaching-card-tip"><MathContent text={obj.teaching_tip} /></p>
            <div className="teaching-card-actions">
              {obj.lesson_code && (
                <button
                  className="teaching-card-lesson-btn"
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                  aria-expanded={isOpen}
                >
                  {isOpen ? '▲ Hide lesson' : '▶ Watch a lesson on this'}
                </button>
              )}
              {showQuizBtn && onSelectChapter && (
                <button
                  className="teaching-card-quiz-btn"
                  onClick={() => onSelectChapter(obj.chapter_id)}
                >
                  📝 Try the Chapter Quiz instead →
                </button>
              )}
            </div>
            {isOpen && obj.lesson_code && (
              <InlineLessonPlayer lessonCode={obj.lesson_code} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function NextAttemptPreview({ nextAttemptAllocation, totalCount }) {
  if (!nextAttemptAllocation) return null;

  const entries = Object.entries(nextAttemptAllocation).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return null;

  const numChapters = entries.length;
  const baseline = Math.round(totalCount / numChapters);
  const maxCount = Math.max(...entries.map(([, c]) => c));

  return (
    <div className="next-attempt-preview">
      <h2 className="next-attempt-heading">Your next exam will look like this</h2>
      <div className="next-attempt-rows">
        {entries.map(([chapterId, count]) => {
          const barWidth = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
          const moreFocus = count > baseline;
          const parts = chapterId.split('-');
          const label = parts.length >= 2 ? `Chapter ${parts[parts.length - 1]}` : chapterId;
          return (
            <div key={chapterId} className="next-attempt-row">
              <span className="next-attempt-label">{label}</span>
              <div className="next-attempt-bar-wrap">
                <div className="next-attempt-bar" style={{ width: `${barWidth}%` }} />
              </div>
              <span className="next-attempt-count">{count}q</span>
              {moreFocus && (
                <span className="next-attempt-flag">↑ more focus</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
