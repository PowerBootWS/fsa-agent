import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { PracticeExamLobby } from './components/PracticeExamLobby.jsx';
import { TeachingNotes, NextAttemptPreview } from './components/TeachingNotes.jsx';
import { QuestionReview, QuestionReviewModal } from './components/QuestionReview.jsx';
import { DistractorCoaching } from './components/DistractorCoaching.jsx';
import { MathContent } from './components/MathContent.jsx';
import { CountdownTimer } from './components/CountdownTimer.jsx';
import { isFourthClassCode } from './utils/fourthClass';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function extractResponse(tutor_response) {
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
// Chat POST helper — when a leadMagnetToken is present (lead-magnet /
// free-practice-exam flow), routes through the token-authenticated
// /api/practice-exam/chat endpoint instead, which derives user/lessonId/
// identity (lead_magnet, first_name) server-side from the token — but count/
// timed are exam preferences, not identity, so they're still forwarded from
// the client same as the authenticated path. When leadMagnetToken is absent
// (the existing authenticated-student path), this sends the exact same
// request — same URL, headers, and body shape — as before this helper
// existed.
// ---------------------------------------------------------------------------

function postChatMessage(message, { leadMagnetToken, user, lessonId, examConfig } = {}) {
  if (leadMagnetToken) {
    return fetch('/api/practice-exam/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${leadMagnetToken}`,
      },
      body: JSON.stringify({ message, ...(examConfig ? { examConfig } : {}) }),
    });
  }
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, lessonId, message, ...(examConfig ? { examConfig } : {}) }),
  });
}

// ---------------------------------------------------------------------------
// Typewriter tutor message
// ---------------------------------------------------------------------------

