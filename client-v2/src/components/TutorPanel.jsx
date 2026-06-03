// fsa-agent/client-v2/src/components/TutorPanel.jsx
import { useState, useRef, useEffect } from 'react';
import { InlineMath, BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css';

function renderInline(text, keyPrefix) {
  const mathParts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return mathParts.flatMap((part, i) => {
    if (part.startsWith('$$') && part.endsWith('$$')) {
      return [<BlockMath key={`${keyPrefix}-m${i}`} math={part.slice(2, -2)} />];
    }
    if (part.startsWith('$') && part.endsWith('$')) {
      return [<InlineMath key={`${keyPrefix}-m${i}`} math={part.slice(1, -1)} />];
    }
    return part.split(/(\*\*[^*]+\*\*)/g).map((p, j) => {
      if (p.startsWith('**') && p.endsWith('**')) {
        return <strong key={`${keyPrefix}-b${i}-${j}`}>{p.slice(2, -2)}</strong>;
      }
      return <span key={`${keyPrefix}-b${i}-${j}`}>{p}</span>;
    });
  });
}

const BETWEEN_MESSAGES = [
  "You can ask me anything about this section at any time.",
  "Take your time — I'm here if you have questions.",
  "Did that make sense? Keep going or ask me to explain anything differently.",
];

/**
 * QuestionCard — renders a single practice question with answer selection.
 * Uses correct_answer (matches the DB column name).
 */
function QuestionCard({ question, onAnswer }) {
  const [selected, setSelected] = useState(null);
  const options = question.options || [];

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

  return (
    <div className="question-card">
      <div className="q-text">{question.question_text}</div>
      {options.map((opt, idx) => (
        <button
          key={idx}
          className={[
            'q-option',
            selected !== null && idx === question.correct_answer ? 'correct' : '',
            selected === idx && idx !== question.correct_answer ? 'wrong' : '',
          ].filter(Boolean).join(' ')}
          onClick={() => handleSelect(idx)}
        >
          {typeof opt === 'string' ? opt : opt.text || JSON.stringify(opt)}
        </button>
      ))}
    </div>
  );
}

/**
 * TutorPanel — right 40% of the lesson player.
 *
 * Props:
 *   lessonCode     — string
 *   learnerId      — string
 *   sectionIndex   — current section index (triggers between-section messages)
 *   checkpoint     — { message, question } | null
 *   onAnswered     — (entry) => void
 */
export function TutorPanel({ lessonCode, learnerId, sectionIndex, checkpoint, completionTrigger, onAnswered }) {
  const [messages, setMessages] = useState([
    { type: 'proactive', text: "Welcome! I'm your AI tutor. Ask me anything as we go through this lesson." },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesContainerRef = useRef(null);

  // Scroll to bottom within the messages container (not scrollIntoView — that bubbles to parent page in iframes)
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // On section change, clear chat and show a fresh single message
  useEffect(() => {
    if (sectionIndex === 0) return;
    const msg = BETWEEN_MESSAGES[sectionIndex % BETWEEN_MESSAGES.length];
    setMessages([{ type: 'proactive', text: msg }]);
  }, [sectionIndex]);

  // Checkpoint injection
  useEffect(() => {
    if (!checkpoint) return;
    setMessages(prev => [
      ...prev,
      { type: 'proactive', text: checkpoint.message },
      ...(checkpoint.question
        ? [{ type: 'question', question: checkpoint.question }]
        : []),
    ]);
  }, [checkpoint]);

  // Completion trigger — encourage practice before moving on
  useEffect(() => {
    if (!completionTrigger) return;
    setMessages(prev => [
      ...prev,
      {
        type: 'proactive',
        text: "Nice work finishing that objective! Before moving on, it's worth trying a couple of practice questions to lock in what you just covered. Want to give it a go?",
      },
    ]);
  }, [completionTrigger]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages(prev => [...prev, { type: 'user', text }]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: learnerId,
          lessonId: lessonCode,
          message: text,
        }),
      });
      const data = await res.json();
      const reply = data.tutor_response || data.response || data.message || 'Sorry, I could not respond right now.';
      setMessages(prev => [...prev, { type: 'tutor', text: reply }]);
    } catch {
      setMessages(prev => [...prev, { type: 'tutor', text: 'Connection error. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleAnswer(entry) {
    onAnswered(entry);
    const feedback = entry.correct
      ? "Correct! Great work."
      : `Not quite — the correct answer was option ${(entry.correct_answer ?? 0) + 1}. Don't worry, keep going!`;
    setMessages(prev => [...prev, { type: 'proactive', text: feedback }]);
  }

  return (
    <div className="tutor-panel">
      <div className="tutor-header">AI Tutor</div>
      <div className="tutor-messages" ref={messagesContainerRef}>
        {messages.map((msg, i) => {
          if (msg.type === 'question') {
            return <QuestionCard key={i} question={msg.question} onAnswer={handleAnswer} />;
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
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the tutor…"
          disabled={loading}
        />
        <button onClick={handleSend} disabled={loading || !input.trim()}>Send</button>
      </div>
    </div>
  );
}
