import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { track } from '../utils/usage';

// Goal setting on Home (backlog #139). Three states:
//   - invite: "Want a hand setting a goal?" (let's do it / not now / no thanks)
//   - goal set: a "From Russ" note when there is one, plus the plan
//   - otherwise nothing
// The read never breaks Home: any failure renders nothing.

function post(url, body) {
  return fetch(url, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
}

export function examCountdown(goal, today = new Date()) {
  if (!goal?.target_date) return null;
  const target = new Date(`${goal.target_date}T12:00:00Z`);
  if (!goal.date_is_exact) {
    return `${goal.paper} exam in ${target.toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
  }
  const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate()) - t0) / 86400000);
  if (days > 1) return `${goal.paper} exam in ${days} days`;
  if (days === 1) return `${goal.paper} exam tomorrow`;
  if (days === 0) return `${goal.paper} exam today. Good luck.`;
  return `${goal.paper} exam was on ${target.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', timeZone: 'UTC' })}`;
}

function Note({ message, onDone }) {
  const [reply, setReply] = useState(null);
  const [busy, setBusy] = useState(false);

  async function answer(key) {
    setBusy(true);
    try {
      const res = await post(`/api/platform/coaching/messages/${message.id}/answer`, { answer: key });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error();
      track('feature_use', { action: 'coaching_answer', props: { answer: key } });
      setReply(d);
    } catch {
      setReply({ reply: "Couldn't save that, try again in a minute." });
    } finally {
      setBusy(false);
    }
  }

  function gotIt() {
    post(`/api/platform/coaching/messages/${message.id}/seen`).catch(() => {});
    onDone();
  }

  if (reply) {
    return (
      <div className="cc-note">
        <div className="cc-from">From Russ</div>
        <p>{reply.reply}</p>
        <div className="hm-actions">
          {reply.link && <Link className="hm-btn hm-btn--small" to={reply.link}>Update my goal</Link>}
          <button type="button" className="hm-btn hm-btn--ghost hm-btn--small" onClick={onDone}>Close</button>
        </div>
      </div>
    );
  }
  return (
    <div className="cc-note">
      <div className="cc-from">From Russ</div>
      <p>{message.body}</p>
      <div className="hm-actions">
        {message.answers
          ? message.answers.map(a => (
            <button key={a.key} type="button" className="hm-btn hm-btn--small" disabled={busy} onClick={() => answer(a.key)}>{a.label}</button>
          ))
          : <button type="button" className="hm-btn hm-btn--ghost hm-btn--small" onClick={gotIt}>Got it</button>}
      </div>
    </div>
  );
}

// Text check-ins (backlog #139 phase 4). Offered to students with a goal.
// Never called SMS to students, always "text".
export function TextOptIn({ texting, onChange }) {
  const [phone, setPhone] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!texting) return null;
  if (texting.on) {
    const off = async () => {
      if (!window.confirm('Turn off text check-ins?')) return;
      await post('/api/platform/coaching/texting/off').catch(() => {});
      track('feature_use', { action: 'texting_off' });
      onChange({ ...texting, on: false, offer: false });
    };
    return (
      <p className="hm-muted cc-text-status">
        Text check-ins are on (number ending {texting.phone_last4}).{' '}
        <button type="button" className="cc-quiet" onClick={off}>Turn off</button>
      </p>
    );
  }
  if (!texting.offer) return null;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await post('/api/platform/coaching/texting', { phone, agree });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't set that up. Try again in a few minutes.");
      track('feature_use', { action: 'texting_on' });
      onChange({ ...texting, on: true, offer: false, phone_last4: d.phone_last4 });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  function decline() {
    post('/api/platform/coaching/texting/decline').catch(() => {});
    track('feature_use', { action: 'texting_declined' });
    onChange({ ...texting, offer: false });
  }

  return (
    <form className="cc-text" onSubmit={submit}>
      <p><strong>Want me to text you now and then?</strong> Quick check-ins on your goal, a nudge when it's been quiet, and you can text me back. Studying only, never sales.</p>
      <label className="cc-text-field">Mobile number
        <input type="tel" inputMode="tel" autoComplete="tel" placeholder="780 555 0123" value={phone} onChange={e => setPhone(e.target.value)} />
      </label>
      <label className="cc-text-agree">
        <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
        <span>{texting.consent_text}</span>
      </label>
      {error && <p className="hm-error" role="alert">{error}</p>}
      <div className="hm-actions">
        <button type="submit" className="hm-btn hm-btn--small" disabled={busy || !agree || phone.replace(/\D/g, '').length < 10}>{busy ? 'Setting up…' : 'Yes, text me'}</button>
        <button type="button" className="cc-quiet" onClick={decline}>No thanks</button>
      </div>
    </form>
  );
}

export default function CoachingCard() {
  const [state, setState] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [noteDone, setNoteDone] = useState(false);

  useEffect(() => {
    let live = true;
    fetch('/api/platform/coaching', { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then(d => { if (live && d && d.eligible === true) setState(d); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  if (!state || hidden) return null;

  if (state.show_invite) {
    const answer = a => {
      post('/api/platform/coaching/invite', { answer: a }).catch(() => {});
      track('feature_use', { action: 'coaching_invite', props: { answer: a } });
      setHidden(true);
    };
    return (
      <section className="hm-card cc-card">
        <h2 className="hm-card-title">Your goal</h2>
        <p>Students who pick a date and plan around their shifts are the ones who get there. Want a hand setting a goal? It takes about two minutes.</p>
        <div className="hm-actions">
          <Link className="hm-btn hm-btn--small" to="/goals" onClick={() => track('feature_use', { action: 'coaching_invite', props: { answer: 'yes' } })}>Let's do it</Link>
          <button type="button" className="hm-btn hm-btn--ghost hm-btn--small" onClick={() => answer('later')}>Not now</button>
          <button type="button" className="cc-quiet" onClick={() => answer('declined')}>No thanks</button>
        </div>
      </section>
    );
  }

  if (!state.goal) return null;
  const { goal, plan } = state;
  const done = plan ? Math.min(plan.sessions_this_week, plan.weekly_target) : 0;
  return (
    <section className="hm-card cc-card">
      <h2 className="hm-card-title">Your goal</h2>
      {state.message && !noteDone && <Note message={state.message} onDone={() => setNoteDone(true)} />}
      <div className="cc-plan">
        <div className="cc-countdown">{examCountdown(goal)}</div>
        <div className="hm-muted">{goal.exam_booked ? 'Booked' : 'Not booked yet'}</div>
        {plan && (
          <div className="hm-progress" aria-label={`${plan.sessions_this_week} of ${plan.weekly_target} sessions this week`}>
            <div className="hm-progress-fill" style={{ width: `${(done / plan.weekly_target) * 100}%` }} />
            <span className="hm-progress-label">This week: {plan.sessions_this_week} of {plan.weekly_target} sessions</span>
          </div>
        )}
        <Link className="hm-link" to="/goals">Edit your goal</Link>
      </div>
      <TextOptIn texting={state.texting} onChange={t => setState(st => ({ ...st, texting: t }))} />
    </section>
  );
}

// One quiet line under practice-exam results for a student who hasn't set a
// goal yet and hasn't said no to it.
export function GoalNudge() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let live = true;
    fetch('/api/platform/coaching', { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then(d => { if (live && d?.eligible === true && d.show_invite) setShow(true); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  if (!show) return null;
  return (
    <div className="er-goal-nudge">
      <span>Want to turn this into a plan? Pick a date and I'll help you work toward it.</span>
      <Link to="/goals" onClick={() => track('feature_use', { action: 'coaching_invite', props: { answer: 'yes', from: 'results' } })}>Set a goal</Link>
      <button type="button" onClick={() => { post('/api/platform/coaching/invite', { answer: 'later' }).catch(() => {}); setShow(false); }}>Not now</button>
    </div>
  );
}
