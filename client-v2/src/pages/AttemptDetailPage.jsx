import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getJson } from '../utils/api';
import { QuestionReview } from '../components/QuestionReview';
import { attemptTitle, attemptDate, attemptScore, NO_REVIEW } from './attemptFormat';
import './AttemptsPage.css';

// One past attempt, question by question, exactly as it was shown
// (GET /api/attempts/:id serves the stored snapshots, never the live question).
export default function AttemptDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    getJson(`/api/attempts/${encodeURIComponent(id)}`)
      .then(setData)
      .catch(err => {
        if (err?.status === 401) navigate('/login', { replace: true });
        else if (err?.status === 404) setError("We couldn't find that attempt.");
        else setError("Couldn't load this attempt right now. Try again in a minute.");
      });
  }, [id, navigate]);

  const back = <Link className="at-back" to="/attempts">← All attempts</Link>;

  if (error) return <div className="at-page">{back}<p className="at-error">{error}</p></div>;
  if (!data) return <div className="at-page"><p className="at-muted">Loading…</p></div>;

  const a = data.attempt;
  return (
    <div className="at-page">
      {back}
      <h1>{attemptTitle(a)}</h1>
      <div className="at-detail-meta">
        <span>{a.course_id}{a.chapter_title ? ` · ${a.chapter_title}` : ''}</span>
        <span>{attemptDate(a.finished_at || a.started_at)}</span>
      </div>
      <div className="at-detail-score">
        <span className="at-score">{attemptScore(a)}</span>
        <span className="at-pct">{a.score_pct}%</span>
      </div>
      {data.review_available ? (
        <QuestionReview questions={data.questions} />
      ) : (
        <p className="at-muted">{NO_REVIEW}</p>
      )}
    </div>
  );
}
