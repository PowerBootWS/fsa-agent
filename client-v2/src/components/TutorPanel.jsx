// fsa-agent/client-v2/src/components/TutorPanel.jsx
import { useState, useRef, useEffect } from 'react';
import { getJson, postJson } from '../utils/api';
import { track } from '../utils/usage';
import { KatexSpan } from './MathContent';
import 'katex/dist/katex.min.css';

function renderInline(text, keyPrefix) {
  const mathParts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return mathParts.flatMap((part, i) => {
    if (part.startsWith('$$') && part.endsWith('$$')) {
      return [<KatexSpan key={`${keyPrefix}-m${i}`} math={part.slice(2, -2)} displayMode />];
    }
    if (part.startsWith('$') && part.endsWith('$')) {
      return [<KatexSpan key={`${keyPrefix}-m${i}`} math={part.slice(1, -1)} displayMode={false} />];
    }
    return part.split(/(\*\*[^*]+\*\*)/g).map((p, j) => {
      if (p.startsWith('**') && p.endsWith('**')) {
        return <strong key={`${keyPrefix}-b${i}-${j}`}>{p.slice(2, -2)}</strong>;
      }
      return <span key={`${keyPrefix}-b${i}-${j}`}>{p}</span>;
    });
  });
}

const WELCOME = { type: 'proactive', text: "Welcome! I'm your AI tutor. Ask me anything as we go through this lesson." };

/**
 * The checkpoint card the student is looking at, in the shape /api/chat
 * expects — the latest question card in the thread. The correct answer goes
 * along only once they have picked, so the tutor can explain it without ever
 * being handed the answer to a question still in play.
 */
export function screenQuestionFrom(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.type !== 'question') continue;
    const answered = Number.isInteger(msg.answerIndex);
    return {
      question_text: msg.question.question_text || '',
      options: msg.question.options || [],
      selected_index: answered ? msg.answerIndex : null,
      correct_answer: answered ? msg.question.correct_answer : null,
    };
  }
  return undefined;
}

/**
 * QuestionCard — renders a single practice question with answer selection.
 * Uses correct_answer (matches the DB column name).
 */
