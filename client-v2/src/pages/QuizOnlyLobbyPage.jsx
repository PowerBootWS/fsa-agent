import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './QuizOnlyLobbyPage.css';

const PAPER_NAMES = {
  '4A': '4th Class Part A',
  '4B': '4th Class Part B',
};

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

function PaperCard({ paperCode, data, onStartExam }) {
  const { total_chapters, chapter_quizzes, quizzes_passed, avg_quiz_score,
          next_quiz_chapter_id, last_exam } = data;

  return (
    <div className="qo-paper-card">
      <div className="qo-paper-card-top">
        <h2 className="qo-paper-title">{paperCode} — {PAPER_NAMES[paperCode] || paperCode}</h2>
        <button className="qo-btn-primary" onClick={() => onStartExam(paperCode)}>
          Practice This Paper
        </button>
      </div>

      <div className="qo-chip-row">
        <span className="qo-chip">
          Chapters Passed: <span className="qo-chip-value">{quizzes_passed}/{total_chapters}</span>
        </span>
        <span className="qo-chip">
          Avg Quiz Score: <span className="qo-chip-value">{avg_quiz_score !== null ? `${avg_quiz_score}%` : '—'}</span>
        </span>
      </div>

      <div className="qo-tile-grid">
        <div className="qo-tile">
          <h3 className="qo-tile-title">Chapter Quizzes</h3>
          {chapter_quizzes.length === 0 ? (
            <p className="qo-muted">No quizzes attempted yet</p>
          ) : (
            <ul className="qo-quiz-list">
              {chapter_quizzes.map(q => (
                <li key={q.chapter_id} className="qo-quiz-row">
                  <span className="qo-quiz-chapter-id">{q.chapter_id}</span>
                  <div className="qo-quiz-row-right">
                    <span className="qo-score-text">{q.score}%</span>
                    <span className={q.passed ? 'qo-badge-pass' : 'qo-badge-fail'}>
                      {q.passed ? 'Pass' : 'Fail'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {next_quiz_chapter_id && (
            <div className="qo-next-quiz-id">Next: {next_quiz_chapter_id}</div>
          )}
        </div>

        <div className="qo-tile">
          <h3 className="qo-tile-title">Last Practice Exam</h3>
          {!last_exam ? (
            <p className="qo-muted">No practice exam attempted yet</p>
          ) : (
            <>
              <div className="qo-big-score">{last_exam.score}%</div>
              <div className="qo-exam-date">{formatDate(last_exam.date)}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function QuizOnlyLobbyPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/platform/quiz-lobby-data', { credentials: 'include' })
      .then(async res => {
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || 'Failed to load your dashboard');
        }
        return res.json();
      })
      .then(setData)
      .catch(err => setError(err.message || 'Something went wrong. Please refresh.'))
      .finally(() => setLoading(false));
  }, []);

  function handleStartExam(paper) {
    // No count param → lands on the combined practice-exam/chapter-quiz
    // picker (PracticeExamLobby) instead of auto-starting a 50-question exam.
    navigate(`/practice-exam?paper=${paper}`);
  }

  if (loading) return <div className="qo-loading-wrap">Loading your dashboard…</div>;
  if (error) return <div className="qo-page"><div className="qo-error-wrap">{error}</div></div>;
  if (!data) return null;

  return (
    <div className="qo-page">
      <header className="qo-header">
        <div className="qo-brand">Full Steam Ahead</div>
        <p className="qo-header-sub">4th Class Practice Exams</p>
      </header>
      <div className="qo-content">
        {Object.entries(data.papers).map(([paperCode, paperData]) => (
          <PaperCard key={paperCode} paperCode={paperCode} data={paperData} onStartExam={handleStartExam} />
        ))}
      </div>
    </div>
  );
}
