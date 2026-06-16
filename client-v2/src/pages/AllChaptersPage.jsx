import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './AllChaptersPage.css';

export default function AllChaptersPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedChapters, setExpandedChapters] = useState({});

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      // Get active paper from /me endpoint
      const meRes = await fetch('/api/platform/me', { credentials: 'include' });
      if (!meRes.ok) throw new Error('Failed to load user');
      const me = await meRes.json();

      if (!me.active_paper) {
        navigate('/select-paper', { replace: true });
        return;
      }

      const res = await fetch(`/api/platform/course-structure/${me.active_paper}`, { credentials: 'include' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to load course structure');
      }
      const d = await res.json();
      setData(d);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please refresh.');
    } finally {
      setLoading(false);
    }
  }

  function toggleChapter(chapterId) {
    setExpandedChapters(prev => ({ ...prev, [chapterId]: !prev[chapterId] }));
  }

  if (loading) {
    return (
      <div className="ac-status">
        <span className="ac-loading-text">Loading chapters...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ac-status ac-status--error">
        <span className="ac-error-text">{error}</span>
        <button onClick={fetchData} className="ac-retry-btn">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="ac-page">
      {/* Header */}
      <div className="ac-header">
        <button onClick={() => navigate('/lobby')} className="ac-back-btn">
          ← Lobby
        </button>
        <h1 className="ac-title">
          All Chapters — {data?.paper}
        </h1>
      </div>

      {/* Chapter list */}
      <div className="ac-list">
        {(data?.chapters || []).map(chapter => {
          const isExpanded = !!expandedChapters[chapter.chapter_id];
          const completedCount = chapter.objectives.filter(o => o.completed).length;
          const totalCount = chapter.objectives.length;

          return (
            <div
              key={chapter.chapter_id}
              className={`ac-chapter${chapter.locked ? ' ac-chapter--locked' : ''}`}
            >
              {/* Chapter header row */}
              <div
                onClick={() => !chapter.locked && toggleChapter(chapter.chapter_id)}
                className="ac-chapter-header"
              >
                <div className="ac-chapter-left">
                  {chapter.locked ? (
                    <span className="ac-chapter-icon" title="Locked">🔒</span>
                  ) : chapter.quiz_passed ? (
                    <span className="ac-chapter-icon" title="Quiz passed">✅</span>
                  ) : (
                    <span className="ac-chapter-count">
                      {completedCount}/{totalCount}
                    </span>
                  )}
                  <div>
                    <div className="ac-chapter-name">
                      Chapter {chapter.chapter_num} — {chapter.label || chapter.title || `Chapter ${chapter.chapter_num}`}
                    </div>
                    {chapter.locked && (
                      <div className="ac-chapter-hint">
                        Complete previous chapter quiz to unlock
                      </div>
                    )}
                  </div>
                </div>

                <div className="ac-chapter-right">
                  {chapter.quiz_score !== null && (
                    <span className={`ac-quiz-pill ${chapter.quiz_passed ? 'ac-quiz-pill--passed' : 'ac-quiz-pill--failed'}`}>
                      Quiz: {chapter.quiz_score}%
                    </span>
                  )}
                  {!chapter.locked && (
                    <span className="ac-chapter-caret">
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  )}
                </div>
              </div>

              {/* Objectives accordion */}
              {isExpanded && !chapter.locked && (
                <div className="ac-obj-list">
                  {chapter.objectives.map(obj => (
                    <div
                      key={obj.lesson_code}
                      onClick={() => !obj.locked && navigate(`/lesson/${obj.lesson_code}`)}
                      className={`ac-obj-row${obj.locked ? ' ac-obj-row--locked' : ''}`}
                    >
                      <span className="ac-obj-icon">
                        {obj.locked ? '🔒' : obj.completed ? '✅' : '○'}
                      </span>
                      <div className="ac-obj-text">
                        <span className={`ac-obj-title${obj.locked ? ' ac-obj-title--locked' : ''}`}>
                          {obj.title}
                        </span>
                        <span className="ac-obj-code">
                          {obj.lesson_code}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
