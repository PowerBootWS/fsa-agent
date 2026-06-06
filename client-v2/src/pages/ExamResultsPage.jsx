import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// Grade thresholds
function getGrade(pct) {
  if (pct >= 85) return 'A';
  if (pct >= 70) return 'B';
  return 'C';
}

function GradeBadge({ grade }) {
  const colors = {
    A: { bg: '#166534', color: '#bbf7d0' },
    B: { bg: '#854d0e', color: '#fef08a' },
    C: { bg: '#991b1b', color: '#fecaca' },
  };
  const style = colors[grade] || colors.C;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: '12px',
      background: style.bg,
      color: style.color,
      fontWeight: 700,
      fontSize: '13px',
    }}>
      {grade}
    </span>
  );
}

// Inline lesson preview inside a weakness card
function LessonPreview({ chapterId }) {
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const lessonCode = `${chapterId}-1`;
    fetch(`/api/platform/lesson-preview/${lessonCode}`)
      .then(r => {
        if (!r.ok) throw new Error('Lesson not found');
        return r.json();
      })
      .then(data => { setLesson(data); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [chapterId]);

  if (loading) return <p style={{ color: '#94a3b8', fontSize: '14px' }}>Loading lesson…</p>;
  if (error) return <p style={{ color: '#f87171', fontSize: '14px' }}>Could not load lesson preview.</p>;

  return (
    <div style={{
      marginTop: '12px',
      padding: '12px',
      background: '#0f172a',
      borderRadius: '8px',
      border: '1px solid #1e293b',
    }}>
      <h4 style={{ color: '#e2e8f0', margin: '0 0 8px 0', fontSize: '14px' }}>
        {lesson.title}
      </h4>
      {lesson.summary && (
        <p style={{ color: '#94a3b8', fontSize: '13px', lineHeight: '1.6', margin: '0 0 8px 0' }}>
          {lesson.summary}
        </p>
      )}
      {lesson.narration_text && !lesson.summary && (
        <p style={{ color: '#94a3b8', fontSize: '13px', lineHeight: '1.6', margin: 0 }}>
          {lesson.narration_text.slice(0, 400)}{lesson.narration_text.length > 400 ? '…' : ''}
        </p>
      )}
      {lesson.key_points && Array.isArray(lesson.key_points) && lesson.key_points.length > 0 && (
        <ul style={{ color: '#94a3b8', fontSize: '13px', margin: '8px 0 0 0', paddingLeft: '18px' }}>
          {lesson.key_points.slice(0, 3).map((pt, i) => <li key={i}>{pt}</li>)}
        </ul>
      )}
    </div>
  );
}

function WeaknessCard({ chapter, openId, setOpenId }) {
  const isOpen = openId === chapter.chapter_id;
  const grade = getGrade(chapter.score);
  const missed = chapter.total != null && chapter.correct != null
    ? chapter.total - chapter.correct
    : null;

  return (
    <div style={{
      background: '#1e293b',
      border: '1px solid #334155',
      borderRadius: '10px',
      padding: '16px',
      marginBottom: '12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{chapter.chapter_id}</span>
          <span style={{ color: '#64748b', fontSize: '13px', marginLeft: '10px' }}>
            {chapter.score}%
            {missed != null ? ` · missed ${missed} question${missed !== 1 ? 's' : ''}` : ''}
          </span>
        </div>
        <GradeBadge grade={grade} />
      </div>
      <button
        onClick={() => setOpenId(isOpen ? null : chapter.chapter_id)}
        style={{
          marginTop: '10px',
          background: '#1d4ed8',
          border: 'none',
          color: 'white',
          padding: '6px 14px',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '13px',
        }}
      >
        {isOpen ? '▲ Hide lesson' : '▶ Watch a lesson on this'}
      </button>
      {isOpen && <LessonPreview chapterId={chapter.chapter_id} />}
    </div>
  );
}

export default function ExamResultsPage() {
  const navigate = useNavigate();
  const [results, setResults] = useState(null);
  const [openCardId, setOpenCardId] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('fsa_last_exam');
      if (raw) setResults(JSON.parse(raw));
    } catch (e) {
      console.error('Failed to read exam results:', e);
    }
  }, []);

  const handleStartNextAttempt = () => {
    localStorage.removeItem('fsa_last_exam');
    navigate('/lobby');
  };

  if (!results) {
    return (
      <div style={{ padding: '48px', color: '#94a3b8', textAlign: 'center' }}>
        <p>No exam results found.</p>
        <button
          onClick={() => navigate('/lobby')}
          style={{ marginTop: '16px', background: '#1d4ed8', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer' }}
        >
          ← Back to Lobby
        </button>
      </div>
    );
  }

  const { score, total, correct, chapters = [], date } = results;
  const overallGrade = getGrade(score);

  const weakChapters = chapters.filter(ch => getGrade(ch.score) !== 'A');

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0f172a',
      color: '#e2e8f0',
      padding: '32px 24px',
    }}>
      <div style={{
        maxWidth: '1100px',
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '32px',
        alignItems: 'start',
      }}>

        {/* Left column — overall results */}
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 700, marginBottom: '8px', color: '#f1f5f9' }}>
            Practice Exam Results
          </h1>
          {date && (
            <p style={{ color: '#64748b', fontSize: '13px', marginBottom: '24px' }}>
              {new Date(date).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </p>
          )}

          {/* Overall score */}
          <div style={{
            background: '#1e293b',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px',
            border: '1px solid #334155',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
              <span style={{ fontSize: '48px', fontWeight: 800, color: overallGrade === 'A' ? '#4ade80' : overallGrade === 'B' ? '#fbbf24' : '#f87171' }}>
                {score}%
              </span>
              <GradeBadge grade={overallGrade} />
            </div>
            <p style={{ color: '#94a3b8', margin: 0, fontSize: '15px' }}>
              {correct} / {total} questions correct
            </p>
          </div>

          {/* Chapter breakdown table */}
          {chapters.length > 0 && (
            <div style={{
              background: '#1e293b',
              borderRadius: '12px',
              padding: '20px',
              marginBottom: '24px',
              border: '1px solid #334155',
            }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Chapter Breakdown
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #334155' }}>
                    <th style={{ textAlign: 'left', padding: '8px 4px', color: '#64748b', fontSize: '13px', fontWeight: 600 }}>Chapter</th>
                    <th style={{ textAlign: 'left', padding: '8px 4px', color: '#64748b', fontSize: '13px', fontWeight: 600 }}>Score</th>
                    <th style={{ textAlign: 'left', padding: '8px 4px', color: '#64748b', fontSize: '13px', fontWeight: 600 }}>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {chapters.map(ch => (
                    <tr key={ch.chapter_id} style={{ borderBottom: '1px solid #1e293b' }}>
                      <td style={{ padding: '10px 4px', color: '#e2e8f0', fontSize: '14px' }}>{ch.chapter_id}</td>
                      <td style={{ padding: '10px 4px', color: '#94a3b8', fontSize: '14px' }}>{ch.score}%</td>
                      <td style={{ padding: '10px 4px' }}><GradeBadge grade={getGrade(ch.score)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={handleStartNextAttempt}
              style={{
                background: '#1d4ed8',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '14px',
              }}
            >
              Start Next Attempt
            </button>
            <button
              onClick={() => navigate('/lobby')}
              style={{
                background: 'transparent',
                color: '#94a3b8',
                border: '1px solid #334155',
                padding: '12px 24px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              ← Back to Lobby
            </button>
          </div>
        </div>

        {/* Right column — areas to improve */}
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '20px', color: '#f1f5f9' }}>
            Areas to Improve
          </h2>
          {weakChapters.length === 0 ? (
            <div style={{ background: '#1e293b', borderRadius: '12px', padding: '24px', border: '1px solid #334155', textAlign: 'center' }}>
              <p style={{ color: '#4ade80', fontWeight: 600, margin: 0 }}>All chapters are grade A — great work!</p>
            </div>
          ) : (
            weakChapters.map(ch => (
              <WeaknessCard
                key={ch.chapter_id}
                chapter={ch}
                openId={openCardId}
                setOpenId={setOpenCardId}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
