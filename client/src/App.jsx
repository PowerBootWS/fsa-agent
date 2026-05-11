import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { InlineMath, BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectMode(lessonId) {
  if (!lessonId) return 'lesson';
  if (/^[A-Z0-9]{2,5}-\d{1,3}-\d{1,3}$/i.test(lessonId)) return 'lesson';
  if (/^[A-Z0-9]{2,5}-\d{1,3}$/i.test(lessonId)) return 'chapter_quiz';
  if (/^[A-Z0-9]{2,5}$/i.test(lessonId)) return 'practice_exam';
  return 'lesson';
}

function extractResponse(tutor_response) {
  if (tutor_response == null) return '';
  if (typeof tutor_response === 'string') return sanitizeText(tutor_response);
  if (typeof tutor_response === 'object') {
    return sanitizeText(tutor_response.response || JSON.stringify(tutor_response));
  }
  return sanitizeText(String(tutor_response));
}

function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\bundefined\b/g, '')
    .replace(/\bnull\b/g, '')
    .replace(/  +/g, ' ')
    .trim();
}

function ThinkingDots() {
  return (
    <>
      <span className="thinking-dot"></span>
      <span className="thinking-dot"></span>
      <span className="thinking-dot"></span>
    </>
  );
}

function readinessInfo(pct) {
  if (pct >= 70) return { cls: 'results-row--strong', label: 'Strong' };
  if (pct >= 40) return { cls: 'results-row--mid',    label: 'Building' };
  return              { cls: 'results-row--weak',   label: 'Needs Foundation' };
}

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error('React Error Boundary:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="error">
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------

function App() {
  const [activeTab, setActiveTab] = useState('transcript');
  const [layoutMode, setLayoutMode] = useState('stacked');
  const [user, setUser] = useState(null);
  const [lessonId, setLessonId] = useState(null);
  const [mode, setMode] = useState('lesson');
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [chatState, setChatState] = useState({
    messages: [],
    displayContent: null,
    complexityLevel: 3,
    examProgress: null,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get('mode');

    if (modeParam === 'diagnostic') {
      setMode('diagnostic');
      setLoading(false);
      return;
    }

    const userEmail = params.get('user');
    const lessonParam = params.get('lesson');

    if (!userEmail || !lessonParam) {
      setError('Missing required parameters: user, lesson');
      setLoading(false);
      return;
    }

    const detectedMode = detectMode(lessonParam);
    setUser(userEmail);
    setLessonId(lessonParam);
    setMode(detectedMode);

    validateAndLoadLesson(userEmail, lessonParam, detectedMode);
  }, []);

  const validateAndLoadLesson = async (userEmail, lesson, detectedMode) => {
    try {
      const validateRes = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: userEmail, lessonId: lesson }),
      });
      if (!validateRes.ok) throw new Error('Invalid session');

      const lessonRes = await fetch(`/api/lesson/${lesson}`);
      const lessonData = await lessonRes.json();
      setLesson(lessonData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading…</div>;
  if (error)   return <div className="error">{error}</div>;

  // Diagnostic lead magnet mode
  if (mode === 'diagnostic') {
    return (
      <ErrorBoundary>
        <div className="app-container app-fullpage">
          <DiagnosticFlow />
        </div>
      </ErrorBoundary>
    );
  }

  // Quiz and exam modes: no tabs, full page
  if (mode === 'chapter_quiz' || mode === 'practice_exam') {
    return (
      <ErrorBoundary>
        <div className="app-container app-fullpage">
          <QuizExamView
            lesson={lesson}
            user={user}
            lessonId={lessonId}
            mode={mode}
            chatState={chatState}
            setChatState={setChatState}
          />
        </div>
      </ErrorBoundary>
    );
  }

  // Lesson mode: original tab layout
  return (
    <ErrorBoundary>
      <div className="app-container">
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'transcript' ? 'active' : ''}`}
            onClick={() => setActiveTab('transcript')}
          >
            Transcript
          </button>
          <button
            className={`tab ${activeTab === 'lesson' ? 'active' : ''}`}
            onClick={() => setActiveTab('lesson')}
          >
            Interactive Lesson
          </button>
          {activeTab === 'lesson' && (
            <button
              className="tab layout-toggle"
              onClick={() => setLayoutMode(layoutMode === 'stacked' ? 'side-by-side' : 'stacked')}
              title={layoutMode === 'stacked' ? 'Switch to side-by-side' : 'Switch to stacked'}
            >
              {layoutMode === 'stacked' ? '⬌' : '⬇'}
            </button>
          )}
        </div>

        <div className="content">
          {activeTab === 'transcript' && lesson && <TranscriptView lesson={lesson} />}
          {activeTab === 'lesson' && lesson && (
            <LessonView
              lesson={lesson}
              user={user}
              lessonId={lessonId}
              chatState={chatState}
              setChatState={setChatState}
              layoutMode={layoutMode}
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}

// ---------------------------------------------------------------------------
// Quiz / Exam full-page view
// ---------------------------------------------------------------------------

function QuizExamView({ lesson, user, lessonId, mode, chatState, setChatState }) {
  const isExam = mode === 'practice_exam';
  const examProgress = chatState.examProgress;

  const updateMessages = (updater) => {
    setChatState(prev => ({
      ...prev,
      messages: typeof updater === 'function' ? updater(prev.messages) : updater,
    }));
  };

  // Auto-initialize on mount
  useEffect(() => {
    if (chatState.messages.length === 0) {
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, lessonId, message: 'hello' }),
      })
        .then(r => r.json())
        .then(data => {
          const msgs = [];
          if (data.tutor_response) {
            msgs.push({ role: 'tutor', content: extractResponse(data.tutor_response) });
          }
          setChatState(prev => ({
            ...prev,
            messages: msgs,
            displayContent: data.display_update ?? prev.displayContent,
            examProgress: data.exam_progress ?? prev.examProgress,
          }));
        })
        .catch(err => console.error('Init error:', err));
    }
  }, []);

  const displayContent = chatState.displayContent;
  const isDone = displayContent?.type === 'exam_done' || displayContent?.type === 'quiz_done';

  const sendAnswer = (answer) => {
    const isLastQuestion = isExam && !isDone && examProgress && examProgress.current === examProgress.total;
    const suppressChat = isExam && !isDone && !isLastQuestion;

    if (!suppressChat) {
      setChatState(prev => ({
        ...prev,
        messages: [...prev.messages, { role: 'user', content: answer }, { role: 'tutor', content: isLastQuestion ? 'Compiling results…' : '...thinking...' }],
      }));
    }

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, lessonId, message: answer }),
    })
      .then(r => r.json())
      .then(data => {
        setChatState(prev => {
          // If we suppressed the chat bubbles (exam answering phase), just update
          // the display and progress without touching the messages list.
          if (suppressChat) {
            return {
              ...prev,
              displayContent: data.display_update ?? prev.displayContent,
              examProgress: data.exam_progress ?? prev.examProgress,
            };
          }
          const msgs = [...prev.messages.slice(0, -1)];
          if (data.tutor_response) {
            msgs.push({ role: 'tutor', content: extractResponse(data.tutor_response) });
          }
          return {
            ...prev,
            messages: msgs,
            displayContent: data.display_update ?? prev.displayContent,
            examProgress: data.exam_progress ?? prev.examProgress,
          };
        });
      })
      .catch(err => console.error('Chat error:', err));
  };

  return (
    <div className="quizexam-container">
      {/* Header bar */}
      <div className="quizexam-header">
        <span className="quizexam-title">{lesson?.title || lessonId}</span>
        {isExam && examProgress && !isDone && (
          <ExamProgressBar current={examProgress.current} total={examProgress.total} />
        )}
        {!isExam && displayContent?.type === 'quiz_progress' && !isDone && (
          <ExamProgressBar
            current={displayContent.questions_done}
            total={displayContent.total}
            correct={displayContent.correct}
          />
        )}
      </div>

      {/* Main split: question panel + chat */}
      <div className="quizexam-body">
        <div className="quizexam-question-panel">
          <QuizExamDisplaySection
            displayContent={displayContent}
            onAnswer={sendAnswer}
            mode={mode}
            isExam={isExam}
          />
        </div>
        <div className="quizexam-chat-panel">
          <QuizExamChatSection
            messages={chatState.messages}
            setMessages={updateMessages}
            user={user}
            lessonId={lessonId}
            setChatState={setChatState}
            isExam={isExam}
            isDone={isDone}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diagnostic lead magnet flow
// ---------------------------------------------------------------------------

function DiagnosticFlow() {
  const [phase, setPhase] = useState('intro');
  const [quizCount, setQuizCount] = useState(30);
  const [user, setUser] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [results, setResults] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const handleCountSelect = (count) => {
    setQuizCount(count);
    setPhase('signup');
  };

  const handleSignup = async ({ email, first_name }) => {
    setUser({ email, first_name });
    setPhase('loading');

    const [, questionsRes] = await Promise.all([
      fetch('/api/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, first_name, tags: ["Paper_Planner"] }),
      }),
      fetch(`/api/diagnostic/questions?count=${quizCount}`),
    ]);

    if (!questionsRes.ok) throw new Error('Failed to load questions');
    const data = await questionsRes.json();
    if (!data.length) throw new Error('No questions available');
    setQuestions(data);
    setPhase('quiz');
  };

  const handleQuizComplete = async (finalResponses) => {
    try {
      const res = await fetch('/api/diagnostic/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: user.email, responses: finalResponses }),
      });
      const data = await res.json();
      setResults(data);
      setPhase('results');
    } catch (err) {
      setLoadError('Something went wrong calculating your results. Please try again.');
    }
  };

  if (loadError) {
    return (
      <div className="diagnostic-page">
        <div className="diagnostic-card">
          <p className="diagnostic-error">{loadError}</p>
          <button className="diagnostic-submit-btn" onClick={() => window.location.reload()}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'intro')   return <DiagnosticIntro onSelectCount={handleCountSelect} />;
  if (phase === 'signup')  return <DiagnosticSignup quizCount={quizCount} onSubmit={handleSignup} />;
  if (phase === 'loading') return <div className="diagnostic-loading">Preparing your diagnostic…</div>;
  if (phase === 'quiz')    return <DiagnosticQuiz questions={questions} onComplete={handleQuizComplete} />;
  if (phase === 'results') return <DiagnosticResults results={results} firstName={user?.first_name} />;
  return null;
}

function DiagnosticIntro({ onSelectCount }) {
  return (
    <div className="diagnostic-page">
      <div className="diagnostic-card">
        <div className="diagnostic-badge">Free — No Credit Card Required</div>
        <h1 className="diagnostic-title">Paper Planner Diagnostic</h1>
        <p className="diagnostic-subtitle">
          Not sure which 2nd Class papers to tackle first? Answer questions from all six
          papers — we'll score your readiness and give you a personalized attack order.
        </p>
        <div className="diagnostic-count-options">
          <button className="diagnostic-count-btn" onClick={() => onSelectCount(30)}>
            <span className="diagnostic-count-num">30 Questions</span>
            <span className="diagnostic-count-label">Quick — 5 per paper · ~15 minutes</span>
          </button>
          <button className="diagnostic-count-btn" onClick={() => onSelectCount(60)}>
            <span className="diagnostic-count-num">60 Questions</span>
            <span className="diagnostic-count-label">Deep — 10 per paper · ~30 minutes</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function DiagnosticSignup({ quizCount, onSubmit }) {
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!firstName.trim() || !email.trim()) {
      setError('Please fill in both fields.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ email: email.trim().toLowerCase(), first_name: firstName.trim() });
    } catch (err) {
      setError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="diagnostic-page">
      <div className="diagnostic-card">
        <h2 className="diagnostic-title">Create Your Free Account</h2>
        <p className="diagnostic-subtitle">
          Your results will be saved and you'll get a personalized paper order recommendation.
          {quizCount === 60
            ? ' Deep diagnostic: 60 questions, 10 per paper.'
            : ' Quick diagnostic: 30 questions, 5 per paper.'}
        </p>
        <form className="diagnostic-form" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="First name"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            required
          />
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          {error && <div className="diagnostic-error">{error}</div>}
          <button type="submit" className="diagnostic-submit-btn" disabled={submitting}>
            {submitting ? 'Starting…' : 'Start Diagnostic →'}
          </button>
        </form>
        <p className="diagnostic-fine-print">No spam. No credit card. Cancel anytime.</p>
      </div>
    </div>
  );
}

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E'];

function DiagnosticQuiz({ questions, onComplete }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [allResponses, setAllResponses] = useState([]);

  const question = questions[currentIndex];
  const total = questions.length;
  const isAnswered = selectedIndex !== null;
  const isLast = currentIndex === total - 1;

  const { posInPaper, perPaper } = useMemo(() => {
    const pq = questions.filter(q => q.course_id === question.course_id);
    return { posInPaper: pq.findIndex(q => q.id === question.id) + 1, perPaper: pq.length };
  }, [questions, currentIndex]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Trigger completion after showing feedback on the last question
  useEffect(() => {
    if (!isLast || !isAnswered) return;
    const id = setTimeout(() => onComplete(allResponses), 1400);
    return () => clearTimeout(id);
  }, [isLast, isAnswered]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (idx) => {
    if (isAnswered) return;
    setSelectedIndex(idx);
    setAllResponses(prev => [...prev, { question_id: question.id, selected_index: idx }]);
  };

  const handleNext = () => {
    setSelectedIndex(null);
    setCurrentIndex(i => i + 1);
  };

  return (
    <div className="quizexam-container">
      <div className="quizexam-header">
        <span className="quizexam-title">
          Paper {question.course_id} — Question {posInPaper} of {perPaper}
        </span>
        <ExamProgressBar current={currentIndex + 1} total={total} />
      </div>
      <div className="diagnostic-quiz-body">
        <div className="quizexam-question-card">
          <div className="quizexam-question-text">
            <MathContent text={question.question_text} />
          </div>
          <div className="quizexam-options">
            {question.options.map((optText, idx) => {
              let cls = 'quizexam-option';
              if (isAnswered) {
                if (idx === question.correct_answer) cls += ' option-correct';
                else if (idx === selectedIndex) cls += ' option-wrong';
                else cls += ' option-dimmed';
              }
              return (
                <button
                  key={idx}
                  className={cls}
                  onClick={() => handleSelect(idx)}
                  disabled={isAnswered}
                >
                  <span className="quizexam-option-label">{OPTION_LABELS[idx]}.</span>
                  <span className="quizexam-option-text"><MathContent text={optText} /></span>
                </button>
              );
            })}
          </div>
          {isAnswered && (
            <div className="diagnostic-feedback">
              {selectedIndex === question.correct_answer
                ? <span className="feedback-correct">Correct!</span>
                : <span className="feedback-wrong">
                    Incorrect — the correct answer was {OPTION_LABELS[question.correct_answer]}.
                  </span>
              }
              {isLast
                ? <div className="diagnostic-finishing">Calculating your results…</div>
                : <button className="diagnostic-next-btn" onClick={handleNext}>Next →</button>
              }
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DiagnosticResults({ results, firstName }) {
  const { paper_scores, attack_order, total_correct, total_questions } = results;
  const overallPct = Math.round((total_correct / total_questions) * 100);

  return (
    <div className="diagnostic-page diagnostic-results-page">
      <div className="diagnostic-results-card">
        <h1 className="diagnostic-title">
          {firstName ? `${firstName}'s` : 'Your'} Paper Diagnostic Results
        </h1>
        <div className="diagnostic-overall-score">
          {total_correct}/{total_questions} overall ({overallPct}%)
        </div>

        <h2 className="diagnostic-section-heading">Scores by Paper</h2>
        <table className="results-table diagnostic-scores-table">
          <thead>
            <tr><th>Paper</th><th>Score</th><th>Readiness</th></tr>
          </thead>
          <tbody>
            {paper_scores.map(p => {
              const { cls, label } = readinessInfo(p.pct);
              return (
                <tr key={p.course_id} className={cls}>
                  <td>{p.course_id}</td>
                  <td>{p.correct}/{p.total} ({p.pct}%)</td>
                  <td>{label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2 className="diagnostic-section-heading">Recommended Attack Order</h2>
        <p className="diagnostic-attack-desc">
          Start with your strongest papers to build momentum, then tackle those needing more foundation work.
        </p>
        <ol className="diagnostic-attack-list">
          {attack_order.map((p, i) => (
            <li
              key={p.course_id}
              className={`diagnostic-attack-item${p.flag === 'needs_foundation' ? ' attack-item-warning' : ''}`}
            >
              <span className="attack-rank">{i + 1}.</span>
              <span className="attack-paper">{p.course_id}</span>
              <span className="attack-pct">{p.pct}%</span>
              {p.flag === 'needs_foundation' && (
                <span className="attack-flag">Foundation work recommended</span>
              )}
            </li>
          ))}
        </ol>

        <div className="diagnostic-cta-block">
          <p>Ready to close the gaps? Full Steam Ahead covers all six papers with step-by-step coaching and AI tutoring.</p>
          <a href="https://enrollment.fullsteamahead.ca" className="diagnostic-cta-btn">
            Start Your Subscription →
          </a>
          <p className="diagnostic-cta-fine">$149/month — all 6 papers — cancel anytime</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exam progress bar
// ---------------------------------------------------------------------------

function ExamProgressBar({ current, total, correct }) {
  const pct = Math.round((current / total) * 100);
  return (
    <div className="exam-progress">
      <div className="exam-progress-label">
        Question {current} of {total}
        {correct !== undefined && (
          <span className="exam-progress-score"> · {correct} correct</span>
        )}
      </div>
      <div className="exam-progress-bar">
        <div className="exam-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function QuizExamDisplaySection({ displayContent, onAnswer, isExam, mode }) {
  if (!displayContent) {
    return (
      <div className="quizexam-display-empty">
        <div className="quizexam-display-placeholder">Loading questions…</div>
      </div>
    );
  }

  const type = displayContent.type;

  // Done screen — show results table
  if (type === 'exam_done' || type === 'quiz_done') {
    return <ResultsPanel displayContent={displayContent} isExam={isExam} onRetry={isExam ? () => onAnswer('yes') : null} />;
  }

  // Question (quiz or exam)
  if (type === 'question' || type === 'exam_question') {
    const { question, options = [], title, chapter_id } = displayContent;
    return (
      <div className="quizexam-question-card">
        <div className="quizexam-question-meta">
          {title && <span className="quizexam-question-num">{title}</span>}
          {chapter_id && <span className="quizexam-chapter-tag">{chapter_id}</span>}
        </div>
        <div className="quizexam-question-text">
          <MathContent text={question} />
        </div>
        <div className="quizexam-options">
          {options.map((opt) => (
            <button
              key={opt.label}
              className="quizexam-option"
              onClick={() => onAnswer(`My answer is ${opt.label}`)}
            >
              <span className="quizexam-option-label">{opt.label}.</span>
              <span className="quizexam-option-text"><MathContent text={opt.text} /></span>
            </button>
          ))}
        </div>
        {isExam && (
          <div className="quizexam-exam-note">Select your answer — feedback at the end</div>
        )}
      </div>
    );
  }

  // Quiz progress bar (between questions)
  if (type === 'quiz_progress') {
    return (
      <div className="quizexam-display-empty">
        <div className="quizexam-display-placeholder">
          {displayContent.questions_done} of {displayContent.total} questions answered
          · {displayContent.correct} correct
        </div>
      </div>
    );
  }

  return null;
}

function ResultsPanel({ displayContent, isExam, onRetry }) {
  const { score, total, score_pct, chapter_stats } = displayContent;
  const scoreColor = score_pct >= 75 ? '#16a34a' : score_pct >= 55 ? '#d97706' : '#dc2626';
  const [retrying, setRetrying] = React.useState(false);

  const handleRetry = () => {
    setRetrying(true);
    onRetry();
  };

  return (
    <div className="results-panel">
      <div className="results-score" style={{ color: scoreColor }}>
        {score}/{total} <span className="results-score-pct">({score_pct}%)</span>
      </div>

      {chapter_stats && chapter_stats.length > 0 && (
        <table className="results-table">
          <thead>
            <tr>
              <th>Chapter</th>
              <th>Score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {chapter_stats.map(row => (
              <tr key={row.chapter} className={`results-row results-row--${row.status === 'Strong' ? 'strong' : row.status === 'Needs review' ? 'weak' : 'mid'}`}>
                <td>{row.chapter}</td>
                <td>{row.correct}/{row.total} ({row.pct}%)</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {onRetry && (
        <div className="results-retry-block">
          <button
            className="results-retry-btn"
            onClick={handleRetry}
            disabled={retrying}
          >
            {retrying ? 'Loading next exam…' : 'Retake Exam (Adaptive)'}
          </button>
          <p className="results-retry-hint">
            Your next exam will pull more questions from chapters you struggled with.
          </p>
        </div>
      )}
    </div>
  );
}

function QuizExamChatSection({ messages, setMessages, user, lessonId, setChatState, isExam, isDone }) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const allMessages = Array.isArray(messages) ? messages : [];

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [allMessages]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const userMessage = input.trim();
    setInput('');
    setSending(true);

    setMessages(prev => [
      ...prev,
      { role: 'user', content: userMessage },
      { role: 'tutor', content: '...thinking...' },
    ]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, lessonId, message: userMessage }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();

      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'tutor', content: extractResponse(data.tutor_response) },
      ]);
      setChatState(prev => ({
        ...prev,
        displayContent: data.display_update ?? prev.displayContent,
        examProgress: data.exam_progress ?? prev.examProgress,
      }));
    } catch (err) {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'tutor', content: 'Sorry, something went wrong. Please try again.' },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="quizexam-chat">
      <div className="quizexam-chat-messages" ref={messagesEndRef}>
        {allMessages.map((msg, idx) => {
          const isLatest = msg.role === 'tutor' && msg.content !== '...thinking...' && idx === allMessages.length - 1;
          const isThinking = msg.content === '...thinking...';
          return (
            <div key={idx} className={`message ${msg.role}`}>
              <div className={`message-content ${isThinking ? 'thinking' : ''}`}>
                {isThinking
                  ? <ThinkingDots />
                  : msg.role === 'tutor'
                    ? <TutorMessage content={msg.content} animate={isLatest} />
                    : <span>{msg.content}</span>
                }
              </div>
            </div>
          );
        })}
        {allMessages.length === 0 && (
          <div className="message tutor">
            <div className="message-content loading-session">Starting session…</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      {/* In exam mode, hide the text input — answers come from clicking options */}
      {(!isExam || isDone) && (
        <div className="chat-input">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isDone ? 'Type to chat or ask questions…' : 'Type your answer or question…'}
            disabled={sending}
          />
          <button onClick={handleSend} disabled={sending || !input.trim()}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transcript view
// ---------------------------------------------------------------------------

function TranscriptView({ lesson }) {
  const [chunks, setChunks] = useState(null);

  useEffect(() => {
    const id = lesson.lesson_code || lesson.id;
    fetch(`/api/lesson/${id}/chunks`)
      .then(res => res.json())
      .then(data => setChunks(Array.isArray(data) ? data : null))
      .catch(() => setChunks(null));
  }, [lesson]);

  return (
    <div className="transcript-container">
      <h1 className="transcript-title">{lesson.title}</h1>
      {chunks === null ? (
        <div className="transcript-loading">Loading transcript…</div>
      ) : chunks.length === 0 ? (
        <div className="transcript-text">{lesson.narration_text || 'No transcript available.'}</div>
      ) : (
        <div className="transcript-slides">
          {chunks.map((chunk) => (
            <div key={chunk.slide_number} className="transcript-slide">
              {chunk.title && <h2 className="transcript-slide-title">{chunk.title}</h2>}
              {chunk.narration && <p className="transcript-slide-narration">{chunk.narration}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lesson view (original)
// ---------------------------------------------------------------------------

function LessonView({ lesson, user, lessonId, chatState, setChatState, layoutMode = 'stacked' }) {
  const updateMessages = (updater) => {
    setChatState(prev => ({
      ...prev,
      messages: typeof updater === 'function' ? updater(prev.messages) : updater,
    }));
  };

  useEffect(() => {
    if (!chatState.displayContent || chatState.messages.length === 0) {
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, lessonId, message: 'hello' }),
      })
        .then(res => res.json())
        .then(data => {
          setChatState(prev => ({
            ...prev,
            // Only set the greeting if the user hasn't already started chatting
            messages: prev.messages.length === 0
              ? [{ role: 'tutor', content: extractResponse(data.tutor_response) }]
              : prev.messages,
            displayContent: data.display_update ?? prev.displayContent,
          }));
        })
        .catch(err => console.error('Init error:', err));
    }
  }, []);

  const sendAnswer = (answer) => {
    setChatState(prev => ({
      ...prev,
      messages: [...prev.messages, { role: 'user', content: answer }, { role: 'tutor', content: '...thinking...' }],
      sending: true,
    }));

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, lessonId, message: answer }),
    })
      .then(res => res.json())
      .then(data => {
        setChatState(prev => ({
          ...prev,
          messages: [...prev.messages.slice(0, -1), { role: 'tutor', content: extractResponse(data.tutor_response) }],
          displayContent: data.display_update ?? prev.displayContent,
          sending: false,
        }));
      })
      .catch(err => {
        console.error('Chat error:', err);
        setChatState(prev => ({
          ...prev,
          messages: [...prev.messages.slice(0, -1), { role: 'tutor', content: 'Sorry, I encountered an error. Please try again.' }],
          sending: false,
        }));
      });
  };

  return (
    <div className={`lesson-container ${layoutMode}`}>
      <DisplaySection lesson={lesson} displayContent={chatState.displayContent} onAnswer={sendAnswer} />
      <ChatSection
        user={user}
        lessonId={lessonId}
        messages={chatState.messages}
        setMessages={updateMessages}
        setDisplayContent={(displayContent) => setChatState(prev => ({ ...prev, displayContent }))}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Math rendering
// ---------------------------------------------------------------------------

function MathContent({ text }) {
  if (!text) return null;

  const parts = [];
  const blockRegex = /\$\$([\s\S]+?)\$\$/g;
  const inlineRegex = /\$((?:[^$]|\\.)+?)\$/g;

  const blockMatches = [...text.matchAll(blockRegex)];
  const inlineMatches = [...text.matchAll(inlineRegex)];

  const segments = [];
  blockMatches.forEach(m => segments.push({ start: m.index, end: m.index + m[0].length, type: 'block', math: m[1] }));
  inlineMatches.forEach(m => {
    const insideBlock = blockMatches.some(b => m.index >= b.index && m.index < b.index + b[0].length);
    if (!insideBlock) {
      segments.push({ start: m.index, end: m.index + m[0].length, type: 'inline', math: m[1] });
    }
  });
  segments.sort((a, b) => a.start - b.start);

  let cursor = 0;
  segments.forEach((seg, i) => {
    if (seg.start > cursor) parts.push(<span key={`t${i}`}>{text.slice(cursor, seg.start)}</span>);
    if (seg.type === 'block') parts.push(<BlockMath key={`b${i}`} math={seg.math} />);
    else parts.push(<InlineMath key={`il${i}`} math={seg.math} />);
    cursor = seg.end;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);

  return parts.length > 0 ? <>{parts}</> : <span>{text}</span>;
}

// ---------------------------------------------------------------------------
// Lesson DisplaySection (original)
// ---------------------------------------------------------------------------

function DisplaySection({ lesson, displayContent, onAnswer }) {
  const [collapsed, setCollapsed] = useState(false);

  const content = displayContent || {
    type: 'summary',
    title: 'Lesson Overview',
    content: lesson.summary || 'Welcome to this lesson.',
  };

  const keyPoints = content.key_points || [];
  const displayType = content.type;

  const CollapseToggle = ({ label }) => (
    <button
      className="display-collapse-btn"
      onClick={() => setCollapsed(c => !c)}
      title={collapsed ? 'Expand context panel' : 'Collapse context panel'}
    >
      {label}
      <span className="display-collapse-icon">{collapsed ? '▼' : '▲'}</span>
    </button>
  );

  if (displayType === 'question' && content.question) {
    const options = content.options || [];
    return (
      <div className={`display-section question-section${collapsed ? ' collapsed' : ''}`}>
        <div className="display-header">
          <CollapseToggle label={content.title} />
        </div>
        {!collapsed && (
          <>
            <div className="display-question"><MathContent text={content.question} /></div>
            <div className="display-options">
              {options.map((opt, idx) => (
                <div key={idx} className="option-item clickable" onClick={() => onAnswer(`My answer is ${opt.label}`)}>
                  <span className="option-label">{opt.label}.</span>
                  <span className="option-text"><MathContent text={opt.text} /></span>
                </div>
              ))}
            </div>
            <div className="display-hint">Click an answer or type A, B, C, or D</div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`display-section${collapsed ? ' collapsed' : ''}`}>
      <div className="display-header">
        <CollapseToggle label={content.title} />
      </div>
      {!collapsed && (
        <>
          {content.content && <div className="display-content"><MathContent text={content.content} /></div>}
          {keyPoints.length > 0 && (
            <ul className="display-key-points">
              {keyPoints.map((kp, idx) => (
                <li key={idx} className="key-point">
                  {kp.title && <span className="key-point-title">{kp.title}: </span>}
                  <span className="key-point-content"><MathContent text={(() => {
                    const text = kp.content || '';
                    const first = text.match(/^[^.!?]+[.!?]/);
                    if (first && first[0].length <= 140) return first[0];
                    if (text.length > 120) return text.slice(0, 120).trimEnd() + '…';
                    return text;
                  })()} /></span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Typewriter tutor message
// ---------------------------------------------------------------------------

function TutorMessage({ content, animate = false }) {
  const safeContent = (typeof content === 'string' && content) ? content : '';
  const [displayed, setDisplayed] = useState(animate ? '' : safeContent);
  const [done, setDone] = useState(!animate);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!animate || safeContent === '...thinking...') {
      setDisplayed(safeContent);
      setDone(true);
      return;
    }

    const tokens = [];
    const tokenRegex = /\$\$[\s\S]*?\$\$|\$[^$\n]+?\$|\S+\s*/g;
    let m;
    while ((m = tokenRegex.exec(safeContent)) !== null) tokens.push(m[0]);

    let idx = 0;
    setDisplayed('');
    setDone(false);

    const msPerWord = 60;
    const tick = () => {
      if (idx >= tokens.length) { setDone(true); return; }
      const token = tokens[idx];
      setDisplayed(prev => prev + (typeof token === 'string' ? token : ''));
      idx++;
      rafRef.current = setTimeout(tick, msPerWord);
    };

    rafRef.current = setTimeout(tick, 0);
    return () => clearTimeout(rafRef.current);
  }, [safeContent, animate]);

  if (safeContent === '...thinking...') {
    return <div className="thinking-dots"><ThinkingDots /></div>;
  }

  return (
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
      {displayed}
    </ReactMarkdown>
  );
}

// ---------------------------------------------------------------------------
// Lesson ChatSection (original)
// ---------------------------------------------------------------------------

function ChatSection({ user, lessonId, messages, setMessages, setDisplayContent }) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef(null);

  const allMessages = Array.isArray(messages) ? messages : [];
  const displayMessages = showHistory ? allMessages : allMessages.slice(-2);

  useEffect(() => {
    if (showHistory && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [allMessages, showHistory]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const userMessage = input.trim();
    setInput('');
    setSending(true);

    setMessages(prev => [
      ...prev,
      { role: 'user', content: userMessage },
      { role: 'tutor', content: '...thinking...' },
    ]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, lessonId, message: userMessage }),
      });
      if (!res.ok) throw new Error('Failed to get response');
      const data = await res.json();

      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'tutor', content: extractResponse(data.tutor_response) },
      ]);
      if (data.display_update != null) setDisplayContent(data.display_update);
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'tutor', content: 'Sorry, I ran into an issue. Please try again.' },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="chat-section">
      <div className="chat-toolbar">
        <button
          className={`history-toggle ${showHistory ? 'active' : ''}`}
          onClick={() => setShowHistory(h => !h)}
          title={showHistory ? 'Show current exchange only' : 'Show full conversation history'}
        >
          {showHistory ? 'Hide history' : 'Show history'}
        </button>
      </div>
      <div className={`chat-messages ${showHistory ? 'scrollable' : 'focused'}`}>
        {displayMessages.map((msg, idx) => {
          const globalIdx = showHistory ? idx : allMessages.length - displayMessages.length + idx;
          const isLatestTutor = msg.role === 'tutor' && msg.content !== '...thinking...' && globalIdx === allMessages.length - 1;
          const isThinking = msg.content === '...thinking...';
          return (
            <div key={globalIdx} className={`message ${msg.role}`}>
              <div className={`message-content ${isThinking ? 'thinking' : ''}`}>
                {isThinking
                  ? <ThinkingDots />
                  : msg.role === 'tutor'
                    ? <TutorMessage content={msg.content} animate={isLatestTutor} />
                    : <span>{msg.content}</span>
                }
              </div>
            </div>
          );
        })}
        {allMessages.length === 0 && (
          <div className="message tutor">
            <div className="message-content loading-session">Loading tutoring session…</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your answer or question..."
          disabled={sending}
        />
        <button onClick={handleSend} disabled={sending || !input.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

export default App;
