// Display only: the exam view owns the clock (see examClock.js) so it can pause, survive a
// refresh and send the time with each answer. Past the limit it counts up: the student keeps
// going and the results show how far over they went.
export function CountdownTimer({ totalSeconds, elapsed, paused = false }) {
  const remaining = totalSeconds - elapsed;
  const isOver = remaining < 0;
  const displaySeconds = Math.abs(remaining);

  const h = Math.floor(displaySeconds / 3600);
  const m = Math.floor((displaySeconds % 3600) / 60);
  const s = displaySeconds % 60;

  const formatted = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;

  const display = isOver ? `+${formatted}` : formatted;
  const warn = !isOver && remaining <= 600;

  return (
    <span className={`exam-timer${isOver ? ' exam-timer--over' : warn ? ' exam-timer--warn' : ''}`}>
      ⏱ {display}{paused ? ' (Paused)' : ''}
    </span>
  );
}
