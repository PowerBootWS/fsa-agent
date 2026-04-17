import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { InlineMath, BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css';

// Error boundary component
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('React Error Boundary caught:', error, errorInfo);
  }

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

function App() {
  const [activeTab, setActiveTab] = useState('transcript');
  const [layoutMode, setLayoutMode] = useState('stacked'); // 'stacked' or 'side-by-side'
  const [user, setUser] = useState(null);
  const [lessonId, setLessonId] = useState(null);
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Session state for chat - persists across tab switches
  const [chatState, setChatState] = useState({
    messages: [],
    displayContent: null,
    complexityLevel: 3
  });

  useEffect(() => {
    // Parse iframe query params
    const params = new URLSearchParams(window.location.search);
    const userEmail = params.get('user');
    const lesson = params.get('lesson');

    if (!userEmail || !lesson) {
      setError('Missing required parameters: user, lesson');
      setLoading(false);
      return;
    }

    setUser(userEmail);
    setLessonId(lesson);

    // Validate and load lesson
    validateAndLoadLesson(userEmail, lesson);
  }, []);

  const validateAndLoadLesson = async (userEmail, lesson) => {
    try {
      // Validate session
      const validateRes = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: userEmail, lessonId: lesson }),
      });

      if (!validateRes.ok) {
        throw new Error('Invalid session');
      }

      // Load lesson
      const lessonRes = await fetch(`/api/lesson/${lesson}`);
      const lessonData = await lessonRes.json();
      setLesson(lessonData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading lesson...</div>;
  }

  if (error) {
    return <div className="error">{error}</div>;
  }

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
          {activeTab === 'transcript' && lesson && (
            <TranscriptView lesson={lesson} />
          )}
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
        <div className="transcript-text">
          {lesson.narration_text || 'No transcript available.'}
        </div>
      ) : (
        <div className="transcript-slides">
          {chunks.map((chunk) => (
            <div key={chunk.slide_number} className="transcript-slide">
              {chunk.title && (
                <h2 className="transcript-slide-title">{chunk.title}</h2>
              )}
              {chunk.narration && (
                <p className="transcript-slide-narration">{chunk.narration}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LessonView({ lesson, user, lessonId, chatState, setChatState, layoutMode = 'stacked' }) {
  const updateMessages = (updater) => {
    setChatState(prev => ({
      ...prev,
      messages: typeof updater === 'function' ? updater(prev.messages) : updater
    }));
  };

  // Initialize greeting when first loading the lesson tab
  useEffect(() => {
    // Only initialize if we haven't already
    if (!chatState.displayContent || chatState.messages.length === 0) {
      // Send initial message to get greeting
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, lessonId, message: 'hello' }),
      })
      .then(res => res.json())
      .then(data => {
        let responseText = data.tutor_response;
        if (typeof responseText === 'object' && responseText !== null) {
          responseText = responseText.response || JSON.stringify(responseText);
        }
        setChatState(prev => ({
          ...prev,
          messages: [{ role: 'tutor', content: responseText }],
          displayContent: data.display_update
        }));
      })
      .catch(err => console.error('Init error:', err));
    }
  }, []);

  // Send message to chat (used by clickable options)
  const sendAnswer = (answer) => {
    // Add user message
    setChatState(prev => ({
      ...prev,
      messages: [...prev.messages, { role: 'user', content: answer }]
    }));

    // Send to API (simulating user typing)
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, lessonId, message: answer }),
    })
    .then(res => res.json())
    .then(data => {
      // Extract response text
      let responseText = data.tutor_response;
      if (typeof responseText === 'object' && responseText !== null) {
        responseText = responseText.response || JSON.stringify(responseText);
      }

      setChatState(prev => ({
        ...prev,
        messages: [...prev.messages, { role: 'tutor', content: responseText }],
        displayContent: data.display_update
      }));
    })
    .catch(err => {
      console.error('Chat error:', err);
      setChatState(prev => ({
        ...prev,
        messages: [...prev.messages, { role: 'tutor', content: 'Sorry, I encountered an error. Please try again.' }]
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

// Render text that may contain $...$  (inline math) or $$...$$ (block math)
function MathContent({ text }) {
  if (!text) return null;

  // Split on $$...$$ (block) and $...$ (inline) delimiters
  const parts = [];
  const blockRegex = /\$\$([\s\S]+?)\$\$/g;
  const inlineRegex = /\$((?:[^$]|\\.)+?)\$/g;

  let lastIndex = 0;
  let match;

  // Process block math first (higher priority)
  const blockMatches = [...text.matchAll(blockRegex)];
  const inlineMatches = [...text.matchAll(inlineRegex)];

  // Build a flat list of segments sorted by position
  const segments = [];
  blockMatches.forEach(m => segments.push({ start: m.index, end: m.index + m[0].length, type: 'block', math: m[1] }));
  inlineMatches.forEach(m => {
    // Only include inline if not already inside a block match
    const insideBlock = blockMatches.some(b => m.index >= b.index && m.index < b.index + b[0].length);
    if (!insideBlock) {
      segments.push({ start: m.index, end: m.index + m[0].length, type: 'inline', math: m[1] });
    }
  });
  segments.sort((a, b) => a.start - b.start);

  let cursor = 0;
  segments.forEach((seg, i) => {
    if (seg.start > cursor) {
      parts.push(<span key={`t${i}`}>{text.slice(cursor, seg.start)}</span>);
    }
    if (seg.type === 'block') {
      parts.push(<BlockMath key={`b${i}`} math={seg.math} />);
    } else {
      parts.push(<InlineMath key={`il${i}`} math={seg.math} />);
    }
    cursor = seg.end;
  });

  if (cursor < text.length) {
    parts.push(<span key="tail">{text.slice(cursor)}</span>);
  }

  return parts.length > 0 ? <>{parts}</> : <span>{text}</span>;
}

function DisplaySection({ lesson, displayContent, onAnswer }) {
  const content = displayContent || {
    type: 'summary',
    title: 'Lesson Overview',
    content: lesson.summary || 'Welcome to this lesson.',
  };

  const keyPoints = content.key_points || [];
  const displayType = content.type;

  // Render question type with options
  if (displayType === 'question' && content.question) {
    const options = content.options || [];
    const handleOptionClick = (label) => {
      if (onAnswer) onAnswer(label);
    };
    return (
      <div className="display-section question-section">
        <div className="display-title">{content.title}</div>
        <div className="display-question">
          <MathContent text={content.question} />
        </div>
        <div className="display-options">
          {options.map((opt, idx) => (
            <div
              key={idx}
              className="option-item clickable"
              onClick={() => handleOptionClick(opt.label)}
            >
              <span className="option-label">{opt.label}.</span>
              <span className="option-text"><MathContent text={opt.text} /></span>
            </div>
          ))}
        </div>
        <div className="display-hint">Click an answer or type A, B, C, or D</div>
      </div>
    );
  }

  // Render summary / key-points view
  return (
    <div className="display-section">
      <div className="display-title">{content.title}</div>
      <div className="display-content">
        <MathContent text={content.content} />
      </div>
      {keyPoints.length > 0 && (
        <div className="display-key-points">
          {keyPoints.map((kp, idx) => (
            <div key={idx} className="key-point">
              <div className="key-point-title">{kp.title}</div>
              <div className="key-point-content"><MathContent text={kp.content} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Typewriter effect: streams full markdown text word-by-word, then renders final markdown
function TutorMessage({ content, animate = false }) {
  const [displayed, setDisplayed] = useState(animate ? '' : content);
  const [done, setDone] = useState(!animate);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!animate || content === '...thinking...') {
      setDisplayed(content);
      setDone(true);
      return;
    }

    // Split into tokens: words and whitespace/punctuation, preserving LaTeX blocks intact
    // We chunk by "word + following whitespace" to avoid breaking mid-token
    const tokens = [];
    // Protect $$...$$ and $...$ blocks as single tokens
    const tokenRegex = /\$\$[\s\S]*?\$\$|\$[^$\n]+?\$|\S+\s*/g;
    let m;
    while ((m = tokenRegex.exec(content)) !== null) {
      tokens.push(m[0]);
    }

    let idx = 0;
    setDisplayed('');
    setDone(false);

    // ~180 words/min reading pace → ~333ms/word, but we want it slightly faster to feel responsive
    // ~250 wpm → ~240ms/word; split each word's time across characters for smoothness
    const msPerWord = 60;  // approx 1000 wpm — fast enough to feel live, slow enough to notice

    const tick = () => {
      if (idx >= tokens.length) {
        setDone(true);
        return;
      }
      setDisplayed(prev => prev + tokens[idx]);
      idx++;
      rafRef.current = setTimeout(tick, msPerWord);
    };

    rafRef.current = setTimeout(tick, 0);
    return () => clearTimeout(rafRef.current);
  }, [content, animate]);

  if (content === '...thinking...') {
    return (
      <div className="thinking-dots">
        <span className="thinking-dot"></span>
        <span className="thinking-dot"></span>
        <span className="thinking-dot"></span>
      </div>
    );
  }
  if (typeof content !== 'string') return <span>{String(content)}</span>;

  // While animating, render the partial text; once done render full markdown
  // We render markdown throughout so formatting appears as text streams in
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
    >
      {displayed}
    </ReactMarkdown>
  );
}

function ChatSection({ user, lessonId, messages, setMessages, setDisplayContent }) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef(null);

  // Ensure messages is always an array
  const allMessages = Array.isArray(messages) ? messages : [];

  // Focused mode: show only the last 2 messages (current exchange)
  // History mode: show all messages with scroll
  const displayMessages = showHistory ? allMessages : allMessages.slice(-2);

  // Auto-scroll to bottom when new messages arrive
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

    // Append user message + thinking indicator to full history
    setMessages(prev => [
      ...prev,
      { role: 'user', content: userMessage },
      { role: 'tutor', content: '...thinking...' },
    ]);

    // Natural thinking delay: 1–3 seconds
    const delay = 1000 + Math.random() * 2000;

    try {
      await new Promise(resolve => setTimeout(resolve, delay));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, lessonId, message: userMessage }),
      });

      if (!res.ok) throw new Error('Failed to get response');

      const data = await res.json();

      let responseText = data.tutor_response;
      if (typeof responseText === 'object' && responseText !== null) {
        responseText = responseText.response || JSON.stringify(responseText);
      }

      // Replace the thinking indicator with the real response
      setMessages(prev => [...prev.slice(0, -1), { role: 'tutor', content: responseText }]);

      if (data.display_update) {
        setDisplayContent(data.display_update);
      }
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
          // Stable key based on position in the full message list, not display slice
          const globalIdx = showHistory ? idx : allMessages.length - displayMessages.length + idx;
          // Animate only the very last tutor message and only when it's a real response
          const isLatestTutor = msg.role === 'tutor'
            && msg.content !== '...thinking...'
            && globalIdx === allMessages.length - 1;
          return (
            <div key={globalIdx} className={`message ${msg.role}`}>
              <div className={`message-content ${msg.content === '...thinking...' ? 'thinking' : ''}`}>
                {msg.role === 'tutor'
                  ? <TutorMessage content={msg.content} animate={isLatestTutor} />
                  : <span>{msg.content}</span>
                }
              </div>
            </div>
          );
        })}
        {allMessages.length === 0 && (
          <div className="message tutor">
            <div className="message-content">
              Welcome! I'm your tutor for this lesson. Let's get started.
            </div>
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