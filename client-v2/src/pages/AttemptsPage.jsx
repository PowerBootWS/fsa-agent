import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getJson } from '../utils/api';
import { attemptTitle, attemptDate, attemptScore, NO_REVIEW } from './attemptFormat';
import './AttemptsPage.css';

// Past practice exams and chapter quizzes (attempt history, Phase C).
// Every row comes from GET /api/attempts; only rows whose questions were
// saved link through to the question-by-question review.

const TYPES = [
  { value: '', label: 'All types' },
  { value: 'practice_exam', label: 'Practice exams' },
  { value: 'chapter_quiz', label: 'Chapter quizzes' },
];

function RowBody({ a }) {
  return (
    <>
      <div className="at-row-main">
        <span className="at-row-title">{attemptTitle(a)}</span>
        <span className="at-row-meta">
          {a.course_id}
          {a.chapter_title ? ` · ${a.chapter_title}` : ''}
          {' · '}
          {attemptDate(a.finished_at || a.started_at)}
        </span>
        {!a.review_available && <span className="at-row-note">{NO_REVIEW}</span>}
      </div>
      <div className="at-row-score">
        <span className="at-score">{attemptScore(a)}</span>
        <span className="at-pct">{a.score_pct}%</span>
        {a.review_available && <span className="at-row-cta">Review →</span>}
      </div>
    </>
  );
}

export default function AttemptsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [attempts, setAttempts] = useState(null);
  const [failed, setFailed] = useState(false);
  const paper = params.get('course') || '';
  const type = params.get('kind') || '';

  useEffect(() => {
    getJson('/api/attempts?limit=200')
      .then(d => setAttempts(d?.attempts || []))
      .catch(err => {
        if (err?.status === 401) navigate('/login', { replace: true });
        else setFailed(true);
      });
  }, [navigate]);

  const papers = useMemo(
    () => [...new Set((attempts || []).map(a => a.course_id))].sort(),
    [attempts]
  );
  const shown = (attempts || []).filter(
    a => (!paper || a.course_id === paper) && (!type || a.kind === type)
  );

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  if (failed) {
    return <div className="at-page"><p className="at-error">Couldn't load your attempts right now. Try again in a minute.</p></div>;
  }
  if (!attempts) return <div className="at-page"><p className="at-muted">Loading…</p></div>;

  return (
    <div className="at-page">
      <h1>Past attempts</h1>
      {attempts.length === 0 ? (
        <p className="at-muted">
          No finished practice exams or chapter quizzes yet. Your attempts will show up here after you finish one.
        </p>
      ) : (
        <>
          <div className="at-filters">
            <label className="at-field">
              Paper
              <select value={paper} onChange={e => setFilter('course', e.target.value)}>
                <option value="">All papers</option>
                {papers.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="at-field">
              Type
              <select value={type} onChange={e => setFilter('kind', e.target.value)}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
          </div>
          {shown.length === 0 ? (
            <p className="at-muted">Nothing matches these filters.</p>
          ) : (
            <ul className="at-list">
              {shown.map(a => (
                <li key={a.id}>
                  {a.review_available ? (
                    <Link className="at-row at-row--link" to={`/attempts/${a.id}`}>
                      <RowBody a={a} />
                    </Link>
                  ) : (
                    <div className="at-row">
                      <RowBody a={a} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
