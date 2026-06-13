import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { InlineLessonPlayer } from '../components/InlineLessonPlayer';

// Grade thresholds
function getGrade(pct) {
  if (pct >= 85) return 'A';
  if (pct >= 70) return 'B';
  return 'C';
}

function GradeBadge({ grade }) {
  const colors = {
    A: { bg: 'rgba(82,168,130,0.18)', color: '#52A882' },
    B: { bg: 'rgba(245,166,35,0.15)', color: '#F5A623' },
    C: { bg: 'rgba(220,38,38,0.12)', color: '#f87171' },
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

function WeaknessCard({ chapter, openId, setOpenId }) {
  const isOpen = openId === chapter.chapter_id;
  const grade = getGrade(chapter.score);
  const missed = chapter.total != null && chapter.correct != null
    ? chapter.total - chapter.correct
    : null;

  return (
    <div style={{
      background: '#1C2333',
      border: '1px solid #252F42',
      borderRadius: '6px',
      padding: '16px',
      marginBottom: '12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ color: '#F4F5F7', fontWeight: 600 }}>{chapter.chapter_id}</span>
          <span style={{ color: '#666', fontSize: '13px', marginLeft: '10px' }}>
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
          background: '#E8720C',
          border: 'none',
          color: 'white',
          padding: '6px 14px',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '13px',
          fontFamily: 'inherit',
          transition: 'background 0.2s',
        }}
      >
        {isOpen ? '▲ Hide lesson' : '▶ Watch a lesson on this'}
      </button>
      {isOpen && <InlineLessonPlayer lessonCode={`${chapter.chapter_id}-1`} />}
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
      <div style={{ minHeight: '100vh', background: '#0D1117', padding: '48px', color: '#a8b4c0', textAlign: 'center', fontFamily: "'Barlow', -apple-system, sans-serif" }}>
        <p>No exam results found.</p>
        <button
          onClick={() => navigate('/lobby')}
          style={{ marginTop: '16px', background: '#E8720C', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit' }}
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
      height: '100vh',
      overflowY: 'auto',
      background: '#0D1117',
      color: '#F4F5F7',
      padding: '32px 24px',
      fontFamily: "'Barlow', -apple-system, sans-serif",
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
          <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '28px', fontWeight: 700, marginBottom: '8px', color: '#F4F5F7', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Practice Exam Results
          </h1>
          {date && (
            <p style={{ color: '#666', fontSize: '13px', marginBottom: '24px' }}>
              {new Date(date).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </p>
          )}

          {/* Overall score */}
          <div style={{
            background: '#1C2333',
            borderRadius: '4px',
            padding: '24px',
            marginBottom: '24px',
            border: '1px solid #252F42',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '48px', fontWeight: 800, color: overallGrade === 'A' ? '#52A882' : overallGrade === 'B' ? '#F5A623' : '#f87171' }}>
                {score}%
              </span>
              <GradeBadge grade={overallGrade} />
            </div>
            <p style={{ color: '#a8b4c0', margin: 0, fontSize: '15px' }}>
              {correct} / {total} questions correct
            </p>
          </div>

          {/* Chapter breakdown table */}
          {chapters.length > 0 && (
            <div style={{
              background: '#1C2333',
              borderRadius: '4px',
              padding: '20px',
              marginBottom: '24px',
              border: '1px solid #252F42',
            }}>
              <h3 style={{ fontFamily: "'Barlow Condensed', sans-serif", margin: '0 0 16px 0', fontSize: '13px', color: '#a8b4c0', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Chapter Breakdown
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #252F42' }}>
                    <th style={{ textAlign: 'left', padding: '8px 4px', color: '#666', fontSize: '13px', fontWeight: 600 }}>Chapter</th>
                    <th style={{ textAlign: 'left', padding: '8px 4px', color: '#666', fontSize: '13px', fontWeight: 600 }}>Score</th>
                    <th style={{ textAlign: 'left', padding: '8px 4px', color: '#666', fontSize: '13px', fontWeight: 600 }}>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {chapters.map(ch => (
                    <tr key={ch.chapter_id} style={{ borderBottom: '1px solid #252F42' }}>
                      <td style={{ padding: '10px 4px', color: '#F4F5F7', fontSize: '14px' }}>{ch.chapter_id}</td>
                      <td style={{ padding: '10px 4px', color: '#a8b4c0', fontSize: '14px' }}>{ch.score}%</td>
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
                background: '#E8720C',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '14px',
                fontFamily: 'inherit',
                transition: 'background 0.2s',
              }}
            >
              Start Next Attempt
            </button>
            <button
              onClick={() => navigate('/lobby')}
              style={{
                background: 'transparent',
                color: '#a8b4c0',
                border: '1px solid #252F42',
                padding: '12px 24px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontFamily: 'inherit',
              }}
            >
              ← Back to Lobby
            </button>
          </div>
        </div>

        {/* Right column — areas to improve */}
        <div>
          <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '22px', fontWeight: 700, marginBottom: '20px', color: '#F4F5F7', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Areas to Improve
          </h2>
          {weakChapters.length === 0 ? (
            <div style={{ background: '#1C2333', borderRadius: '4px', padding: '24px', border: '1px solid #252F42', textAlign: 'center' }}>
              <p style={{ color: '#52A882', fontWeight: 600, margin: 0 }}>All chapters are grade A — great work!</p>
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
