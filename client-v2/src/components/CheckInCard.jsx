// client-v2/src/components/CheckInCard.jsx
import { QuestionCard } from './TutorPanel';

/**
 * CheckInCard — the pause every few slides (lesson tutor redesign, slice 4).
 *
 * Shown in place of the slide when a checkpoint is reached. It carries the
 * pre-written recap of the slides just covered (lesson_checkins), the lesson's
 * own practice question when there is one, and two ways on: a quick
 * multiple-choice exercise with the tutor, or straight back to the lesson.
 * Either part can be missing; the card renders whatever the checkpoint has.
 *
 * Props:
 *   checkin      — { from_slide, after_slide, recap_points[], exercise_prompt } | null
 *   question     — practice question | null
 *   lessonCode   — string
 *   onAnswer     — (entry) => void   (question answered)
 *   onExercise   — () => void        (omit to hide the button, e.g. no tutor)
 *   onContinue   — () => void
 */
export function CheckInCard({ checkin, question, lessonCode, onAnswer, onExercise, onContinue }) {
  const points = checkin?.recap_points || [];
  return (
    <div className="checkin-card" role="region" aria-label="Check-in">
      <div className="checkin-label">Quick check-in</div>
      {points.length > 0 && (
        <>
          <h2 className="checkin-title">What you just covered</h2>
          <ul className="checkin-points">
            {points.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </>
      )}
      {question && (
        <QuestionCard
          question={question}
          lessonCode={lessonCode}
          onAnswer={onAnswer}
          sublabel="On what you just covered. Pick an answer to see how you did."
        />
      )}
      {onExercise && checkin?.exercise_prompt && (
        <p className="checkin-offer">{checkin.exercise_prompt}</p>
      )}
      <div className="checkin-actions">
        {onExercise && (
          <button className="checkin-exercise" onClick={onExercise}>
            Quick exercise with the tutor
          </button>
        )}
        <button className="checkin-continue" onClick={onContinue}>Continue the lesson →</button>
      </div>
    </div>
  );
}
