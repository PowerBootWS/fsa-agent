import { useState } from 'react';
import './ExamStyleCard.css';

const STYLES = [
  ['leveled', 'Leveled (recommended)', 'Follows the typical real-exam mix. Difficulty adapts to your level in each topic.'],
  ['adaptive', 'Previous adaptive exam', 'More questions from the chapters you have been weaker in.'],
];

// Profile card: the student's practice exam style while the leveled exam rolls out.
// Shown only when the leveled exam is available for their paper.
export default function ExamStyleCard({ available, engine }) {
  const [value, setValue] = useState(engine === 'adaptive' ? 'adaptive' : 'leveled');
  const [status, setStatus] = useState(null); // 'saved' | 'error' | null
  if (!available) return null;

  async function choose(next) {
    const prev = value;
    setValue(next);
    setStatus(null);
    try {
      const res = await fetch('/api/platform/exam-engine', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: next }),
      });
      if (!res.ok) throw new Error('save failed');
      setStatus('saved');
    } catch {
      setValue(prev);
      setStatus('error');
    }
  }

  return (
    <div className="pf-card">
      <div className="pf-card-title">Practice exam style</div>
      <div className="es-options" role="radiogroup" aria-label="Practice exam style">
        {STYLES.map(([key, label, desc]) => (
          <label key={key} className="es-option">
            <input type="radio" name="exam-style" value={key} checked={value === key}
                   onChange={() => choose(key)} aria-label={label} />
            <span className="es-text"><span className="es-label">{label}</span><span className="es-desc">{desc}</span></span>
          </label>
        ))}
      </div>
      {status === 'saved' && <div className="es-status">Saved</div>}
      {status === 'error' && <div className="pf-error-banner">We couldn't save that. Check your connection and try again.</div>}
    </div>
  );
}
