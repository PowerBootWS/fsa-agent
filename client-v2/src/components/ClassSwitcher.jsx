import { useEffect, useState } from 'react';

// Shown only to a student who holds more than one class — e.g. a program student
// keeping 4th Class 4A for a jurisdictional rewrite while doing 3rd Class. The
// platform shows one class at a time; this picks which. (2026-10-21)
export default function ClassSwitcher({ onSwitched }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/platform/classes', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setData(d); })
      .catch(() => {});
  }, []);

  if (!data || !Array.isArray(data.classes) || data.classes.length < 2) return null;

  async function choose(key) {
    if (key === data.current || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/platform/active-class', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) throw new Error('switch failed');
      // Refresh the cached account snapshot the rest of the app reads.
      const me = await fetch('/api/platform/me', { credentials: 'include' }).then(r => (r.ok ? r.json() : null));
      if (me) {
        const stored = JSON.parse(localStorage.getItem('fsa_user') || '{}');
        localStorage.setItem('fsa_user', JSON.stringify({ ...stored, class_code: me.class_code, active_paper: me.active_paper }));
      }
      if (onSwitched) onSwitched(key);
      else window.location.assign('/lobby');
    } catch {
      setError("Couldn't switch. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="as-class-switcher" role="group" aria-label="Choose course">
      <div className="as-class-switcher-label">Course</div>
      {data.classes.map(c => (
        <button
          key={c.key}
          type="button"
          className={`as-class-option${c.key === data.current ? ' as-class-option--active' : ''}`}
          aria-pressed={c.key === data.current}
          disabled={busy}
          onClick={() => choose(c.key)}
        >
          {c.label}
        </button>
      ))}
      {error && <div className="as-class-switcher-error" role="alert">{error}</div>}
    </div>
  );
}
