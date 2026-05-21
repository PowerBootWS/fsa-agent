import React from 'react';
import { MathContent } from './MathContent.jsx';

/**
 * TeachingNotes
 * Renders one card per missed objective with the LLM teaching tip.
 * If the chapter score is below 50%, shows a "Try Chapter Quiz" button.
 *
 * Props:
 *   objectiveBreakdowns  array  from display_update.objective_breakdowns
 *   chapterStats         array  from display_update.chapter_stats [{chapter, pct, ...}]
 *   onSelectChapter      fn(chapterId) — triggers inline chapter quiz
 */
export function TeachingNotes({ objectiveBreakdowns, chapterStats, onSelectChapter }) {
  if (!objectiveBreakdowns || objectiveBreakdowns.length === 0) return null;

  // Build a quick lookup: chapter_id → pct
  const chapterPctMap = {};
  (chapterStats || []).forEach(c => { chapterPctMap[c.chapter] = c.pct; });

  return (
    <div className="teaching-notes">
      <h2 className="teaching-notes-heading">Where to focus</h2>
      {objectiveBreakdowns.map((obj, i) => {
        const chapterPct = chapterPctMap[obj.chapter_id] ?? 100;
        const showQuizBtn = chapterPct < 50;
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
            {showQuizBtn && onSelectChapter && (
              <button
                className="teaching-card-quiz-btn"
                onClick={() => onSelectChapter(obj.chapter_id)}
              >
                📝 Try the Chapter Quiz instead →
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * NextAttemptPreview
 * Shows a visual breakdown of the predicted question allocation for the next exam.
 *
 * Props:
 *   nextAttemptAllocation  object  {chapter_id: count}
 *   totalCount             number  total questions in the exam
 */
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
          // Display as "Chapter N"
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
