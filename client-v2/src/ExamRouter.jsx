import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { PracticeExamLobby } from './components/PracticeExamLobby.jsx';
import { TeachingNotes, NextAttemptPreview } from './components/TeachingNotes.jsx';
import { MathContent } from './components/MathContent.jsx';
import { CountdownTimer } from './components/CountdownTimer.jsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  }, [safeContent, animate]);  // eslint-disable-line react-hooks/exhaustive-deps

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

// ---------------------------------------------------------------------------
// Results panel
// ---------------------------------------------------------------------------

function ResultsPanel({ displayContent, isExam, onRetry, onSelectChapter, user }) {
  const { score, total, score_pct, chapter_stats,
          objective_breakdowns, next_attempt_allocation } = displayContent;
  const scoreColor = score_pct >= 75 ? '#16a34a' : score_pct >= 55 ? '#d97706' : '#dc2626';
  const [retrying, setRetrying] = useState(false);

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
            <tr><th>Chapter</th><th>Score</th><th>Status</th></tr>
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

      {objective_breakdowns && objective_breakdowns.length > 0 && (
        <TeachingNotes
          objectiveBreakdowns={objective_breakdowns}
          chapterStats={chapter_stats}
          onSelectChapter={onSelectChapter}
          user={user}
        />
      )}

      {next_attempt_allocation && (
        <NextAttemptPreview
          nextAttemptAllocation={next_attempt_allocation}
          totalCount={total}
        />
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

// ---------------------------------------------------------------------------
// Quiz/exam display section
// ---------------------------------------------------------------------------

function QuizExamDisplaySection({ displayContent, onAnswer, isExam, mode, onSelectChapter, user }) {
  if (!displayContent) {
    return (
      <div className="quizexam-display-empty">
        <div className="quizexam-display-placeholder">Loading questions…</div>
      </div>
    );
  }

  const type = displayContent.type;

  if (type === 'exam_done' || type === 'quiz_done') {
    return (
      <ResultsPanel
        displayContent={displayContent}
        isExam={isExam}
        onRetry={isExam ? () => onAnswer('yes') : null}
        onSelectChapter={onSelectChapter}
        user={user}
      />
    );
  }

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

// ---------------------------------------------------------------------------
// Quiz/exam chat section (tutor panel for exams)
// ---------------------------------------------------------------------------

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
    } catch {
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
// QuizExamView — full exam/quiz page
// ---------------------------------------------------------------------------

function QuizExamView({ lesson, user, lessonId, mode, chatState, setChatState, examConfig, onSelectChapter }) {
  const isExam = mode === 'practice_exam';
  const examProgress = chatState.examProgress;

  const updateMessages = (updater) => {
    setChatState(prev => ({
      ...prev,
      messages: typeof updater === 'function' ? updater(prev.messages) : updater,
    }));
  };

  useEffect(() => {
    if (chatState.messages.length === 0) {
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user,
          lessonId,
          message: 'hello',
          ...(examConfig ? { examConfig } : {}),
        }),
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
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="quizexam-header">
        <span className="quizexam-title">{lesson?.title || lessonId}</span>
        <div className="quizexam-header-right">
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
          {isExam && examConfig?.timed && examProgress && !isDone && (
            <CountdownTimer
              totalSeconds={{ 25: 2700, 50: 5400, 100: 10800 }[examConfig.count] ?? 5400}
              stopped={isDone}
            />
          )}
        </div>
      </div>

      <div className="quizexam-body">
        <div className="quizexam-question-panel">
          <QuizExamDisplaySection
            displayContent={displayContent}
            onAnswer={sendAnswer}
            mode={mode}
            isExam={isExam}
            onSelectChapter={onSelectChapter}
            user={user}
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
// PracticeExamRouter — orchestrates lobby → exam → results flow
// ---------------------------------------------------------------------------

function PracticeExamRouter({ lesson, user, lessonId, chatState, setChatState }) {
  const [phase, setPhase] = useState('lobby');
  const [examConfig, setExamConfig] = useState(null);
  const [activeChapterId, setActiveChapterId] = useState(null);
  const [returnPhase, setReturnPhase] = useState('lobby');
  const [reviewDebrief, setReviewDebrief] = useState(null);

  const handleStartExam = (config) => {
    setExamConfig(config);
    setChatState({ messages: [], displayContent: null, complexityLevel: 3, examProgress: null });
    setPhase('exam');
  };

  const handleSelectChapter = (chapterId) => {
    setReturnPhase(phase);
    setActiveChapterId(chapterId);
    setPhase('chapter_quiz');
    setChatState({ messages: [], displayContent: null, complexityLevel: 3, examProgress: null });
  };

  const handleBack = () => {
    setPhase(returnPhase);
    setActiveChapterId(null);
    if (returnPhase === 'lobby') {
      setChatState({ messages: [], displayContent: null, complexityLevel: 3, examProgress: null });
    }
  };

  const handleViewLastResults = (debrief) => {
    setReviewDebrief(debrief);
    setPhase('results');
  };

  const handleBackToLobby = () => {
    setPhase('lobby');
  };

  if (phase === 'lobby') {
    return (
      <PracticeExamLobby
        courseId={lessonId}
        user={user}
        lessonTitle={lesson?.title}
        onStartExam={handleStartExam}
        onSelectChapter={handleSelectChapter}
        onViewLastResults={handleViewLastResults}
      />
    );
  }

  if (phase === 'results') {
    return (
      <div className="quizexam-container">
        <div className="quizexam-header">
          <span className="quizexam-title">{lesson?.title || lessonId} — Most Recent Results</span>
        </div>
        <div className="quizexam-body">
          <div className="quizexam-question-panel">
            <div className="results-review-back">
              <button className="quizexam-back-btn" onClick={handleBackToLobby}>← Back to Lobby</button>
            </div>
            {reviewDebrief?.display_update && (
              <ResultsPanel
                displayContent={reviewDebrief.display_update}
                isExam={true}
                onRetry={null}
                onSelectChapter={handleSelectChapter}
                user={user}
              />
            )}
          </div>
          <div className="quizexam-chat-panel">
            {reviewDebrief?.tutor_response && (
              <div className="results-review-tutor">
                <div className="message tutor">
                  <div className="message-content">
                    <TutorMessage content={reviewDebrief.tutor_response} animate={false} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'chapter_quiz') {
    return (
      <div className="quizexam-with-back">
        <div className="quizexam-back-bar">
          <button className="quizexam-back-btn" onClick={handleBack}>
            ← Back to Exam
          </button>
        </div>
        <QuizExamView
          lesson={lesson}
          user={user}
          lessonId={activeChapterId}
          mode="chapter_quiz"
          chatState={chatState}
          setChatState={setChatState}
          examConfig={null}
          onSelectChapter={null}
        />
      </div>
    );
  }

  // phase === 'exam'
  return (
    <QuizExamView
      lesson={lesson}
      user={user}
      lessonId={lessonId}
      mode="practice_exam"
      chatState={chatState}
      setChatState={setChatState}
      examConfig={examConfig}
      onSelectChapter={handleSelectChapter}
    />
  );
}

// ---------------------------------------------------------------------------
// ExamRouter — top-level export, receives courseId + learnerId from App.jsx
// ---------------------------------------------------------------------------

export function ExamRouter({ courseId, learnerId }) {
  const [chatState, setChatState] = useState({
    messages: [],
    displayContent: null,
    complexityLevel: 3,
    examProgress: null,
  });

  return (
    <div className="app-fullpage">
      <PracticeExamRouter
        lesson={{ title: courseId }}
        user={learnerId}
        lessonId={courseId}
        chatState={chatState}
        setChatState={setChatState}
      />
    </div>
  );
}
