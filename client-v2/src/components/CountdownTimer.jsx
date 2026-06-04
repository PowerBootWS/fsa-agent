import { useState, useEffect, useRef } from 'react';

export function CountdownTimer({ totalSeconds, stopped = false }) {
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (stopped) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [stopped]);

  const remaining = totalSeconds - elapsed;
  const isOver = remaining <= 0;
  const displaySeconds = isOver ? -remaining : remaining;

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
      ⏱ {display}
    </span>
  );
}
