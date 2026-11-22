import './LeveledResults.css';

// Results of a leveled practice exam: the verdict, the predicted score against the pass
// mark, and each topic's level and score. Topics only, never chapters.
export default function LeveledResults({ data }) {
  if (!data) return null;
  const { topics = [], predicted_pct, message, band, holding_back = [], pass_pct = 65 } = data;
  return (
    <div className="lr">
      <div className={`lr-verdict lr-verdict--${band}`}>
        <div className="lr-message">{message}</div>
        <div className="lr-predicted">Predicted real-exam score: <strong>{predicted_pct}%</strong> (pass mark {pass_pct}%)</div>
        {holding_back.length > 0 && (
          <div className="lr-hold">Topics holding you back: {holding_back.join(', ')}</div>
        )}
      </div>
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
