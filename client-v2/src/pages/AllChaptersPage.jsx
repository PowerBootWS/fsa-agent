import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const COLORS = {
  bg: '#0D1117',
  card: '#1C2333',
  border: '#252F42',
  text: '#F4F5F7',
  muted: '#a8b4c0',
  primary: '#E8720C',
  success: '#52A882',
  danger: '#f87171',
  locked: '#141A24',
};

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
      <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: COLORS.muted }}>Loading chapters...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.text, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <span style={{ color: COLORS.danger }}>{error}</span>
        <button onClick={fetchData} style={{ background: COLORS.primary, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer' }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.text }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', background: COLORS.card, borderBottom: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={() => navigate('/lobby')}
          style={{ background: 'none', border: 'none', color: COLORS.muted, cursor: 'pointer', fontSize: 14, padding: 0 }}
        >
          ← Lobby
        </button>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: COLORS.text }}>
          All Chapters — {data?.paper}
        </h1>
      </div>

      {/* Chapter list */}
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(data?.chapters || []).map(chapter => {
          const isExpanded = !!expandedChapters[chapter.chapter_id];
          const completedCount = chapter.objectives.filter(o => o.completed).length;
          const totalCount = chapter.objectives.length;

          return (
            <div
              key={chapter.chapter_id}
              style={{
                background: chapter.locked ? COLORS.locked : COLORS.card,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                overflow: 'hidden',
                opacity: chapter.locked ? 0.65 : 1,
              }}
            >
              {/* Chapter header row */}
              <div
                onClick={() => !chapter.locked && toggleChapter(chapter.chapter_id)}
                style={{
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: chapter.locked ? 'default' : 'pointer',
                  userSelect: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                  {chapter.locked ? (
                    <span style={{ fontSize: 16 }} title="Locked">🔒</span>
                  ) : chapter.quiz_passed ? (
                    <span style={{ fontSize: 16 }} title="Quiz passed">✅</span>
                  ) : (
                    <span style={{ fontSize: 13, color: COLORS.muted, minWidth: 20, textAlign: 'center' }}>
                      {completedCount}/{totalCount}
                    </span>
                  )}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15, color: COLORS.text }}>
                      Chapter {chapter.chapter_num} — {chapter.label || chapter.title || `Chapter ${chapter.chapter_num}`}
                    </div>
                    {chapter.locked && (
                      <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
                        Complete previous chapter quiz to unlock
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {chapter.quiz_score !== null && (
                    <span style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '3px 8px',
                      borderRadius: 12,
                      background: chapter.quiz_passed ? '#14532d' : '#7f1d1d',
                      color: chapter.quiz_passed ? '#86efac' : '#fca5a5',
                    }}>
                      Quiz: {chapter.quiz_score}%
                    </span>
                  )}
                  {!chapter.locked && (
                    <span style={{ color: COLORS.muted, fontSize: 12 }}>
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  )}
                </div>
              </div>

              {/* Objectives accordion */}
              {isExpanded && !chapter.locked && (
                <div style={{ borderTop: `1px solid ${COLORS.border}`, padding: '8px 0' }}>
                  {chapter.objectives.map(obj => (
                    <div
                      key={obj.lesson_code}
                      onClick={() => !obj.locked && navigate(`/lesson/${obj.lesson_code}`)}
                      style={{
                        padding: '10px 18px 10px 44px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        cursor: obj.locked ? 'default' : 'pointer',
                        opacity: obj.locked ? 0.5 : 1,
                        borderRadius: 4,
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => { if (!obj.locked) e.currentTarget.style.background = 'rgba(232,114,12,0.07)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={{ fontSize: 13, width: 16, textAlign: 'center', flexShrink: 0 }}>
                        {obj.locked ? '🔒' : obj.completed ? '✅' : '○'}
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 13, color: obj.locked ? COLORS.muted : COLORS.text }}>
                          {obj.title}
                        </span>
                        <span style={{ fontSize: 11, color: COLORS.muted }}>
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
