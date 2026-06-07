import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Maps paper codes to human-readable names
const PAPER_NAMES = {
  '2A1': '2nd Class Part A1',
  '2A2': '2nd Class Part A2',
  '2A3': '2nd Class Part A3',
  '2B1': '2nd Class Part B1',
  '2B2': '2nd Class Part B2',
  '2B3': '2nd Class Part B3',
  '3A1': '3rd Class Power Engineering',
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

// ── Styles ──────────────────────────────────────────────────────────────────

const s = {
  page: {
    minHeight: '100vh',
    background: '#0D1117',
    color: '#F4F5F7',
    fontFamily: "'Barlow', -apple-system, sans-serif",
  },

  // Header
  header: {
    background: '#1C2333',
    borderBottom: '2px solid #E8720C',
    padding: '0 24px',
    height: '56px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    color: '#E8720C',
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: '700',
    fontSize: '20px',
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  userName: {
    color: '#a8b4c0',
    fontSize: '14px',
  },
  logoutBtn: {
    background: 'transparent',
    border: '1px solid #252F42',
    borderRadius: '4px',
    color: '#a8b4c0',
    fontSize: '13px',
    padding: '6px 14px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'border-color 0.2s, color 0.2s',
  },

  // Main content
  content: {
    maxWidth: '1080px',
    margin: '0 auto',
    padding: '32px 24px 48px',
  },

  // Big course card
  courseCard: {
    background: '#1C2333',
    border: '1px solid #252F42',
    borderRadius: '4px',
    padding: '28px 32px',
    marginBottom: '24px',
  },
  courseCardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '20px',
    flexWrap: 'wrap',
    gap: '16px',
  },
  paperTitle: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: '24px',
    fontWeight: '700',
    color: '#F4F5F7',
    margin: '0 0 4px 0',
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  },
  paperSubtitle: {
    color: '#a8b4c0',
    fontSize: '14px',
    margin: 0,
  },
  courseCardActions: {
    display: 'flex',
    gap: '12px',
    flexShrink: 0,
  },
  btnPrimary: {
    background: '#E8720C',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: '600',
    padding: '10px 20px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
    transition: 'background 0.2s',
  },
  btnSecondary: {
    background: 'transparent',
    color: '#a8b4c0',
    border: '1px solid #252F42',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: '500',
    padding: '10px 20px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
    transition: 'border-color 0.2s, color 0.2s',
  },

  // Progress bar
  progressBarWrap: {
    marginBottom: '16px',
  },
  progressBarRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
  },
  progressLabel: {
    color: '#a8b4c0',
    fontSize: '13px',
  },
  progressPct: {
    color: '#F4F5F7',
    fontSize: '13px',
    fontWeight: '600',
  },
  progressTrack: {
    height: '8px',
    background: '#0D1117',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  progressFill: (pct) => ({
    height: '100%',
    width: `${pct}%`,
    background: pct >= 100 ? '#52A882' : '#E8720C',
    borderRadius: '4px',
    transition: 'width 0.4s ease',
  }),

  // Last visited
  lastVisited: {
    color: '#a8b4c0',
    fontSize: '13px',
    marginBottom: '20px',
  },
  lastVisitedTitle: {
    color: '#F4F5F7',
    fontWeight: '500',
  },

  // Stat chips
  chipRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },
  chip: {
    background: '#0D1117',
    border: '1px solid #252F42',
    borderRadius: '20px',
    padding: '5px 14px',
    fontSize: '13px',
    color: '#a8b4c0',
  },
  chipValue: {
    color: '#F4F5F7',
    fontWeight: '600',
  },

  // 4-tile grid
  tileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '20px',
    marginBottom: '32px',
  },
  tile: {
    background: '#1C2333',
    border: '1px solid #252F42',
    borderRadius: '4px',
    padding: '24px',
  },
  tileTitle: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: '13px',
    fontWeight: '700',
    color: '#a8b4c0',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    margin: '0 0 16px 0',
  },

  // Quiz results list
  quizList: {
    listStyle: 'none',
    margin: '0 0 16px 0',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  quizRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quizChapterId: {
    color: '#F4F5F7',
    fontSize: '14px',
  },
  quizRowRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  badgePass: {
    background: 'rgba(82,168,130,0.15)',
    color: '#52A882',
    border: '1px solid rgba(82,168,130,0.3)',
    borderRadius: '3px',
    padding: '2px 9px',
    fontSize: '12px',
    fontWeight: '600',
  },
  badgeFail: {
    background: 'rgba(220,38,38,0.12)',
    color: '#f87171',
    border: '1px solid rgba(220,38,38,0.25)',
    borderRadius: '3px',
    padding: '2px 9px',
    fontSize: '12px',
    fontWeight: '600',
  },
  scoreText: {
    color: '#F4F5F7',
    fontSize: '14px',
    fontWeight: '600',
    minWidth: '40px',
    textAlign: 'right',
  },

  // Exam launcher
  countGroup: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px',
  },
  countBtn: (active) => ({
    background: active ? '#E8720C' : '#0D1117',
    border: `1px solid ${active ? '#E8720C' : '#252F42'}`,
    borderRadius: '4px',
    color: active ? '#fff' : '#a8b4c0',
    fontSize: '14px',
    fontWeight: '600',
    padding: '8px 18px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background 0.15s, border-color 0.15s, color 0.15s',
  }),
  timedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '20px',
    cursor: 'pointer',
  },
  toggle: (on) => ({
    width: '36px',
    height: '20px',
    borderRadius: '10px',
    background: on ? '#E8720C' : '#252F42',
    position: 'relative',
    flexShrink: 0,
    transition: 'background 0.2s',
    cursor: 'pointer',
    border: 'none',
  }),
  toggleKnob: (on) => ({
    position: 'absolute',
    top: '3px',
    left: on ? '19px' : '3px',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    background: '#fff',
    transition: 'left 0.2s',
  }),
  timedLabel: {
    color: '#a8b4c0',
    fontSize: '14px',
  },

  // Paper switch section
  switchSection: {
    textAlign: 'center',
    paddingTop: '8px',
  },
  switchLabel: {
    color: '#666',
    fontSize: '13px',
    marginBottom: '8px',
  },
  switchLink: {
    color: '#E8720C',
    fontSize: '13px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'underline',
    padding: 0,
    fontFamily: 'inherit',
  },
  cooldownNote: {
    color: '#F5A623',
    fontSize: '12px',
    marginTop: '4px',
  },

  // Misc
  muted: {
    color: '#a8b4c0',
    fontSize: '14px',
  },
  bigScore: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: '40px',
    fontWeight: '800',
    color: '#F4F5F7',
    lineHeight: 1,
    marginBottom: '4px',
  },
  examDate: {
    color: '#a8b4c0',
    fontSize: '13px',
    marginBottom: '16px',
  },
  chapterScoreRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
    color: '#a8b4c0',
    marginBottom: '4px',
  },
  btnLink: {
    background: 'transparent',
    border: 'none',
    color: '#E8720C',
    fontSize: '13px',
    cursor: 'pointer',
    padding: 0,
    marginTop: '12px',
    fontFamily: 'inherit',
  },
  reattemptBtn: {
    background: 'transparent',
    border: '1px solid #252F42',
    borderRadius: '4px',
    color: '#a8b4c0',
    fontSize: '12px',
    padding: '4px 10px',
    cursor: 'pointer',
    flexShrink: 0,
    fontFamily: 'inherit',
  },
  nextQuizId: {
    color: '#F4F5F7',
    fontWeight: '600',
    fontSize: '18px',
    marginBottom: '6px',
  },
  quizPassedAll: {
    color: '#52A882',
    fontSize: '15px',
    fontWeight: '600',
    marginBottom: '6px',
  },
  quizPassCount: {
    color: '#a8b4c0',
    fontSize: '13px',
  },
  loadingWrap: {
    minHeight: '100vh',
    background: '#0D1117',
    color: '#a8b4c0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    fontFamily: "'Barlow', -apple-system, sans-serif",
  },
  errorWrap: {
    background: 'rgba(220,38,38,0.12)',
    border: '1px solid rgba(220,38,38,0.3)',
    color: '#fca5a5',
    borderRadius: '6px',
    padding: '16px 20px',
    maxWidth: '480px',
    margin: '40px auto',
    textAlign: 'center',
    fontSize: '14px',
  },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function LobbyPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [examCount, setExamCount] = useState(50);
  const [timedMode, setTimedMode] = useState(false);

  const user = JSON.parse(localStorage.getItem('fsa_user') || '{}');

  useEffect(() => {
    fetchLobbyData();
  }, []);

  async function fetchLobbyData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/lobby-data', { credentials: 'include' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to load lobby data');
      }
      const d = await res.json();
      setData(d);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please refresh.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // ignore
    }
    localStorage.removeItem('fsa_user');
    navigate('/login', { replace: true });
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
    navigate(`/?mode=exam&lesson=${data.paper}&count=${examCount}&timed=${timedMode}`);
  }

  // Calculate paper switch cooldown
  const lastSwitchAt = user?.last_paper_switch_at;
  const COOLDOWN_DAYS = 7;
  let daysUntilSwitch = 0;
  if (lastSwitchAt) {
    const diffMs = Date.now() - new Date(lastSwitchAt).getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    daysUntilSwitch = Math.max(0, Math.ceil(COOLDOWN_DAYS - diffDays));
  }

  if (loading) {
    return <div style={s.loadingWrap}>Loading your dashboard…</div>;
  }

  if (error) {
    return (
      <div style={s.page}>
        <div style={s.errorWrap}>{error}</div>
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
    <div style={s.page}>
      {/* ── Header ── */}
      <header style={s.header}>
        <div style={s.brand}>Full Steam Ahead</div>
        <div style={s.headerRight}>
          <span style={s.userName}>
            {user.first_name ? `${user.first_name}` : user.email}
          </span>
          <button style={s.logoutBtn} onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <div style={s.content}>
        {/* ── Big Course Card ── */}
        <div style={s.courseCard}>
          <div style={s.courseCardTop}>
            <div>
              <h2 style={s.paperTitle}>
                {paper} — {getPaperLabel(paper)}
              </h2>
              <p style={s.paperSubtitle}>Power Engineering Exam Prep</p>
            </div>
            <div style={s.courseCardActions}>
              <button style={s.btnPrimary} onClick={handleContinue}>
                ▶ Continue
              </button>
              <button style={s.btnSecondary} onClick={() => navigate('/chapters')}>
                All Chapters
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div style={s.progressBarWrap}>
            <div style={s.progressBarRow}>
              <span style={s.progressLabel}>Course Progress</span>
              <span style={s.progressPct}>{progress.percent}%</span>
            </div>
            <div style={s.progressTrack}>
              <div style={s.progressFill(progress.percent)} />
            </div>
          </div>

          {/* Last visited */}
          <div style={s.lastVisited}>
            {progress.last_visited ? (
              <>
                Last studied:{' '}
                <span style={s.lastVisitedTitle}>
                  {progress.last_visited.title || progress.last_visited.lesson_code}
                </span>
              </>
            ) : (
              <span style={{ color: '#666' }}>Start studying to track your progress</span>
            )}
          </div>

          {/* Stat chips */}
          <div style={s.chipRow}>
            <span style={s.chip}>
              Objectives Done:{' '}
              <span style={s.chipValue}>
                {stats.objectives_done}/{progress.total_objectives}
              </span>
            </span>
            <span style={s.chip}>
              Quizzes Passed:{' '}
              <span style={s.chipValue}>{stats.quizzes_passed}</span>
            </span>
            <span style={s.chip}>
              Avg Score:{' '}
              <span style={s.chipValue}>
                {stats.avg_quiz_score !== null ? `${stats.avg_quiz_score}%` : '—'}
              </span>
            </span>
          </div>
        </div>

        {/* ── 4 Tiles ── */}
        <div style={s.tileGrid}>
          {/* Tile 1 — Chapter Quizzes */}
          <div style={s.tile}>
            <h3 style={s.tileTitle}>Chapter Quizzes</h3>
            {next_quiz_chapter_id ? (
              <div>
                <div style={s.nextQuizId}>
                  Next: {next_quiz_chapter_id}
                </div>
                <div style={s.quizPassCount}>
                  {stats.quizzes_passed} of {stats.total_chapters} chapters with passing score
                </div>
              </div>
            ) : (
              <div>
                <div style={s.quizPassedAll}>All quizzes passed! 🎉</div>
                <div style={s.quizPassCount}>
                  {stats.quizzes_passed} of {stats.total_chapters} chapters completed
                </div>
              </div>
            )}
          </div>

          {/* Tile 2 — Quiz Results */}
          <div style={s.tile}>
            <h3 style={s.tileTitle}>Quiz Results</h3>
            {chapter_quizzes.length === 0 ? (
              <p style={s.muted}>No quizzes attempted yet</p>
            ) : (
              <>
                <ul style={s.quizList}>
                  {chapter_quizzes.map(q => (
                    <li key={q.chapter_id} style={s.quizRow}>
                      <span style={s.quizChapterId}>{q.chapter_id}</span>
                      <div style={s.quizRowRight}>
                        <span style={s.scoreText}>{q.score}%</span>
                        <span style={q.passed ? s.badgePass : s.badgeFail}>
                          {q.passed ? 'Pass' : 'Fail'}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                {lowestQuiz && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ color: '#94a3b8', fontSize: '13px' }}>Lowest:</span>
                    <span style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '600' }}>
                      {lowestQuiz.chapter_id} ({lowestQuiz.score}%)
                    </span>
                    <button style={s.reattemptBtn} onClick={handleReattemptLowest}>
                      Reattempt
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Tile 3 — Last Exam Attempt */}
          <div style={s.tile}>
            <h3 style={s.tileTitle}>Last Practice Exam</h3>
            {!last_exam ? (
              <p style={s.muted}>No practice exam attempted yet</p>
            ) : (
              <>
                <div style={s.bigScore}>{last_exam.score}%</div>
                <div style={s.examDate}>{formatDate(last_exam.date)}</div>
                <div>
                  {last_exam.chapters.slice(0, 3).map(ch => (
                    <div key={ch.chapter_id} style={s.chapterScoreRow}>
                      <span>{ch.chapter_id}</span>
                      <span style={{ color: '#e2e8f0', fontWeight: '500' }}>{ch.score}%</span>
                    </div>
                  ))}
                  {last_exam.chapters.length > 3 && (
                    <div style={{ color: '#666', fontSize: '12px', marginTop: '4px' }}>
                      +{last_exam.chapters.length - 3} more chapters
                    </div>
                  )}
                </div>
                <button
                  style={s.btnLink}
                  onClick={() => navigate('/exam/results')}
                >
                  Full breakdown ↓
                </button>
              </>
            )}
          </div>

          {/* Tile 4 — Practice Exam Launcher */}
          <div style={s.tile}>
            <h3 style={s.tileTitle}>Practice Exam</h3>

            {/* Question count selector */}
            <div style={{ marginBottom: '6px' }}>
              <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '8px' }}>
                Question count
              </div>
              <div style={s.countGroup}>
                {[25, 50, 100].map(n => (
                  <button
                    key={n}
                    style={s.countBtn(examCount === n)}
                    onClick={() => setExamCount(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Timed toggle */}
            <div
              style={s.timedRow}
              onClick={() => setTimedMode(t => !t)}
            >
              <button style={s.toggle(timedMode)} type="button">
                <span style={s.toggleKnob(timedMode)} />
              </button>
              <span style={s.timedLabel}>Timed mode</span>
            </div>

            <button style={{ ...s.btnPrimary, width: '100%' }} onClick={handleStartExam}>
              Start Practice Exam
            </button>
          </div>
        </div>

        {/* ── Paper Switch ── */}
        <div style={s.switchSection}>
          <div style={s.switchLabel}>Currently studying: {paper}</div>
          {daysUntilSwitch > 0 ? (
            <div style={s.cooldownNote}>
              You can switch papers in {daysUntilSwitch} day{daysUntilSwitch !== 1 ? 's' : ''}
            </div>
          ) : (
            <button style={s.switchLink} onClick={() => navigate('/select-paper')}>
              Switch Paper
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
