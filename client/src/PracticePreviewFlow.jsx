import React, { useState, useEffect, useRef } from 'react';
import { PracticeExamLobby } from './PracticeExamLobby.jsx';
import { QuizExamView } from './App.jsx';

export function PracticePreviewFlow() {
  // Honor ?class= so a deep link can skip the class picker.
  const initialClass = new URLSearchParams(window.location.search).get('class');
  const hasExplicitClass = initialClass === 'second' || initialClass === 'third';

  const [phase, setPhase] = useState('signup'); // 'signup' | 'class_select' | 'paper_picker' | 'lobby' | 'exam' | 'already_used'
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [classCode, setClassCode] = useState(hasExplicitClass ? initialClass : 'second');
  const [papers, setPapers] = useState([]);
  const [papersError, setPapersError] = useState(null);
  const [selectedPaper, setSelectedPaper] = useState(null);
  const [examConfig, setExamConfig] = useState(null);
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [chatState, setChatState] = useState({
    messages: [],
    displayContent: null,
    complexityLevel: 3,
    examProgress: null,
  });
  const emailSentRef = useRef(false);

  // Send results email exactly once when the debrief loads
  useEffect(() => {
    const d = chatState.displayContent;
    if (d?.type !== 'exam_done' || emailSentRef.current || !email) return;
    emailSentRef.current = true;
    fetch('/api/preview/send-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        first_name: firstName,
        course_id: selectedPaper,
        score: d.score,
        total: d.total,
        score_pct: d.score_pct,
        chapter_stats: d.chapter_stats || [],
      }),
    }).catch(() => {}); // fire-and-forget
  }, [chatState.displayContent]);

  // ── Signup ──────────────────────────────────────────────────────────────────
  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    setSignupError(null);
    setSignupLoading(true);
    try {
      const res = await fetch('/api/preview/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, first_name: firstName }),
      });
      const data = await res.json();
      if (data.success) {
        // With an explicit ?class=, skip the picker and load that class's papers.
        if (hasExplicitClass) {
          loadPapers(classCode);
        } else {
          setPhase('class_select');
        }
      } else if (data.already_used) {
        setPhase('already_used');
      } else {
        setSignupError(data.error || 'Something went wrong. Please try again.');
      }
    } catch {
      setSignupError('Something went wrong. Please try again.');
    } finally {
      setSignupLoading(false);
    }
  };

  // ── Class select → load papers ───────────────────────────────────────────────
  const loadPapers = async (code) => {
    setClassCode(code);
    setPapersError(null);
    try {
      const res = await fetch(`/api/preview/papers?class=${code}`);
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.papers) || data.papers.length === 0) {
        throw new Error('no papers');
      }
      setPapers(data.papers);
      setPhase('paper_picker');
    } catch {
      setPapersError("We couldn't load papers for that program. Please try again.");
      setPhase('class_select');
    }
  };

  // ── Paper picker ─────────────────────────────────────────────────────────────
  const handleSelectPaper = (paper) => {
    setSelectedPaper(paper);
    // Reset chat state for a fresh exam
    setChatState({ messages: [], displayContent: null, complexityLevel: 3, examProgress: null });
    setPhase('lobby');
  };

  // ── Lobby → exam ─────────────────────────────────────────────────────────────
  const handleStartExam = ({ count, timed }) => {
    setExamConfig({ count, timed, lead_magnet: true, first_name: firstName });
    setChatState({ messages: [], displayContent: null, complexityLevel: 3, examProgress: null });
    setPhase('exam');
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  if (phase === 'signup') {
    return (
      <div className="diagnostic-page">
        <div className="diagnostic-card">
          <h1 className="diagnostic-heading">Free Practice Exam</h1>
          <p className="diagnostic-intro">
            Try a real practice exam — no credit card needed. We'll send your personalized results to your inbox.
          </p>
          <form onSubmit={handleSignupSubmit} className="diagnostic-form">
            <div className="diagnostic-field">
              <label className="diagnostic-label" htmlFor="preview-firstname">First Name</label>
              <input
                id="preview-firstname"
                type="text"
                className="diagnostic-input"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                required
                placeholder="Your first name"
              />
            </div>
            <div className="diagnostic-field">
              <label className="diagnostic-label" htmlFor="preview-email">Email</label>
              <input
                id="preview-email"
                type="email"
                className="diagnostic-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
              />
            </div>
            <div className="diagnostic-consent-field">
              <label className="diagnostic-consent-label">
                <input
                  type="checkbox"
                  className="diagnostic-consent-checkbox"
                  checked={consentChecked}
                  onChange={e => setConsentChecked(e.target.checked)}
                  required
                />
                <span>
                  I agree to the{' '}
                  <a href="/terms-of-use.html" target="_blank" rel="noopener noreferrer">Terms of Service</a>
                  {' '}and{' '}
                  <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
                  , and consent to receive email messages from Full Steam Ahead.
                </span>
              </label>
            </div>
            {signupError && (
              <p className="diagnostic-error">{signupError}</p>
            )}
            <button
              type="submit"
              className="diagnostic-cta-btn"
              disabled={signupLoading || !consentChecked}
            >
              {signupLoading ? 'Saving…' : 'Start My Free Practice Exam →'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (phase === 'already_used') {
    return (
      <div className="diagnostic-page">
        <div className="diagnostic-card">
          <h1 className="diagnostic-heading">You've Already Taken Your Free Exam</h1>
          <p className="diagnostic-intro">
            Looks like {firstName || 'you'} already completed a free practice exam with us.
            Each visitor gets one free attempt — but the real thing is even better.
          </p>
          <p className="diagnostic-intro">
            A Full Steam Ahead subscription gives you unlimited adaptive practice exams for every
            paper in your certificate, full course content with step-by-step lessons, and AI tutoring —
            from $99/month.
          </p>
          <a
            href="https://enrollment.fullsteamahead.ca"
            className="diagnostic-cta-btn"
            target="_blank"
            rel="noopener noreferrer"
          >
            Start Your Subscription →
          </a>
          <p className="diagnostic-cta-fine">From $99/month · every paper included · cancel anytime</p>
        </div>
      </div>
    );
  }

  if (phase === 'class_select') {
    return (
      <div className="diagnostic-page">
        <div className="diagnostic-card">
          <h1 className="diagnostic-heading">Which certification are you preparing for?</h1>
          <p className="diagnostic-intro">We'll show you the practice papers for your program.</p>
          {papersError && <p className="diagnostic-error">{papersError}</p>}
          <div className="preview-paper-grid">
            <button className="preview-paper-btn" onClick={() => loadPapers('second')}>2nd Class</button>
            <button className="preview-paper-btn" onClick={() => loadPapers('third')}>3rd Class</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'paper_picker') {
    return (
      <div className="diagnostic-page">
        <div className="diagnostic-card">
          <h1 className="diagnostic-heading">Choose Your Exam Paper</h1>
          <p className="diagnostic-intro">Select the paper you'd like to practice</p>
          <div className="preview-paper-grid">
            {papers.map(paper => (
              <button
                key={paper}
                className="preview-paper-btn"
                onClick={() => handleSelectPaper(paper)}
              >
                {paper}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'lobby') {
    return (
      <PracticeExamLobby
        courseId={selectedPaper}
        user={email}
        lessonTitle={`${selectedPaper} Practice Exam`}
        leadMagnetMode={true}
        onStartExam={handleStartExam}
        onSelectChapter={null}
      />
    );
  }

  // phase === 'exam'
  const lesson = {
    id: selectedPaper,
    title: selectedPaper + ' Practice Exam',
    mode: 'practice_exam',
    paper: selectedPaper,
  };

  return (
    <QuizExamView
      lesson={lesson}
      user={email}
      lessonId={selectedPaper}
      mode="practice_exam"
      chatState={chatState}
      setChatState={setChatState}
      examConfig={examConfig}
      onSelectChapter={null}
      leadMagnetMode={true}
    />
  );
}
