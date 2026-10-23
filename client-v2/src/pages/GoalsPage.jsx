import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { track } from '../utils/usage';
import { examCountdown, TextOptIn } from '../components/CoachingCard';
import './GoalsPage.css';

// Goal setting (backlog #139): four short steps, then the plan. Every answer
// can be changed later by coming back here.

const STEPS = ['when', 'shift', 'where', 'weekly'];

function nextMonths(n, from = new Date()) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(from.getFullYear(), from.getMonth() + i, 1));
    out.push({
      value: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    });
  }
  return out;
}

function Choice({ selected, onClick, children }) {
  return (
    <button type="button" className={`gl-choice${selected ? ' gl-choice--on' : ''}`} aria-pressed={selected} onClick={onClick}>
      {children}
    </button>
  );
}

export default function GoalsPage() {
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [texting, setTexting] = useState(null);

  useEffect(() => {
    fetch('/api/platform/coaching', { credentials: 'include' })
      .then(res => {
        if (res.status === 401) { navigate('/login', { replace: true }); return null; }
        return res.ok ? res.json() : Promise.reject();
      })
      .then(d => {
        if (!d) return;
        setState(d);
        const g = d.goal;
        setForm({
          paper: g?.paper || d.active_paper || d.papers?.[0] || '',
          date_is_exact: g ? g.date_is_exact : false,
          target_date: g ? (g.date_is_exact ? g.target_date : g.target_date.slice(0, 7)) : '',
          exam_booked: g ? g.exam_booked : false,
          shift_pattern: g?.shift_pattern || '',
          shift_other: g?.shift_other || '',
          study_places: g?.study_places || [],
          weekly_sessions: g?.weekly_sessions || null,
        });
      })
      .catch(() => setFailed(true));
  }, [navigate]);

  if (failed) return <div className="gl-page"><p>Couldn't load this right now. Try again in a minute.</p></div>;
  if (!state || !form) return <div className="gl-page"><p className="gl-muted">Loading…</p></div>;
  if (!state.eligible) {
    return (
      <div className="gl-page">
        <h1>Your goal</h1>
        <p>Goal setting is for 2nd and 3rd Class students for now.</p>
        <Link className="gl-link" to="/home">Back to Home</Link>
      </div>
    );
  }

  const set = patch => { setError(''); setForm(f => ({ ...f, ...patch })); };
  const togglePlace = p => set({ study_places: form.study_places.includes(p) ? form.study_places.filter(x => x !== p) : [...form.study_places, p] });

  function stepValid(name) {
    if (name === 'when') return Boolean(form.paper && form.target_date && (!form.date_is_exact || /^\d{4}-\d{2}-\d{2}$/.test(form.target_date)));
    if (name === 'shift') return Boolean(form.shift_pattern && (form.shift_pattern !== 'other' || form.shift_other.trim()));
    if (name === 'where') return form.study_places.length > 0;
    return Boolean(form.weekly_sessions);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/platform/coaching/goal', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't save your goal. Try again in a minute.");
      track('feature_use', { action: state.goal ? 'goal_updated' : 'goal_set' });
      setSaved(d.goal);
      // Offer text check-ins on the plan screen (the goal now exists).
      fetch('/api/platform/coaching', { credentials: 'include' })
        .then(r => (r.ok ? r.json() : null)).then(st => { if (st?.texting) setTexting(st.texting); }).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    const o = state.options;
    return (
      <div className="gl-page">
        <h1>Here's your plan</h1>
        <div className="gl-card">
          <div className="gl-big">{examCountdown(saved)}</div>
          <ul className="gl-plan">
            <li>{saved.weekly_sessions} study sessions a week. Twenty minutes counts.</li>
            <li>Mostly {saved.study_places.map(p => o.study_places[p].toLowerCase()).join(', ')}, around {saved.shift_pattern === 'other' ? 'your schedule' : o.shift_patterns[saved.shift_pattern].toLowerCase()}.</li>
            <li>{saved.exam_booked ? "It's booked. That's the hardest part done." : "Next step: book it. I'll check in about that in two weeks."}</li>
          </ul>
          <p className="gl-muted">You'll see a short note from me on your Home page each week on how you're tracking, and the day after your exam I'll ask how it went.</p>
          {texting && <div className="gl-text"><TextOptIn texting={texting} onChange={setTexting} /></div>}
          <div className="gl-actions">
            <Link className="gl-btn" to="/lobby">Start a session</Link>
            <Link className="gl-link" to="/home">Back to Home</Link>
          </div>
        </div>
      </div>
    );
  }

  const name = STEPS[step];
  const o = state.options;
  return (
    <div className="gl-page">
      <h1>{state.goal ? 'Update your goal' : "Let's set a goal"}</h1>
      <div className="gl-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => <span key={s} className={`gl-dot${i <= step ? ' gl-dot--on' : ''}`} />)}
      </div>
      <div className="gl-card">
        {name === 'when' && (
          <>
            <h2>Which paper, and when do you want to write it?</h2>
            {state.papers.length > 1 && (
              <div className="gl-choices">
                {state.papers.map(p => <Choice key={p} selected={form.paper === p} onClick={() => set({ paper: p })}>{p}</Choice>)}
              </div>
            )}
            <div className="gl-choices">
              <Choice selected={!form.date_is_exact} onClick={() => set({ date_is_exact: false, target_date: '' })}>I know the month</Choice>
              <Choice selected={form.date_is_exact} onClick={() => set({ date_is_exact: true, target_date: '' })}>I have the exact date</Choice>
            </div>
            {form.date_is_exact ? (
              <label className="gl-field">Exam date
                <input type="date" value={form.target_date} min={new Date().toISOString().slice(0, 10)} onChange={e => set({ target_date: e.target.value })} />
              </label>
            ) : (
              <label className="gl-field">Month
                <select value={form.target_date} onChange={e => set({ target_date: e.target.value })}>
                  <option value="">Pick a month</option>
                  {nextMonths(18).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </label>
            )}
            <h3>Have you booked it yet?</h3>
            <div className="gl-choices">
              <Choice selected={form.exam_booked} onClick={() => set({ exam_booked: true })}>Yes</Choice>
              <Choice selected={!form.exam_booked} onClick={() => set({ exam_booked: false })}>Not yet</Choice>
            </div>
          </>
        )}
        {name === 'shift' && (
          <>
            <h2>What does your work schedule look like?</h2>
            <div className="gl-choices">
              {Object.entries(o.shift_patterns).map(([k, label]) => (
                <Choice key={k} selected={form.shift_pattern === k} onClick={() => set({ shift_pattern: k })}>{label}</Choice>
              ))}
            </div>
            {form.shift_pattern === 'other' && (
              <label className="gl-field">Tell me a bit about it
                <input type="text" maxLength={200} value={form.shift_other} onChange={e => set({ shift_other: e.target.value })} />
              </label>
            )}
          </>
        )}
        {name === 'where' && (
          <>
            <h2>Where does most of your studying happen?</h2>
            <p className="gl-muted">Pick as many as fit.</p>
            <div className="gl-choices">
              {Object.entries(o.study_places).map(([k, label]) => (
                <Choice key={k} selected={form.study_places.includes(k)} onClick={() => togglePlace(k)}>{label}</Choice>
              ))}
            </div>
          </>
        )}
        {name === 'weekly' && (
          <>
            <h2>What's realistic each week?</h2>
            <p className="gl-muted">A session is one sitting with the course, even twenty minutes. Pick a number you can actually keep.</p>
            <div className="gl-choices">
              {o.weekly_sessions.map(n => (
                <Choice key={n} selected={form.weekly_sessions === n} onClick={() => set({ weekly_sessions: n })}>{n === 5 ? '5+' : n} a week</Choice>
              ))}
            </div>
          </>
        )}
        {error && <p className="gl-error" role="alert">{error}</p>}
        <div className="gl-actions">
          {step > 0 && <button type="button" className="gl-btn gl-btn--ghost" onClick={() => setStep(step - 1)}>Back</button>}
          {step < STEPS.length - 1 ? (
            <button type="button" className="gl-btn" disabled={!stepValid(name)} onClick={() => setStep(step + 1)}>Next</button>
          ) : (
            <button type="button" className="gl-btn" disabled={!stepValid(name) || saving} onClick={save}>{saving ? 'Saving…' : 'Save my goal'}</button>
          )}
          <Link className="gl-link" to="/home">Not now</Link>
        </div>
      </div>
    </div>
  );
}
