import { useState, useEffect } from 'react';
import { ContentPanel } from './ContentPanel';

// Inline lesson player for the exam-results accordion. Plays slides + narration
// audio for a single objective, using the real ContentPanel (no AI tutor panel).
// Decoupled from course state: no progress written, no gating. The host card
// gives this a bounded height so ContentPanel's own .content-scroll scrolls.
export function InlineLessonPlayer({ lessonCode, height = 460 }) {
  const [sections, setSections] = useState(null);
  const [idx, setIdx] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!lessonCode) return;
    setLoading(true);
    setIdx(0);
    fetch(`/api/v2/lesson/${lessonCode}`)
      .then(r => {
        if (!r.ok) throw new Error('Lesson not found');
        return r.json();
      })
      .then(data => {
        if (data.error) throw new Error(data.error);
        setSections(data.sections || []);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [lessonCode]);

  if (loading) return <p style={{ color: '#a8b4c0', fontSize: '14px', margin: '12px 0 0' }}>Loading lesson…</p>;
  if (error) return <p style={{ color: '#f87171', fontSize: '14px', margin: '12px 0 0' }}>Could not load lesson.</p>;
  if (!sections || sections.length === 0) return <p style={{ color: '#a8b4c0', fontSize: '14px', margin: '12px 0 0' }}>No lesson content available.</p>;

  const goNext = () => {
    setIdx(i => Math.min(i + 1, sections.length - 1));
    setAutoPlay(true);
  };
  const goBack = () => {
    setIdx(i => Math.max(i - 1, 0));
    setAutoPlay(false);
  };

  return (
    <div style={{
      marginTop: '12px',
      height: `${height}px`,
      display: 'flex',
      flexDirection: 'column',
      background: '#0D1117',
      borderRadius: '6px',
      border: '1px solid #252F42',
      overflow: 'hidden',
    }}>
      <ContentPanel
        section={sections[idx] || null}
        sectionIndex={idx}
        totalSections={sections.length}
        autoPlay={autoPlay}
        onNext={goNext}
        onBack={goBack}
        isComplete={false}
      />
    </div>
  );
}
