import './LeveledResults.css';
import { fmtDuration } from './examClock.js';

// Timed sitting: how long the student took against their limit and, if they went over, how
// far they had got by the limit. Understanding comes first, so this sits under the verdict.
function TimeSummary({ timing }) {
  if (!timing || timing.taken_s == null) return null;
  const { limit_s, max_count, taken_s, over_s, answered_in_time, correct_in_time, total } = timing;
  return (
    <div className="lr-time">
      <div className="lr-time-head">Time</div>
      {over_s > 0 ? (
        <>
          <p>You took {fmtDuration(taken_s)} of your {fmtDuration(limit_s)}, {fmtDuration(over_s)} over.</p>
          <p>By the time limit you had answered {answered_in_time} of {total} ({correct_in_time} correct).</p>
          <p className="lr-time-note">
            Understanding comes first: every answer counts toward your topic levels, including the ones after
            the limit. Once your topics are solid, work on finishing inside the time.
          </p>
        </>
      ) : (
        <p>You finished in {fmtDuration(taken_s)} of your {fmtDuration(limit_s)}.</p>
      )}
      {max_count > 0 && (
        <p className="lr-time-note">Your limit included extra time for {max_count} Max-level questions.</p>
      )}
    </div>
  );
}

// Results of a leveled practice exam: the verdict, the predicted score against the pass
// mark, and each topic's level and score. Topics only, never chapters.
export default function LeveledResults({ data }) {
  if (!data) return null;
  const { topics = [], predicted_pct, message, band, holding_back = [], pass_pct = 65, timing } = data;
  return (
    <div className="lr">
      <div className={`lr-verdict lr-verdict--${band}`}>
        <div className="lr-message">{message}</div>
        <div className="lr-predicted">Predicted real-exam score: <strong>{predicted_pct}%</strong> (pass mark {pass_pct}%)</div>
        {holding_back.length > 0 && (
          <div className="lr-hold">Topics holding you back: {holding_back.join(', ')}</div>
        )}
      </div>
      <TimeSummary timing={timing} />
      <div className="lr-table-wrap">
        <table className="lr-table">
          <thead>
            <tr><th>Topic</th><th>Score</th><th>Level</th></tr>
          </thead>
          <tbody>
            {topics.map(t => {
              const moved = t.new_level !== t.level;
              return (
                <tr key={t.topic_key} className={moved ? (t.new_level > t.level ? 'lr-up' : 'lr-down') : ''}>
                  <td>{t.name}</td>
                  <td className="lr-num">{t.correct}/{t.total}</td>
                  <td>{moved ? `${t.level_name} → ${t.new_level_name}` : t.level_name}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
