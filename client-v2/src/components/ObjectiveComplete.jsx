// client-v2/src/components/ObjectiveComplete.jsx
import { useNavigate } from 'react-router-dom';

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

  const navigate = useNavigate();

  let continueLabel = null;
  // Last objective of its chapter: the next lesson is in another chapter, or
  // there is none. That's when the chapter quiz becomes the recommended step.
  let chapterFinished = !nextLessonCode;
  if (nextLessonCode) {
    const nextParts = nextLessonCode.split('-');
    const nextChapterNum = nextParts.length >= 2 ? parseInt(nextParts[1], 10) : null;
    const nextObjectiveNum = nextParts.length >= 3 ? parseInt(nextParts[2], 10) : null;
    if (nextChapterNum !== currentChapterNum) {
      chapterFinished = true;
      continueLabel = `Start ${nextChapter?.label || `Chapter ${nextChapterNum}`} →`;
    } else {
      continueLabel = `Continue to Objective ${nextObjectiveNum} →`;
    }
  }

  const paper = parts[0];
  const showQuiz = chapterFinished && paper && currentChapterNum !== null;
  const startQuiz = () => navigate(
    `/practice-exam?paper=${encodeURIComponent(paper)}&quiz=${encodeURIComponent(`${paper}-${currentChapterNum}`)}`
  );

  return (
    <div className="objective-complete">
      <div className="objective-complete-icon">✓</div>
      <div className="objective-complete-title">
        Objective {currentObjectiveNum} complete
      </div>
      {showQuiz && (
        <div className="objective-complete-quiz">
          <p className="objective-complete-quiz-text">
            You've completed the objective. Give the chapter quiz a try.
          </p>
          <button className="obj-complete-continue-btn" onClick={startQuiz}>
            Start Chapter {currentChapterNum} Quiz →
          </button>
        </div>
      )}
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
          <button
            className={showQuiz ? 'obj-complete-review-btn' : 'obj-complete-continue-btn'}
            onClick={onContinue}
          >
            {continueLabel}
          </button>
        )}
      </div>
    </div>
  );
}