export function QuestionCard({ question, lessonCode, onAnswer, sublabel, label = 'Practice question', allowFlag = true }) {
  const [selected, setSelected] = useState(null);
  const options = question.options || [];
  // 'idle' -> 'open' (reason box showing) -> 'sent' | 'failed'
  const [flagState, setFlagState] = useState('idle');
  const [flagReason, setFlagReason] = useState('');

  function handleSelect(idx) {
    if (selected !== null) return; // already answered
    setSelected(idx);
    const correct = idx === question.correct_answer;
    onAnswer({
      question_id: question.id,
      answer_index: idx,
      correct,
      correct_answer: question.correct_answer,
    });
  }

  async function submitFlag() {
    // Optimistic: the student has done their bit the moment they click. Making
    // them wait on a network round trip to find out whether their report
    // counted is the kind of friction that stops the next one being filed.
    setFlagState('sent');
    try {
      await postJson('/api/v2/question-flag', {
        question_id: question.id,
        lesson_code: lessonCode,
        selected_index: selected,
        reason: flagReason,
      });
    } catch {
      setFlagState('failed');
    }
  }

  return (
    <div className="question-card">
      {/* Without this header the card reads as a continuation of whatever is on
          the slide — students hit a same-topic question next to a worked
          example and assume it is the same problem. Say plainly that it is a
          separate exercise. */}
      <div className="q-label">{label}</div>
      <div className="q-sublabel">
        {sublabel || 'Separate from the example on the left — same topic, your turn to try it.'}
      </div>
      <div className="q-text">{renderInline(question.question_text || '', 'qt')}</div>
      {options.map((opt, idx) => {
        const optText = typeof opt === 'string' ? opt : opt.text || JSON.stringify(opt);
        return (
          <button
            key={idx}
            className={[
              'q-option',
              selected !== null && idx === question.correct_answer ? 'correct' : '',
              selected === idx && idx !== question.correct_answer ? 'wrong' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => handleSelect(idx)}
          >
            {renderInline(optText, `opt${idx}`)}
          </button>
        );
      })}
      {selected !== null && allowFlag && (
        <div className="q-flag">
          {flagState === 'idle' && (
            <button className="q-flag-open" onClick={() => setFlagState('open')}>
              Think this question is wrong? Tell us
            </button>
          )}
          {flagState === 'open' && (
            <div className="q-flag-form">
              <textarea
                className="q-flag-reason"
                rows={2}
                value={flagReason}
                placeholder="What looks wrong? (optional)"
                onChange={e => setFlagReason(e.target.value)}
              />
              <div className="q-flag-actions">
                <button className="q-flag-send" onClick={submitFlag}>Report it</button>
                <button className="q-flag-cancel" onClick={() => setFlagState('idle')}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {flagState === 'sent' && (
            <div className="q-flag-done">
              Thanks — Russ will look at this one personally.
            </div>
          )}
          {flagState === 'failed' && (
            <div className="q-flag-done">
              We could not record that. Email support@fullsteamahead.ca and we will fix it.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * TutorPanel — the AI tutor chat in the lesson player.
 *
 * Two modes:
 *  - panel (default): the always-on right 40%. Checkpoint question cards are
 *    injected into the thread.
 *  - drawer (lesson tutor redesign, slice 4): opened on demand from "Ask about
 *    this slide" or a check-in's "Quick exercise". Practice questions live on
 *    the check-in card instead, reported here as `screenQuestion`, and the
 *    saved conversation for the objective is loaded when it opens.
 *
 * Props:
 *   lessonCode     — string
 *   learnerId      — string
 *   slideNumber    — lesson_chunks.slide_number the student is on (grounds the tutor)
 *   checkpoint     — { question } | null           (panel mode)
 *   onAnswered     — (entry) => void               (panel mode)
 *   drawer         — boolean                       (drawer mode)
 *   screenQuestion — card on screen, /api/chat shape (drawer mode)
 *   exerciseStart  — { id, from_slide, after_slide, recap_points } starts a
 *                    quick exercise (drawer mode)
 *   onFinishExercise — () => void, "Back to the lesson" (drawer mode)
 *   onClose        — () => void                    (drawer mode)
 */

const LETTERS = 'ABCD';
const EXERCISE_QUESTIONS = 4; // must match agents/exercise.py MAX_QUESTIONS
export function TutorPanel({
  lessonCode, learnerId, slideNumber, checkpoint, onAnswered,
  drawer = false, screenQuestion, exerciseStart, onFinishExercise, onClose,
}) {
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);
  const startedExerciseId = useRef(null);
  // Quick-exercise progress (slice 5). It lives here and travels with every
  // turn, so the tutor service holds no exercise state of its own.
  const exerciseRef = useRef(null);

  // Scroll to bottom within the messages container (not scrollIntoView — that bubbles to parent page in iframes)
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // The thread lasts for the whole objective. It used to be wiped on every
  // slide change, which students experienced as the tutor forgetting what
  // they had just asked (first NPS response, 2026-10-13). A new objective
  // starts a fresh thread; the tutor itself still remembers the old one.
  useEffect(() => {
    setMessages([WELCOME]);
    if (!drawer || !lessonCode) return undefined;
    // Drawer mode shows the saved conversation for this objective, so coming
    // back to a lesson reads as the same conversation rather than a new one.
    let cancelled = false;
    getJson(`/api/chat/history/${encodeURIComponent(lessonCode)}`)
      .then(data => {
        if (cancelled) return;
        const earlier = (data?.messages || []).map(m => ({
          type: m.role === 'user' ? 'user' : 'tutor', text: m.content,
        }));
        if (earlier.length) setMessages(prev => [...earlier, ...prev.filter(m => m !== WELCOME)]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [lessonCode, drawer]);

  // Checkpoint injection — the question card, on its own. It carries its own
  // header and sub-label, so a written preamble introducing it was pure
  // padding, and when no question came back the preamble was left announcing
  // one that never appeared.
  useEffect(() => {
    if (drawer || !checkpoint?.question) return;
    setMessages(prev => [...prev, { type: 'question', question: checkpoint.question }]);
  }, [checkpoint, drawer]);

  useEffect(() => {
    if (drawer) inputRef.current?.focus();
  }, [drawer]);

  async function send(text, last = null) {
    setMessages(prev => [...prev, { type: 'user', text }]);
    setLoading(true);
    const ex = exerciseRef.current;
    try {
      const data = await postJson('/api/chat', {
        user: learnerId,
        lessonId: lessonCode,
        message: text,
        ...(Number.isInteger(slideNumber) ? { slideNumber } : {}),
        screenQuestion: drawer ? screenQuestion : screenQuestionFrom(messages),
        ...(ex && !ex.done ? {
          exercise: {
            from_slide: ex.from_slide, after_slide: ex.after_slide,
            recap_points: ex.recap_points, asked: ex.asked, correct: ex.correct,
            ...(last ? { last } : {}),
          },
        } : {}),
      });
      const reply = data.tutor_response || data.response || data.message
        || (data.exercise_question ? '' : 'Sorry, I could not respond right now.');
      const added = [];
      if (reply) added.push({ type: 'tutor', text: reply });
      if (ex && !ex.done && data.exercise_question) {
        ex.asked += 1;
        added.push({
          type: 'exercise-question',
          number: ex.asked,
          question: { ...data.exercise_question, id: `x-${Date.now()}` },
        });
      }
      if (ex && !ex.done && data.exercise_done) {
        ex.done = true;
        track('feature_use', { action: 'exercise_completed', props: { lesson_code: lessonCode, asked: ex.asked, correct: ex.correct } });
        added.push({ type: 'exercise-done' });
      }
      setMessages(prev => [...prev, ...added]);
    } catch {
      setMessages(prev => [...prev, { type: 'tutor', text: 'Connection error. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  // The check-in's "Quick exercise": start a fresh exercise on its slides.
  useEffect(() => {
    if (!exerciseStart || exerciseStart.id === startedExerciseId.current) return;
    startedExerciseId.current = exerciseStart.id;
    exerciseRef.current = {
      from_slide: exerciseStart.from_slide,
      after_slide: exerciseStart.after_slide,
      recap_points: exerciseStart.recap_points || [],
      asked: 0,
      correct: 0,
      done: false,
    };
    send("Let's do the quick exercise.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseStart]);

  function handleExerciseAnswer(msg, entry) {
    const ex = exerciseRef.current;
    if (!ex || ex.done) return;
    if (entry.correct) ex.correct += 1;
    track('feature_use', { action: 'exercise_question_answered', props: { lesson_code: lessonCode, correct: entry.correct } });
    send(`I picked ${LETTERS[entry.answer_index]}.`, {
      question_text: msg.question.question_text,
      options: msg.question.options,
      correct_index: msg.question.correct_answer,
      selected_index: entry.answer_index,
      explanation: msg.question.explanation || '',
    });
  }

  function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    send(text);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleAnswer(entry) {
    onAnswered?.(entry);
    const feedback = entry.correct
      ? "Correct! Great work."
      : `Not quite — the correct answer was option ${(entry.correct_answer ?? 0) + 1}. Don't worry, keep going!`;
    setMessages(prev => [
      ...prev.map(m => (
        m.type === 'question' && m.question.id === entry.question_id && !Number.isInteger(m.answerIndex)
          ? { ...m, answerIndex: entry.answer_index }
          : m
      )),
      { type: 'proactive', text: feedback },
    ]);
  }

  return (
    <div className={`tutor-panel${drawer ? ' tutor-panel--drawer' : ''}`}>
      <div className="tutor-header">
        AI Tutor
        {drawer && (
          <button className="tutor-close" onClick={onClose} aria-label="Close tutor">✕</button>
        )}
      </div>
      <div className="tutor-messages" ref={messagesContainerRef}>
        {messages.map((msg, i) => {
          if (msg.type === 'exercise-question') {
            return (
              <QuestionCard
                key={msg.question.id}
                question={msg.question}
                lessonCode={lessonCode}
                label={`Question ${msg.number} of ${EXERCISE_QUESTIONS}`}
                sublabel="Pick an answer and the tutor will go through it with you."
                allowFlag={false}
                onAnswer={entry => handleExerciseAnswer(msg, entry)}
              />
            );
          }
          if (msg.type === 'exercise-done') {
            return (
              <div key={i} className="exercise-done">
                <button className="checkin-continue-from-tutor" onClick={onFinishExercise}>
                  Back to the lesson →
                </button>
              </div>
            );
          }
          if (msg.type === 'question') {
            return (
              <QuestionCard
                key={i}
                question={msg.question}
                lessonCode={lessonCode}
                onAnswer={handleAnswer}
              />
            );
          }
          return (
            <div
              key={i}
              className={`tutor-msg${msg.type === 'proactive' ? ' proactive' : msg.type === 'user' ? ' user' : ''}`}
            >
              {renderInline(msg.text, `msg${i}`)}
            </div>
          );
        })}
        {loading && <div className="tutor-msg proactive">Thinking…</div>}
      </div>
      <div className="tutor-input-row">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={drawer ? 'Ask about this slide…' : 'Ask the tutor…'}
          disabled={loading}
        />
        <button onClick={handleSend} disabled={loading || !input.trim()}>Send</button>
      </div>
    </div>
  );
}
