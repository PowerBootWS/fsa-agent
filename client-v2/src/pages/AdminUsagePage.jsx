// First-party platform usage (backlog #113). The real gate is server-side
// requireAdminUser (session identity + ADMIN_EMAILS); this page just renders
// what that endpoint returns. /admin/usage is deliberately absent from the
// screen taxonomy, so the page never appears in its own numbers.
import { useEffect, useState } from 'react';
import { getJson } from '../utils/api';
import './AdminUsagePage.css';

const WINDOWS = [7, 30, 90];

function pct(correct, answered) {
  if (!answered) return '—';
  return `${Math.round((correct / answered) * 100)}%`;
}

export default function AdminUsagePage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);

    getJson(`/api/admin/usage?days=${days}`)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        // api.js throws; every call site owns its own message (backlog #68).
        if (!cancelled) setError('Could not load usage');
      });

    return () => {
      cancelled = true;
    };
  }, [days]);

  if (error) return <div className="admin-usage admin-usage-error">{error}</div>;
  if (!data) return <div className="admin-usage">Loading usage…</div>;

  const { screens = [], features = [], active_learners: learners = [], activity = {} } = data;
  const empty = screens.length === 0 && features.length === 0 && learners.length === 0;

  return (
    <div className="admin-usage">
      <header className="admin-usage-header">
        <h1>Platform usage</h1>
        <div className="admin-usage-windows">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              className={w === days ? 'is-active' : ''}
              onClick={() => setDays(w)}
            >
              {w} days
            </button>
          ))}
        </div>
      </header>

      <p className="admin-usage-provenance">
        From fsa-postgres. The LMS is deliberately not GA4-instrumented — see backlog #113.
      </p>

      {empty ? (
        <p className="admin-usage-empty">No usage recorded in this window.</p>
      ) : (
        <>
          <section>
            <h2>Activity</h2>
            <ul className="admin-usage-stats">
              <li><strong>{activity.questions_answered}</strong> questions answered</li>
              <li><strong>{pct(activity.questions_correct, activity.questions_answered)}</strong> accuracy</li>
              <li><strong>{activity.lessons_touched}</strong> lessons touched</li>
              <li><strong>{activity.exams_attempted}</strong> exams attempted</li>
              <li><strong>{activity.jobs_saved}</strong> jobs saved</li>
              <li><strong>{activity.tutor_conversations_started}</strong> tutor conversations started</li>
              <li><strong>{activity.subscribers_active}</strong> active subscribers</li>
            </ul>
          </section>

          <section>
            <h2>Screens</h2>
            <table>
              <thead><tr><th>Screen</th><th>Views</th><th>Viewers</th></tr></thead>
              <tbody>
                {screens.map((s) => (
                  <tr key={s.screen}>
                    <td>{s.screen}</td><td>{s.views}</td><td>{s.viewers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h2>Features</h2>
            <table>
              <thead><tr><th>Action</th><th>Uses</th><th>People</th></tr></thead>
              <tbody>
                {features.map((f) => (
                  <tr key={f.action}>
                    <td>{f.action}</td><td>{f.uses}</td><td>{f.users}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h2>Active learners per day</h2>
            <table>
              <thead><tr><th>Day</th><th>Learners</th></tr></thead>
              <tbody>
                {learners.map((d) => (
                  <tr key={d.day}>
                    <td>{String(d.day).slice(0, 10)}</td><td>{d.learners}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
