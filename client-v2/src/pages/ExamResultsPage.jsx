import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { InlineLessonPlayer } from '../components/InlineLessonPlayer';
import { ResultsPanel, QuizExamChatSection } from '../ExamRouter';
import { isFourthClassCode } from '../utils/fourthClass';
import { postJson } from '../utils/api';
import './ExamResultsPage.css';

// ── Grade helpers (used by the summary fallback view) ─────────────────────────
function getGrade(pct) {
  if (pct >= 85) return 'A';
  if (pct >= 70) return 'B';
  return 'C';
}

function GradeBadge({ grade }) {
  const mod = grade === 'A' ? 'er-grade--a' : grade === 'B' ? 'er-grade--b' : 'er-grade--c';
  return (
    <span className={`er-grade ${mod}`}>
      {grade}
    </span>
  );
}

function WeaknessCard({ chapter, openId, setOpenId }) {
  const isOpen = openId === chapter.chapter_id;
  const grade = getGrade(chapter.score);
  const missed = chapter.total != null && chapter.correct != null
    ? chapter.total - chapter.correct
    : null;
  return (
    <div className="er-weakness-card">
      <div className="er-weakness-head">
        <div>
          <span className="er-weakness-id">{chapter.chapter_id}</span>
          <span className="er-weakness-score">
            {chapter.score}%
            {missed != null ? ` · missed ${missed} question${missed !== 1 ? 's' : ''}` : ''}
          </span>
        </div>
        <GradeBadge grade={grade} />
      </div>
      <button
        onClick={() => setOpenId(isOpen ? null : chapter.chapter_id)}
        className="er-weakness-btn"
      >
        {isOpen ? '▲ Hide lesson' : '▶ Watch a lesson on this'}
      </button>
      {isOpen && <InlineLessonPlayer lessonCode={`${chapter.chapter_id}-1`} />}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ExamResultsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const location = useLocation();
  const user = JSON.parse(localStorage.getItem('fsa_user') || '{}');
  // 4th Class has no AI tutor chat (see ExamRouter.jsx's QuizExamView for the
  // same guard on the in-flow debrief screen — found via live testing that
  // this standalone results page, reached immediately on exam completion via
  // PracticeExamPage's onComplete navigation, is a separate, unguarded copy
  // of the tutor-fab/chat and needs the same fix).
  const isFourthClass = isFourthClassCode(user.class_code);

  const [debrief, setDebrief] = useState(null);   // { courseId, display_update, tutor_response, date }
  const [summary, setSummary] = useState(null);   // fsa_last_exam fallback
  const [loading, setLoading] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatState, setChatState] = useState({ messages: [], displayContent: null, examProgress: null });

  // Resolve which course these results belong to (nav state → query → cache).
  const navDebrief = location.state?.debrief || null;
  let cachedFull = null;
  try { cachedFull = JSON.parse(localStorage.getItem('fsa_last_exam_full') || 'null'); } catch { /* ignore */ }
  const courseId = navDebrief?.courseId || params.get('paper') || cachedFull?.courseId || '';

  useEffect(() => {
    let cancelled = false;

    // Instant paint from whatever we already have client-side.
    let summ = null;
    try { summ = JSON.parse(localStorage.getItem('fsa_last_exam') || 'null'); } catch { /* ignore */ }
    if (!cancelled) setSummary(summ);

    const initial = navDebrief || cachedFull;
    if (initial?.display_update && !cancelled) {
      setDebrief(initial);
      if (initial.tutor_response) {
        setChatState({
          messages: [{ role: 'tutor', content: initial.tutor_response }],
          displayContent: initial.display_update,
          examProgress: null,
        });
      }
    }

    // Establish/restore the tutor session and pull the authoritative debrief.
    // Sending 'hello' lets the orchestrator restore the debrief from the DB
    // (survives AI-service restarts) so follow-up questions are answered.
    async function init() {
      if (!courseId || !user.email || !(initial || summ)) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const data = await postJson('/api/chat', {
          user: user.email, lessonId: courseId, message: 'hello',
        });
        const dc = data.display_update;
        // Only adopt a genuine results payload — never a freshly-started exam.
        if (!cancelled && dc?.type === 'exam_done') {
          const fresh = {
            courseId,
            display_update: dc,
            tutor_response: data.tutor_response || initial?.tutor_response || '',
            date: initial?.date,
          };
          setDebrief(fresh);
          try { localStorage.setItem('fsa_last_exam_full', JSON.stringify(fresh)); } catch { /* ignore */ }
          setChatState(prev => prev.messages.length ? prev : ({
            messages: fresh.tutor_response ? [{ role: 'tutor', content: fresh.tutor_response }] : [],
            displayContent: dc,
            examProgress: null,
          }));
        }
      } catch { /* offline / no session — keep client-side copy */ }
      if (!cancelled) setLoading(false);
    }
    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateMessages = (updater) => {
    setChatState(prev => ({
      ...prev,
      messages: typeof updater === 'function' ? updater(prev.messages) : updater,
    }));
  };

  const dc = debrief?.display_update;
  const hasFull = !!(dc && ((dc.objective_breakdowns && dc.objective_breakdowns.length) ||
                            (dc.chapter_stats && dc.chapter_stats.length)));

  // ── Loading ──
  if (loading && !debrief && !summary) {
    return (
      <div className="er-loading">
        Loading your results…
      </div>
    );
  }

  // ── No results at all ──
  if (!hasFull && !summary) {
    return (
      <div className="er-empty">
        <p>No exam results found.</p>
        <button
          onClick={() => navigate('/lobby')}
          className="er-empty-btn"
        >
          ← Back to Lobby
        </button>
      </div>
    );
  }

  // ── Full feedback view (results + next-exam + Where to focus + tutor chat) ──
  if (hasFull) {
    return (
      <div className="er-page">
        <header className="er-header">
          <span className="er-title">
            {courseId} — Practice Exam Results
          </span>
          <button className="er-back-btn" onClick={() => navigate('/lobby')}>← Back to Lobby</button>
        </header>

        <div className="er-content">
          <ResultsPanel
            displayContent={dc}
            isExam={true}
            onRetry={() => navigate(`/practice-exam?paper=${encodeURIComponent(courseId)}&count=${dc.total || 50}&timed=false`)}
            onSelectChapter={null}
            user={user.email}
          />
        </div>

        {/* Floating tutor chat — same as the in-exam debrief. Hidden for 4th
            Class (see isFourthClass above). */}
        {!isFourthClass && (
          <button
            onClick={() => setChatOpen(o => !o)}
            className={(!chatOpen ? 'tutor-fab tutor-fab--pulse' : 'tutor-fab') + ' er-fab'}
            title="Ask the AI Tutor"
          >
            💬
          </button>
        )}

        {!isFourthClass && chatOpen && (
          <div className="er-chat-panel">
            <div className="er-chat-head">
              <span className="er-chat-title">Ask the AI Tutor</span>
              <button onClick={() => setChatOpen(false)} className="er-chat-close">✕</button>
            </div>
            <div className="er-chat-body">
              <QuizExamChatSection
                messages={chatState.messages}
                setMessages={updateMessages}
                user={user.email}
                lessonId={courseId}
                setChatState={setChatState}
                isExam={true}
                isDone={true}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Fallback summary view (older results with no cached full debrief) ──
  return <SummaryView summary={summary} navigate={navigate} />;
}

// Legacy summary layout, kept as a graceful fallback when only the lightweight
// fsa_last_exam summary is available (e.g. an exam taken before full debriefs
// were persisted).
function SummaryView({ summary, navigate }) {
  const [openCardId, setOpenCardId] = useState(null);
  const { score, total, correct, chapters = [], date } = summary;
  const overallGrade = getGrade(score);
  const weakChapters = chapters.filter(ch => getGrade(ch.score) !== 'A');

  return (
    <div className="er-summary">
      <div className="er-summary-grid">
        <div>
          <h1 className="er-summary-h1">
            Practice Exam Results
          </h1>
          {date && (
            <p className="er-summary-date">
              {new Date(date).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </p>
          )}
          <div className="er-summary-card">
            <div className="er-summary-score-row">
              <span className={`er-score ${overallGrade === 'A' ? 'er-score--a' : overallGrade === 'B' ? 'er-score--b' : 'er-score--c'}`}>
                {score}%
              </span>
              <GradeBadge grade={overallGrade} />
            </div>
            <p className="er-summary-fraction">{correct} / {total} questions correct</p>
          </div>
          <div className="er-summary-actions">
            <button
              onClick={() => navigate('/lobby')}
              className="er-summary-back-btn"
            >
              ← Back to Lobby
            </button>
          </div>
        </div>
        <div>
          <h2 className="er-summary-h2">
            Areas to Improve
          </h2>
          {weakChapters.length === 0 ? (
            <div className="er-summary-empty">
              <p className="er-summary-empty-msg">All chapters are grade A — great work!</p>
            </div>
          ) : (
            weakChapters.map(ch => (
              <WeaknessCard key={ch.chapter_id} chapter={ch} openId={openCardId} setOpenId={setOpenCardId} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
