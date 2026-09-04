import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInstall } from '../hooks/useInstall';
import './LobbyPage.css';

// Maps paper codes to human-readable names
const PAPER_NAMES = {
  '2A1': '2nd Class Part A1',
  '2A2': '2nd Class Part A2',
  '2A3': '2nd Class Part A3',
  '2B1': '2nd Class Part B1',
  '2B2': '2nd Class Part B2',
  '2B3': '2nd Class Part B3',
  '3A1': '3rd Class Part A1',
  '3A2': '3rd Class Part A2',
  '3A3': '3rd Class Part A3',
  '3B1': '3rd Class Part B1',
  '3B2': '3rd Class Part B2',
  '3B3': '3rd Class Part B3',
};

function getPaperLabel(paper) {
  return PAPER_NAMES[paper] || paper;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function LobbyPage() {
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [examCount, setExamCount] = useState(50);
  const [timedMode, setTimedMode] = useState(false);

  // PWA install affordance (one-tap on Android, instructions on iOS).
  const { canPrompt, isIOS, isStandalone, promptInstall } = useInstall();
  const [showIosInstall, setShowIosInstall] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(
    () => localStorage.getItem('fsa_install_dismissed') === '1'
  );
  const showInstall = !isStandalone && (canPrompt || isIOS);

  function handleInstallClick() {
    if (canPrompt) {
      promptInstall();
    } else {
      setShowIosInstall(true);
    }
  }

  function dismissInstallBanner() {
    setInstallDismissed(true);
    localStorage.setItem('fsa_install_dismissed', '1');
  }

  const user = JSON.parse(localStorage.getItem('fsa_user') || '{}');

  useEffect(() => {
    fetchAccountAndData();
  }, []);

  // Branch on account state before ever touching lobby-data, which 400s without
  // an active_paper: no course at all → enroll prompt (rendered below, no
  // redirect); has a course but no paper picked yet → the picker. Only a course
  // with a paper already active loads the dashboard itself.
  async function fetchAccountAndData() {
    setLoading(true);
    setError(null);
    try {
      const meRes = await fetch('/api/platform/me', { credentials: 'include' });
      // ProtectedRoute admits anyone with an fsa_user in localStorage, but the
      // session itself lives in the fsa_session cookie. When the two disagree —
      // cookie dropped, expired, or displaced by a login on another device —
      // the old behaviour parked the student on a bare "Failed to load your
      // account" string with nothing to click. Send them to sign in instead.
      if (meRes.status === 401) {
        localStorage.removeItem('fsa_user');
        navigate('/login', { replace: true });
        return;
      }
      if (!meRes.ok) throw new Error('Failed to load your account');
      const me = await meRes.json();
      setAccount(me);

      if (me.class_code && !me.active_paper) {
        navigate('/select-paper', { replace: true });
        return;
      }

      if (me.class_code && me.active_paper) {
        const res = await fetch('/api/platform/lobby-data', { credentials: 'include' });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || 'Failed to load lobby data');
        }
        const d = await res.json();
        setData(d);
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please refresh.');
    } finally {
      setLoading(false);
    }
  }

  function handleContinue() {
    if (!data) return;
    const lastCode = data.progress?.last_visited?.lesson_code;
    if (lastCode) {
      navigate(`/lesson/${lastCode}`);
    } else {
      // Navigate to first lesson of the paper: paper-1-1
      navigate(`/lesson/${data.paper}-1-1`);
    }
  }

  function handleReattemptLowest() {
    if (!data?.chapter_quizzes?.length) return;
    const sorted = [...data.chapter_quizzes].sort((a, b) => a.score - b.score);
    const lowest = sorted[0];
    navigate(`/lesson/${lowest.chapter_id}?mode=quiz`);
  }

  function handleStartExam() {
    if (!data) return;
    navigate(`/practice-exam?paper=${data.paper}&count=${examCount}&timed=${timedMode}`);
  }

  if (loading) {
    return <div className="lb-loading-wrap">Loading your dashboard…</div>;
  }

  if (error) {
    return (
      <div className="lb-page">
        <div className="lb-error-wrap">
          <div>{error}</div>
          <button
            className="lb-btn-secondary"
            style={{ marginTop: '16px' }}
            onClick={fetchAccountAndData}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (account && !account.class_code) {
    return (
      <div className="lb-page">
        <header className="lb-header">
          <div className="lb-brand">Full Steam Ahead</div>
        </header>
        <div className="lb-content">
          <div className="lb-enroll-wrap">
            <h2 className="lb-enroll-title">You're not enrolled in a course yet</h2>
            <p className="lb-enroll-subtitle">
              Pick your certification level to get instant access to every paper, lesson, and practice exam.
            </p>
            <div className="lb-enroll-options">
              <a className="lb-enroll-card" href="https://fullsteamahead.ca/enroll.html?class=second">
                <span className="lb-enroll-card-title">2nd Class</span>
                <span className="lb-enroll-card-sub">All six papers — 2A1 to 2B3</span>
                <span className="lb-btn-primary lb-enroll-card-btn">Enroll in 2nd Class →</span>
              </a>
              <a className="lb-enroll-card" href="https://fullsteamahead.ca/enroll.html?class=third">
                <span className="lb-enroll-card-title">3rd Class</span>
                <span className="lb-enroll-card-sub">All four papers — 3A1 to 3B2</span>
                <span className="lb-btn-primary lb-enroll-card-btn">Enroll in 3rd Class →</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { progress, stats, chapter_quizzes, next_quiz_chapter_id, last_exam, paper } = data;

  // Lowest-score quiz (for reattempt button)
  const lowestQuiz = chapter_quizzes.length > 0
    ? [...chapter_quizzes].sort((a, b) => a.score - b.score)[0]
    : null;

  return (
    <div className="lb-page">
      {/* ── Header ── */}
      <header className="lb-header">
        <div className="lb-brand">Full Steam Ahead</div>
      </header>

      <div className="lb-content">
        {/* ── Install nudge (dismissible; hidden once installed/dismissed) ── */}
        {showInstall && !installDismissed && (
          <div className="lb-install-banner">
            <span className="lb-install-banner-text">
              📲 Add Full Steam Ahead to your home screen for quick, full-screen access.
            </span>
            <div className="lb-install-banner-actions">
              <button className="lb-install-banner-btn" onClick={handleInstallClick}>
                {canPrompt ? 'Install' : 'How?'}
              </button>
              <button
                className="lb-install-banner-dismiss"
                onClick={dismissInstallBanner}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* ── Big Course Card ── */}
        <div className="lb-course-card">
          <div className="lb-course-card-top">
            <div>
              <h2 className="lb-paper-title">
                {paper} — {getPaperLabel(paper)}
              </h2>
              <p className="lb-paper-subtitle">Power Engineering Exam Prep</p>
            </div>
            <div className="lb-course-card-actions">
              <button className="lb-btn-primary" onClick={handleContinue}>
                ▶ Continue
              </button>
              <button className="lb-btn-secondary" onClick={() => navigate('/chapters')}>
                All Chapters
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="lb-progress-bar-wrap">
            <div className="lb-progress-bar-row">
              <span className="lb-progress-label">Course Progress</span>
              <span className="lb-progress-pct">{progress.percent}%</span>
            </div>
            <div className="lb-progress-track">
              <div
                className={`lb-progress-fill${progress.percent >= 100 ? ' lb-progress-fill--complete' : ''}`}
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>

          {/* Last visited */}
          <div className="lb-last-visited">
            {progress.last_visited ? (
              <>
                Last studied:{' '}
                <span className="lb-last-visited-title">
                  {progress.last_visited.title || progress.last_visited.lesson_code}
                </span>
              </>
            ) : (
              <span className="lb-muted-666">Start studying to track your progress</span>
            )}
          </div>

          {/* Stat chips */}
          <div className="lb-chip-row">
            <span className="lb-chip">
              Objectives Done:{' '}
              <span className="lb-chip-value">
                {stats.objectives_done}/{progress.total_objectives}
              </span>
            </span>
            <span className="lb-chip">
              Quizzes Passed:{' '}
              <span className="lb-chip-value">{stats.quizzes_passed}</span>
            </span>
            <span className="lb-chip">
              Avg Score:{' '}
              <span className="lb-chip-value">
                {stats.avg_quiz_score !== null ? `${stats.avg_quiz_score}%` : '—'}
              </span>
            </span>
          </div>
        </div>

        {/* ── 4 Tiles ── */}
        {/* className (not inline) so the CSS media query can collapse to one
            column on phones — inline styles can't carry @media. */}
        <div className="lobby-tile-grid">
          {/* Tile 1 — Chapter Quizzes */}
          <div className="lb-tile">
            <h3 className="lb-tile-title">Chapter Quizzes</h3>
            {next_quiz_chapter_id ? (
              <div>
                <div className="lb-next-quiz-id">
                  Next: {next_quiz_chapter_id}
                </div>
                <div className="lb-quiz-pass-count">
                  {stats.quizzes_passed} of {stats.total_chapters} chapters with passing score
                </div>
              </div>
            ) : (
              <div>
                <div className="lb-quiz-passed-all">All quizzes passed! 🎉</div>
                <div className="lb-quiz-pass-count">
                  {stats.quizzes_passed} of {stats.total_chapters} chapters completed
                </div>
              </div>
            )}
          </div>

          {/* Tile 2 — Quiz Results */}
          <div className="lb-tile">
            <h3 className="lb-tile-title">Quiz Results</h3>
            {chapter_quizzes.length === 0 ? (
              <p className="lb-muted">No quizzes attempted yet</p>
            ) : (
              <>
                <ul className="lb-quiz-list">
                  {chapter_quizzes.map(q => (
                    <li key={q.chapter_id} className="lb-quiz-row">
                      <span className="lb-quiz-chapter-id">{q.chapter_id}</span>
                      <div className="lb-quiz-row-right">
                        <span className="lb-score-text">{q.score}%</span>
                        <span className={q.passed ? 'lb-badge-pass' : 'lb-badge-fail'}>
                          {q.passed ? 'Pass' : 'Fail'}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                {lowestQuiz && (
                  <div className="lb-lowest-row">
                    <span className="lb-lowest-label">Lowest:</span>
                    <span className="lb-lowest-value">
                      {lowestQuiz.chapter_id} ({lowestQuiz.score}%)
                    </span>
                    <button className="lb-reattempt-btn" onClick={handleReattemptLowest}>
                      Reattempt
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Tile 3 — Last Exam Attempt */}
          <div className="lb-tile">
            <h3 className="lb-tile-title">Last Practice Exam</h3>
            {!last_exam ? (
              <p className="lb-muted">No practice exam attempted yet</p>
            ) : (
              <>
                <div className="lb-big-score">{last_exam.score}%</div>
                <div className="lb-exam-date">{formatDate(last_exam.date)}</div>
                <div>
                  {last_exam.chapters.slice(0, 3).map(ch => (
                    <div key={ch.chapter_id} className="lb-chapter-score-row">
                      <span>{ch.chapter_id}</span>
                      <span className="lb-chapter-score-value">{ch.score}%</span>
                    </div>
                  ))}
                  {last_exam.chapters.length > 3 && (
                    <div className="lb-more-chapters">
                      +{last_exam.chapters.length - 3} more chapters
                    </div>
                  )}
                </div>
                <button
                  className="lb-btn-link"
                  onClick={() => navigate('/exam/results')}
                >
                  Full breakdown ↓
                </button>
              </>
            )}
          </div>

          {/* Tile 4 — Practice Exam Launcher */}
          <div className="lb-tile">
            <h3 className="lb-tile-title">Practice Exam</h3>

            {/* Question count selector */}
            <div className="lb-count-section">
              <div className="lb-count-section-label">
                Question count
              </div>
              <div className="lb-count-group">
                {[25, 50, 100].map(n => (
                  <button
                    key={n}
                    className={`lb-count-btn${examCount === n ? ' lb-count-btn--active' : ''}`}
                    onClick={() => setExamCount(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Timed toggle */}
            <div
              className="lb-timed-row"
              onClick={() => setTimedMode(t => !t)}
            >
              <button className={`lb-toggle${timedMode ? ' lb-toggle--on' : ''}`} type="button">
                <span className={`lb-toggle-knob${timedMode ? ' lb-toggle-knob--on' : ''}`} />
              </button>
              <span className="lb-timed-label">Timed mode</span>
            </div>

            <button className="lb-btn-primary lb-btn-block" onClick={handleStartExam}>
              Start Practice Exam
            </button>

            {last_exam && (
              <button
                className="lb-btn-secondary lb-btn-block lb-btn-block--mt"
                onClick={() => navigate(`/exam/results?paper=${encodeURIComponent(paper)}`)}
              >
                Review most recent results
              </button>
            )}
          </div>
        </div>

      </div>

      {/* iOS "Add to Home Screen" instructions (no programmatic install on iOS) */}
      {showIosInstall && (
        <div className="lb-install-modal-overlay" onClick={() => setShowIosInstall(false)}>
          <div className="lb-install-modal" onClick={e => e.stopPropagation()}>
            <div className="lb-install-modal-title">Install Full Steam Ahead</div>
            <p className="lb-install-modal-text">
              Add the app to your home screen for quick, full-screen access:
            </p>
            <ol className="lb-install-steps">
              <li>Tap the <strong>Share</strong> button <span className="lb-ios-share" aria-hidden="true">⎋</span> in Safari's toolbar.</li>
              <li>Scroll down and choose <strong>Add to Home Screen</strong>.</li>
              <li>Tap <strong>Add</strong> — the FSA icon appears on your home screen.</li>
            </ol>
            <button className="lb-btn-primary lb-btn-block" onClick={() => setShowIosInstall(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
