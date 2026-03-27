import { useState, useEffect } from 'react';

function App() {
  const [activeTab, setActiveTab] = useState('transcript');
  const [user, setUser] = useState(null);
  const [lessonId, setLessonId] = useState(null);
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
      </div>

      <div className="content">
        {activeTab === 'transcript' && lesson && (
          <TranscriptView lesson={lesson} />
        )}
        {activeTab === 'lesson' && lesson && (
          <LessonView lesson={lesson} user={user} lessonId={lessonId} />
        )}
      </div>
    </div>
  );
}

function TranscriptView({ lesson }) {
  return (
    <div className="transcript-container">
      <h1 className="transcript-title">{lesson.title}</h1>
      <div className="transcript-text">
        {lesson.video_transcript || 'No transcript available.'}
      </div>
    </div>
  );
}

function LessonView({ lesson, user, lessonId }) {
  return (
    <div className="lesson-container">
      <DisplaySection lesson={lesson} />
      <ChatSection user={user} lessonId={lessonId} />
    </div>
  );
}

function DisplaySection({ lesson }) {
  const [displayContent, setDisplayContent] = useState(null);

  useEffect(() => {
    // Show summary by default
    setDisplayContent({
      type: 'summary',
      title: 'Lesson Overview',
      content: lesson.summary || 'Welcome to this lesson.',
    });
  }, [lesson]);

  if (!displayContent) {
    return <div className="display-section">Loading...</div>;
  }

  return (
    <div className="display-section">
      <div className="display-title">{displayContent.title}</div>
      <div className="display-content">{displayContent.content}</div>
    </div>
  );
}

function ChatSection({ user, lessonId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!input.trim() || sending) return;

    const userMessage = input.trim();
    setInput('');
    setSending(true);

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, lessonId, message: userMessage }),
      });

      const data = await res.json();

      // Add tutor response
      setMessages(prev => [...prev, { role: 'tutor', content: data.tutor_response }]);
    } catch (err) {
      setMessages(prev => [
        ...prev,
        { role: 'tutor', content: 'Sorry, I encountered an error. Please try again.' },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-section">
      <div className="chat-messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            <div className="message-content">{msg.content}</div>
          </div>
        ))}
        {messages.length === 0 && (
          <div className="message tutor">
            <div className="message-content">
              Welcome! I'm your tutor for this lesson. Let's learn together.
            </div>
          </div>
        )}
      </div>
      <div className="chat-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask me anything about the lesson..."
          disabled={sending}
        />
        <button onClick={handleSend} disabled={sending || !input.trim()}>
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}

export default App;