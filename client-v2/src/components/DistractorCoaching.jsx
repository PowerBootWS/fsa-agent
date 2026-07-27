// DistractorCoaching — lead-magnet-only panel rendered in ResultsPanel.
// `coaching` is the `distractor_coaching` object from the orchestrator's
// lead-magnet debrief (ai-service/agents/orchestrator.py), keyed by
// `question_text` (confirmed in Task 5's report — no stable question id
// was available in the `question_review` shape shared with the client, so
// the key is literally the wrong question's text string, not an id).
// `questionReview` is accepted for a future id-based lookup but unused for
// now since the coaching object itself already carries the question text
// as its key — kept as a prop so Task 8 (or a later pass) can wire a
// stronger match (e.g. truncating/searching question_review) without
// changing the call site.
export function DistractorCoaching({ coaching, questionReview }) {
  const entries = Object.entries(coaching || {});
  if (entries.length === 0) return null;
  return (
    <div className="distractor-coaching">
      <h3 className="distractor-coaching-title">Watch out for these traps</h3>
      {entries.map(([key, text]) => (
        <div key={key} className="distractor-coaching-item">
          <p className="distractor-coaching-question">{key}</p>
          <p className="distractor-coaching-text">{text}</p>
        </div>
      ))}
    </div>
  );
}
