// fsa-agent/client-v2/src/LessonPlayer.jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { ContentPanel } from './components/ContentPanel';
import { TutorPanel } from './components/TutorPanel';

const CHECKPOINT_INTERVAL = 4; // trigger checkpoint every N sections by default

export function LessonPlayer({ lessonCode, learnerId }) {
  const [lesson, setLesson] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [checkpoint, setCheckpoint] = useState(null);
  const [error, setError] = useState(null);
  const sectionsSeenSinceCheckpoint = useRef(0);

  // Fetch lesson + create/resume session on mount
  useEffect(() => {
    if (!lessonCode) return;

    Promise.all([
      fetch(`/api/v2/lesson/${lessonCode}`).then(r => r.json()),
      fetch('/api/v2/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learner_id: learnerId || 'anonymous',
          lesson_code: lessonCode,
        }),
      }).then(r => r.json()),
    ])
      .then(([lessonData, sessionData]) => {
        if (lessonData.error) throw new Error(lessonData.error);
        setLesson(lessonData);
        setSessionId(sessionData.id);
        // Resume from last_section if set
        if (sessionData.last_section && lessonData.sections) {
          const idx = lessonData.sections.findIndex(
            s => s.slide_number === sessionData.last_section
          );
          if (idx > 0) setSectionIndex(idx);
        }
      })
      .catch(err => setError(err.message));
  }, [lessonCode, learnerId]);

  const sections = lesson?.sections || [];
  const currentSection = sections[sectionIndex] || null;

  const triggerCheckpoint = useCallback(async (coveredSections) => {
    if (!sessionId || !lessonCode) return;
    try {
      const res = await fetch('/api/v2/checkpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          lesson_code: lessonCode,
          sections_covered: coveredSections.map(s => ({ title: s.title, body: s.body })),
        }),
      });
      const data = await res.json();
      setCheckpoint(data);
    } catch {
      // Checkpoint failure is non-fatal — lesson continues
    }
  }, [sessionId, lessonCode]);

  function goNext() {
    if (sectionIndex >= sections.length - 1) return;
    const next = sectionIndex + 1;
    setSectionIndex(next);
    setAutoPlay(true);
    setCheckpoint(null);
    sectionsSeenSinceCheckpoint.current += 1;

    // Update session progress
    if (sessionId) {
      fetch(`/api/v2/session/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_section: sections[next]?.slide_number }),
      }).catch(() => {});
    }

    // Decide whether to trigger a checkpoint
    const nextSection = sections[next];
    const forceCheckpoint = nextSection?.checkpoint_after === true;
    const intervalCheckpoint = sectionsSeenSinceCheckpoint.current >= CHECKPOINT_INTERVAL;

    if (forceCheckpoint || intervalCheckpoint) {
      const start = Math.max(0, next - CHECKPOINT_INTERVAL);
      const covered = sections.slice(start, next);
      triggerCheckpoint(covered);
      sectionsSeenSinceCheckpoint.current = 0;
    }
  }

  function goBack() {
    if (sectionIndex <= 0) return;
    setSectionIndex(i => i - 1);
    setAutoPlay(false); // no auto-play when going back
    setCheckpoint(null);
  }

  function handleAnswered(entry) {
    if (!sessionId) return;
    fetch(`/api/v2/session/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checkpoint_entry: { ...entry, section: sectionIndex },
      }),
    }).catch(() => {});
  }

  if (error) return <div className="error">Error: {error}</div>;
  if (!lesson) return <div className="loading">Loading lesson…</div>;

  return (
    <div className="lesson-player">
      <ContentPanel
        section={currentSection}
        sectionIndex={sectionIndex}
        totalSections={sections.length}
        autoPlay={autoPlay}
        onNext={goNext}
        onBack={goBack}
      />
      <TutorPanel
        lessonCode={lessonCode}
        learnerId={learnerId || 'anonymous'}
        sectionIndex={sectionIndex}
        checkpoint={checkpoint}
        onAnswered={handleAnswered}
      />
    </div>
  );
}
