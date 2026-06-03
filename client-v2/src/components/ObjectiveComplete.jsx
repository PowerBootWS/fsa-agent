// client-v2/src/components/ObjectiveComplete.jsx

export function ObjectiveComplete({
  activeLessonCode,
  nextLessonCode,
  nextChapter,
  onContinue,
  onReview,
}) {
  const parts = activeLessonCode ? activeLessonCode.split('-') : [];
  const currentChapterNum = parts.length >= 2 ? parseInt(parts[1], 10) : null;
  const currentObjectiveNum = parts.length >= 3 ? parseInt(parts[2], 10) : null;

  let continueLabel = null;
  if (nextLessonCode) {
    const nextParts = nextLessonCode.split('-');
    const nextChapterNum = nextParts.length >= 2 ? parseInt(nextParts[1], 10) : null;
    const nextObjectiveNum = nextParts.length >= 3 ? parseInt(nextParts[2], 10) : null;
    if (nextChapterNum !== currentChapterNum) {
      continueLabel = `Start ${nextChapter?.label || `Chapter ${nextChapterNum}`} →`;
    } else {
      continueLabel = `Continue to Objective ${nextObjectiveNum} →`;
    }
  }

  return (
    <div className="objective-complete">
      <div className="objective-complete-icon">✓</div>
      <div className="objective-complete-title">
        Objective {currentObjectiveNum} complete
      </div>
      {!continueLabel && (
        <div className="objective-complete-course-done">
          You've completed this course.
        </div>
      )}
      <div className="objective-complete-actions">
        <button className="obj-complete-review-btn" onClick={onReview}>
          ← Review this Objective
        </button>
        {continueLabel && (
          <button className="obj-complete-continue-btn" onClick={onContinue}>
            {continueLabel}
          </button>
        )}
      </div>
    </div>
  );
}
