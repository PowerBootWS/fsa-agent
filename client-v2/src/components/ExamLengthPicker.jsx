// Practice exam length: 50 or 100 questions (25 removed with the leveled exams, 2026-11-22).
export const EXAM_LENGTHS = [50, 100];

export default function ExamLengthPicker({ value, onChange, leveled = false }) {
  return (
    <>
      <div className="lb-count-group">
        {EXAM_LENGTHS.map(n => (
          <button
            key={n}
            type="button"
            className={`lb-count-btn${value === n ? ' lb-count-btn--active' : ''}`}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
      {leveled && (
        <p className="lb-count-note">Follows the typical real-exam mix. Difficulty adapts to your level in each topic.</p>
      )}
    </>
  );
}