export function TutorMessage({ content, animate = false }) {
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

export function ResultsPanel({ displayContent, isExam, onRetry, onSelectChapter, user, leadMagnetMode = false }) {
  const { score, total, score_pct, chapter_stats,
          objective_breakdowns, next_attempt_allocation, question_review,
          distractor_coaching } = displayContent;
  const scoreColor = score_pct >= 75 ? '#16a34a' : score_pct >= 55 ? '#d97706' : '#dc2626';
  const [retrying, setRetrying] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  const handleRetry = () => {
    setRetrying(true);
    onRetry();
  };

  const hasFocus = objective_breakdowns && objective_breakdowns.length > 0;
  const hasReview = question_review && question_review.length > 0;

  // Left column — the score overview, always visible (sticky) while the
  // right-hand lesson accordion scrolls independently.
  const overview = (
    <div className="exam-results-overview">
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

      {next_attempt_allocation && (
        <NextAttemptPreview
          nextAttemptAllocation={next_attempt_allocation}
          totalCount={total}
        />
      )}

      {/* Chapter quiz (short, ~15 questions max): show the review inline,
          directly on the results screen. */}
      {hasReview && !isExam && <QuestionReview questions={question_review} />}

      {/* Practice exam (25-100 questions): a button opens a modal instead —
          additive, sits below the existing chapter-stats table and
          weighting chart without disturbing them. */}
      {hasReview && isExam && (
        <div className="results-view-all-block">
          <button
            className="results-view-all-btn"
            onClick={() => setReviewModalOpen(true)}
          >
            View All Questions
          </button>
        </div>
      )}

      {!leadMagnetMode && onRetry && (
        <div className="results-retry-block">
          <button
            className="results-retry-btn"
            onClick={handleRetry}
            disabled={retrying}
          >
            {retrying
              ? 'Loading…'
              : isExam ? 'Retake Exam (Adaptive)' : 'Retry Quiz'}
          </button>
          <p className="results-retry-hint">
            {isExam
              ? 'Your next exam will pull more questions from chapters you struggled with.'
              : 'Get a fresh, randomly selected set of questions for this chapter.'}
          </p>
        </div>
      )}

      {/* Lead-magnet exams have no lobby to return to and no saved
          progress to retake — instead of onRetry, point at the $149/month
          subscription (same offer/tone as the orchestrator's lead-magnet
          debrief prompt in ai-service/agents/orchestrator.py). */}
      {leadMagnetMode && (
        <div className="results-enroll-block">
          <p className="results-enroll-copy">
            Ready for unlimited adaptive practice exams across every paper,
            full course content, and AI tutoring? Subscribe for $149/month.
          </p>
          <a
            className="results-enroll-btn"
            href="https://enrollment.fullsteamahead.ca"
          >
            Enroll Now →
          </a>
        </div>
      )}
    </div>
  );

  return (
    <div className={`results-panel${hasFocus ? ' results-panel--split' : ''}`}>
      {overview}
      {hasFocus && (
        <div className="exam-results-focus">
          <TeachingNotes
            objectiveBreakdowns={objective_breakdowns}
            chapterStats={chapter_stats}
            onSelectChapter={onSelectChapter}
          />
          {leadMagnetMode && (
            <DistractorCoaching
              coaching={distractor_coaching}
              questionReview={question_review}
            />
          )}
        </div>
      )}
      {/* If there are no objective breakdowns (no split layout), the
          coaching panel still needs a home — place it directly under the
          overview column in that case. */}
      {!hasFocus && leadMagnetMode && (
        <DistractorCoaching
          coaching={distractor_coaching}
          questionReview={question_review}
        />
      )}
      {hasReview && isExam && reviewModalOpen && (
        <QuestionReviewModal
          questions={question_review}
          onClose={() => setReviewModalOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quiz/exam display section
// ---------------------------------------------------------------------------

function QuizExamDisplaySection({ displayContent, onAnswer, isExam, mode, onSelectChapter, user, leadMagnetMode }) {
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
        onRetry={(isExam || mode === 'chapter_quiz') ? () => onAnswer('yes') : null}
        onSelectChapter={leadMagnetMode ? null : onSelectChapter}
        user={user}
        leadMagnetMode={leadMagnetMode}
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

export function QuizExamChatSection({ messages, setMessages, user, lessonId, setChatState, isExam, isDone, leadMagnetToken }) {
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
      const res = await postChatMessage(userMessage, { leadMagnetToken, user, lessonId });
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

function QuizExamView({ lesson, user, classCode, lessonId, mode, chatState, setChatState, examConfig, onSelectChapter, onComplete, leadMagnetToken, onExamDone, leadMagnetMode }) {
  const isExam = mode === 'practice_exam';
  // 4th Class has no AI tutor CHAT — but chapter-quiz mode's per-question
  // feedback ("Correct!" / "Not quite — the correct answer was...") is
  // delivered ONLY via this same tutor_response channel (see
  // _process_chapter_quiz in ai-service/agents/orchestrator.py — it's plain
  // templated text, not an LLM call, and there's no other display surface
  // for it). Hiding it there would silently break chapter quizzes for 4th
  // Class, not just remove optional tutoring. Only practice_exam mode's
  // chat is truly optional/supplementary (it shows a full stats debrief
  // instead), so only that mode gets hidden.
  //
  // NOTE: `user` here is a plain email string (passed through as the
  // `/api/chat` request identifier, not a user object) — it was never
  // going to carry `.class_code`. Use the dedicated `classCode` prop
  // instead, threaded from PracticeExamPage.jsx down through ExamRouter
  // and PracticeExamRouter. (Found via live testing: this condition had
  // silently always evaluated to `isFourthClass = false` because
  // `user?.class_code` was checked on a string.)
  const isFourthClass = isFourthClassCode(classCode) && mode !== 'chapter_quiz';
  const examProgress = chatState.examProgress;
  const [chatOpen, setChatOpen] = useState(false);
  // True between answering the final exam question and the debrief arriving —
  // swaps the question for a "compiling results" panel so it's clearly working.
  const [compilingResults, setCompilingResults] = useState(false);
  // Guards onExamDone so it can only fire once per session, even across
  // re-renders (the exam_done display state itself is normally stable once
  // set, but this makes the "fires exactly once" contract explicit).
  const examDoneFiredRef = useRef(false);

  const updateMessages = (updater) => {
    setChatState(prev => ({
      ...prev,
      messages: typeof updater === 'function' ? updater(prev.messages) : updater,
    }));
  };

  useEffect(() => {
    if (chatState.messages.length === 0) {
      postChatMessage('hello', { leadMagnetToken, user, lessonId, examConfig })
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

  // Store exam results in localStorage when exam completes, then (in the
  // platform app) hand off to the durable /exam/results page via onComplete.
  useEffect(() => {
    if (isExam && displayContent?.type === 'exam_done') {
      if (onExamDone && !examDoneFiredRef.current) {
        examDoneFiredRef.current = true;
        onExamDone();
      }
      const date = new Date().toISOString();
      // Pull the tutor's debrief summary (latest tutor message) to cache too.
      const tutorMsg = [...(chatState.messages || [])]
        .reverse()
        .find(m => m.role === 'tutor' && m.content && m.content !== '...thinking...');
      const tutorResponse = tutorMsg?.content || '';
      try {
        localStorage.setItem('fsa_last_exam', JSON.stringify({
          score: displayContent.score_pct,
          total: displayContent.total,
          correct: displayContent.score,
          chapters: (displayContent.chapter_stats || []).map(row => ({
            chapter_id: row.chapter,
            score: row.pct,
            correct: row.correct,
            total: row.total,
          })),
          date,
        }));
        // Full debrief — drives the unified /exam/results review surface.
        localStorage.setItem('fsa_last_exam_full', JSON.stringify({
          courseId: lessonId,
          display_update: displayContent,
          tutor_response: tutorResponse,
          date,
        }));
      } catch (e) {
        console.error('Failed to save exam results:', e);
      }
      if (onComplete) {
        onComplete({
          courseId: lessonId,
          display_update: displayContent,
          tutor_response: tutorResponse,
          date,
        });
      }
    }
  }, [displayContent?.type]);  // eslint-disable-line react-hooks/exhaustive-deps

  const sendAnswer = (answer) => {
    const isLastQuestion = isExam && !isDone && examProgress && examProgress.current === examProgress.total;
    const suppressChat = isExam && !isDone && !isLastQuestion;

    // On the final question, immediately replace the question with a loading
    // panel — the debrief LLM call takes a few seconds and the static question
    // otherwise looks frozen / invites re-clicking.
    if (isLastQuestion) setCompilingResults(true);

    if (!suppressChat) {
      setChatState(prev => ({
        ...prev,
        messages: [...prev.messages, { role: 'user', content: answer }, { role: 'tutor', content: isLastQuestion ? 'Compiling results…' : '...thinking...' }],
      }));
    }

    postChatMessage(answer, { leadMagnetToken, user, lessonId })
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
        setCompilingResults(false);
      })
      .catch(err => {
        console.error('Chat error:', err);
        setCompilingResults(false);
      });
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

      <div className="quizexam-body" style={{ display: 'block', overflowY: 'auto' }}>
        <div className="quizexam-question-panel" style={{ width: '100%', maxWidth: isExam && isDone ? '1180px' : '800px', margin: '0 auto', borderRight: 'none' }}>
          {compilingResults && !isDone ? (
            <div className="exam-compiling">
              <div className="exam-compiling-spinner" />
              <div className="exam-compiling-title">Loading results, please stand by…</div>
              <div className="exam-compiling-sub">Scoring your exam and preparing your feedback.</div>
            </div>
          ) : (
            <QuizExamDisplaySection
              displayContent={displayContent}
              onAnswer={sendAnswer}
              mode={mode}
              isExam={isExam}
              onSelectChapter={onSelectChapter}
              user={user}
              leadMagnetMode={leadMagnetMode}
            />
          )}
        </div>
      </div>

      {/* Floating chat button — pulses to draw attention once the exam
          review is on screen and the tutor's debrief is waiting. Hidden
          entirely for 4th Class (no AI tutor chat for that offering). */}
      {!isFourthClass && (
        <button
          onClick={() => setChatOpen(o => !o)}
          className={isExam && isDone && !chatOpen ? 'tutor-fab tutor-fab--pulse' : 'tutor-fab'}
          style={{
            position: 'fixed', bottom: '24px', right: '24px',
            width: '56px', height: '56px', borderRadius: '50%',
            background: '#1d4ed8', border: 'none', cursor: 'pointer',
            fontSize: '24px', color: 'white', zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
          title="Ask the AI Tutor"
        >
          💬
        </button>
      )}

      {/* Chat overlay */}
      {!isFourthClass && chatOpen && (
        <div style={{
          position: 'fixed', bottom: '90px', right: '24px',
          width: '700px', maxWidth: 'calc(100vw - 48px)', height: '520px', maxHeight: 'calc(100vh - 120px)',
          background: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
          display: 'flex', flexDirection: 'column', zIndex: 99,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>Ask the AI Tutor</span>
            <button
              onClick={() => setChatOpen(false)}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '18px' }}
            >
              ✕
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <QuizExamChatSection
              messages={chatState.messages}
              setMessages={updateMessages}
              user={user}
              lessonId={lessonId}
              setChatState={setChatState}
              isExam={isExam}
              isDone={isDone}
              leadMagnetToken={leadMagnetToken}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PracticeExamRouter — orchestrates lobby → exam → results flow
// ---------------------------------------------------------------------------

function PracticeExamRouter({ lesson, user, classCode, lessonId, chatState, setChatState, startPhase, initialConfig, onExit, onComplete, leadMagnetToken, onExamDone, leadMagnetMode }) {
  const [phase, setPhase] = useState(startPhase || 'lobby');
  const [examConfig, setExamConfig] = useState(initialConfig || null);
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
    if (onExit) onExit();
    else setPhase('lobby');
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
        leadMagnetMode={leadMagnetMode}
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
                leadMagnetMode={leadMagnetMode}
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
          {/* returnPhase has three possible values ('lobby', 'exam', 'results') —
              chapter quizzes are also reachable from TeachingNotes' chapter links
              on both the live exam debrief and the standalone "Most Recent
              Results" review screen. This label intentionally buckets 'exam'
              and 'results' together since handleBack() returns to either one
              correctly and "Back to Exam Results" reads fine for both. */}
          <button className="quizexam-back-btn" onClick={handleBack}>
            {returnPhase === 'lobby' ? '← Back to Lobby' : '← Back to Exam Results'}
          </button>
        </div>
        <QuizExamView
          lesson={lesson}
          user={user}
          classCode={classCode}
          lessonId={activeChapterId}
          mode="chapter_quiz"
          chatState={chatState}
          setChatState={setChatState}
          examConfig={null}
          onSelectChapter={null}
          leadMagnetToken={leadMagnetToken}
          leadMagnetMode={leadMagnetMode}
        />
      </div>
    );
  }

  // phase === 'exam'
  return (
    <div className="quizexam-with-back">
      <div className="quizexam-back-bar">
        <button className="quizexam-back-btn" onClick={handleBackToLobby}>
          ← Back to Lobby
        </button>
      </div>
      <QuizExamView
        lesson={lesson}
        user={user}
        classCode={classCode}
        lessonId={lessonId}
        mode="practice_exam"
        chatState={chatState}
        setChatState={setChatState}
        examConfig={examConfig}
        onSelectChapter={handleSelectChapter}
        onComplete={onComplete}
        leadMagnetToken={leadMagnetToken}
        onExamDone={onExamDone}
        leadMagnetMode={leadMagnetMode}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExamRouter — top-level export, receives courseId + learnerId from App.jsx
// ---------------------------------------------------------------------------

export function ExamRouter({ courseId, learnerId, classCode, initialConfig, onExit, onComplete, leadMagnetToken, onExamDone }) {
  const [chatState, setChatState] = useState({
    messages: [],
    displayContent: null,
    complexityLevel: 3,
    examProgress: null,
  });

  // A leadMagnetToken is only ever present for the unauthenticated
  // free-practice-exam flow — its presence is what turns on every
  // lead-magnet-specific UI treatment (locked chapter quizzes, hidden
  // retry/last-results, enroll CTA, distractor coaching) all the way down
  // through PracticeExamLobby / QuizExamView / ResultsPanel.
  const leadMagnetMode = Boolean(leadMagnetToken);

  return (
    <div className="app-fullpage">
      <PracticeExamRouter
        lesson={{ title: courseId }}
        user={learnerId}
        classCode={classCode}
        lessonId={courseId}
        chatState={chatState}
        setChatState={setChatState}
        startPhase={initialConfig ? 'exam' : 'lobby'}
        initialConfig={initialConfig}
        onExit={onExit}
        onComplete={onComplete}
        leadMagnetToken={leadMagnetToken}
        onExamDone={onExamDone}
        leadMagnetMode={leadMagnetMode}
      />
    </div>
  );
}
