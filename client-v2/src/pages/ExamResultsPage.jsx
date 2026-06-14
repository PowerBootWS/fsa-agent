import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { InlineLessonPlayer } from '../components/InlineLessonPlayer';
import { ResultsPanel, QuizExamChatSection } from '../ExamRouter';

// ── Grade helpers (used by the summary fallback view) ─────────────────────────
function getGrade(pct) {
  if (pct >= 85) return 'A';
  if (pct >= 70) return 'B';
  return 'C';
}

function GradeBadge({ grade }) {
  const colors = {
    A: { bg: 'rgba(82,168,130,0.18)', color: '#52A882' },
    B: { bg: 'rgba(245,166,35,0.15)', color: '#F5A623' },
    C: { bg: 'rgba(220,38,38,0.12)', color: '#f87171' },
  };
  const style = colors[grade] || colors.C;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: '12px',
      background: style.bg, color: style.color, fontWeight: 700, fontSize: '13px',
    }}>
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
    <div style={{
      background: '#1C2333', border: '1px solid #252F42', borderRadius: '6px',
      padding: '16px', marginBottom: '12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ color: '#F4F5F7', fontWeight: 600 }}>{chapter.chapter_id}</span>
          <span style={{ color: '#666', fontSize: '13px', marginLeft: '10px' }}>
            {chapter.score}%
            {missed != null ? ` · missed ${missed} question${missed !== 1 ? 's' : ''}` : ''}
          </span>
        </div>
        <GradeBadge grade={grade} />
      </div>
      <button
        onClick={() => setOpenId(isOpen ? null : chapter.chapter_id)}
        style={{
          marginTop: '10px', background: '#E8720C', border: 'none', color: 'white',
          padding: '6px 14px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
          fontFamily: 'inherit',
        }}
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
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: user.email, lessonId: courseId, message: 'hello' }),
        });
        const data = await res.json();
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
      <div style={{ minHeight: '100vh', background: '#0D1117', color: '#a8b4c0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow', -apple-system, sans-serif" }}>
        Loading your results…
      </div>
    );
  }

  // ── No results at all ──
  if (!hasFull && !summary) {
    return (
      <div style={{ minHeight: '100vh', background: '#0D1117', padding: '48px', color: '#a8b4c0', textAlign: 'center', fontFamily: "'Barlow', -apple-system, sans-serif" }}>
        <p>No exam results found.</p>
        <button
          onClick={() => navigate('/lobby')}
          style={{ marginTop: '16px', background: '#E8720C', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          ← Back to Lobby
        </button>
      </div>
    );
  }

  const pageStyle = {
    minHeight: '100vh', background: '#0D1117', color: '#F4F5F7',
    fontFamily: "'Barlow', -apple-system, sans-serif",
  };
  const headerStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 24px', borderBottom: '1px solid #252F42',
  };
  const backBtn = {
    background: 'transparent', color: '#a8b4c0', border: '1px solid #252F42',
    borderRadius: '4px', padding: '8px 16px', cursor: 'pointer', fontSize: '14px', fontFamily: 'inherit',
  };

  // ── Full feedback view (results + next-exam + Where to focus + tutor chat) ──
  if (hasFull) {
    return (
      <div style={pageStyle}>
        <header style={headerStyle}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '20px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            {courseId} — Practice Exam Results
          </span>
          <button style={backBtn} onClick={() => navigate('/lobby')}>← Back to Lobby</button>
        </header>

        <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '24px' }}>
          <ResultsPanel
            displayContent={dc}
            isExam={true}
            onRetry={() => navigate(`/practice-exam?paper=${encodeURIComponent(courseId)}&count=${dc.total || 50}&timed=false`)}
            onSelectChapter={null}
            user={user.email}
          />
        </div>

        {/* Floating tutor chat — same as the in-exam debrief */}
        <button
          onClick={() => setChatOpen(o => !o)}
          className={!chatOpen ? 'tutor-fab tutor-fab--pulse' : 'tutor-fab'}
          style={{
            position: 'fixed', bottom: '24px', right: '24px', width: '56px', height: '56px',
            borderRadius: '50%', background: '#1d4ed8', border: 'none', cursor: 'pointer',
            fontSize: '24px', color: 'white', zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
          title="Ask the AI Tutor"
        >
          💬
        </button>

        {chatOpen && (
          <div style={{
            position: 'fixed', bottom: '90px', right: '24px', width: '700px',
            maxWidth: 'calc(100vw - 48px)', height: '520px', background: '#1e293b',
            border: '1px solid #334155', borderRadius: '12px', display: 'flex',
            flexDirection: 'column', zIndex: 99, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#e2e8f0', fontWeight: 600 }}>Ask the AI Tutor</span>
              <button onClick={() => setChatOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '18px' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
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
    <div style={{ height: '100vh', overflowY: 'auto', background: '#0D1117', color: '#F4F5F7', padding: '32px 24px', fontFamily: "'Barlow', -apple-system, sans-serif" }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', alignItems: 'start' }}>
        <div>
          <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '28px', fontWeight: 700, marginBottom: '8px', color: '#F4F5F7', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Practice Exam Results
          </h1>
          {date && (
            <p style={{ color: '#666', fontSize: '13px', marginBottom: '24px' }}>
              {new Date(date).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </p>
          )}
          <div style={{ background: '#1C2333', borderRadius: '4px', padding: '24px', marginBottom: '24px', border: '1px solid #252F42' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '48px', fontWeight: 800, color: overallGrade === 'A' ? '#52A882' : overallGrade === 'B' ? '#F5A623' : '#f87171' }}>
                {score}%
              </span>
              <GradeBadge grade={overallGrade} />
            </div>
            <p style={{ color: '#a8b4c0', margin: 0, fontSize: '15px' }}>{correct} / {total} questions correct</p>
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={() => navigate('/lobby')}
              style={{ background: 'transparent', color: '#a8b4c0', border: '1px solid #252F42', padding: '12px 24px', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontFamily: 'inherit' }}
            >
              ← Back to Lobby
            </button>
          </div>
        </div>
        <div>
          <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '22px', fontWeight: 700, marginBottom: '20px', color: '#F4F5F7', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Areas to Improve
          </h2>
          {weakChapters.length === 0 ? (
            <div style={{ background: '#1C2333', borderRadius: '4px', padding: '24px', border: '1px solid #252F42', textAlign: 'center' }}>
              <p style={{ color: '#52A882', fontWeight: 600, margin: 0 }}>All chapters are grade A — great work!</p>
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
