import { useState, useEffect } from 'react';
import { ContentPanel } from './ContentPanel';

// Inline lesson player for the exam-results accordion. Plays slides + narration
// audio for a single objective, using the real ContentPanel (no AI tutor panel).
// Decoupled from course state: no progress written, no gating. The container
// shrink-wraps its content: .content-scroll renders at full height (no inner
// scroll) so the whole slide is visible, and the card grows to contain the
// scroll section, audio controls and nav. See the .inline-lesson-player
// overrides in index.css.
export function InlineLessonPlayer({ lessonCode }) {
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
    <div className="inline-lesson-player" style={{
      marginTop: '12px',
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
        hideNarration={true}
      />
    </div>
  );
}
