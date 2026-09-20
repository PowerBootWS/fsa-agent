import { useState, useEffect } from 'react';
import { ContentPanel } from './ContentPanel';

// Inline lesson player for the exam-results accordion. Plays slides + narration
// audio for a single objective, using the real ContentPanel (no AI tutor panel).
// Decoupled from course state: no progress written, no gating. The container
// shrink-wraps its content: .content-scroll renders at full height (no inner
// scroll) so the whole slide is visible, and the card grows to contain the
// scroll section, audio controls and nav. See the .inline-lesson-player
// overrides in index.css.
export function InlineLessonPlayer({ lessonCode, startSlide = null }) {
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
        const secs = data.sections || [];
        setSections(secs);
        // Open at the slide that teaches the missed answer, not at slide 1.
        // Objectives run a median of 26 slides and up to 101, so landing at the
        // top meant hunting for the relevant part. startSlide is null for
        // questions with no earliest_slide recorded — those still open at 1.
        //
        // startSlide is a slide_number, NOT an array index, and the two are not
        // interchangeable: slide_number starts at 0 for only 571 of the 1400
        // lessons — 466 start at 1 and 363 start higher still (2B3-2-6 runs
        // 3..50 across 48 chunks). So find the section by its slide_number
        // rather than indexing with it, and take the first slide at or past the
        // target so a gap in the numbering cannot miss.
        if (Number.isInteger(startSlide) && secs.length > 0) {
          const found = secs.findIndex(sec => (sec.slide_number ?? -1) >= startSlide);
          setIdx(found === -1 ? 0 : found);
        }
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [lessonCode, startSlide]);

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
