// client-v2/src/LessonPlayer.jsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ContentPanel } from './components/ContentPanel';
import { TutorPanel } from './components/TutorPanel';
import { isFourthClassCode } from './utils/fourthClass';

const CHECKPOINT_INTERVAL = 4;

function parseCourseId(lessonCode) {
  return lessonCode ? lessonCode.split('-')[0] : null;
}

// Course code has no chapter/objective segments, e.g. "3A1" vs "3A1-1-3"
function isCourseCode(lessonCode) {
  return lessonCode ? lessonCode.split('-').length === 1 : false;
}

export function LessonPlayer({ lessonCode: initialLessonCode, learnerId, classCode }) {
  const courseId = parseCourseId(initialLessonCode);

  // 4th Class has no AI tutor chat (defense-in-depth — this route is never actually
  // reached by 4th Class students; see
  // docs/superpowers/specs/2026-07-13-fourth-class-platform-integration-design.md §5).
  const hideTutor = isFourthClassCode(classCode);

  // Mobile-only view toggle: the content + tutor panels sit side-by-side on
  // desktop, but stack to a single full-width panel on phones (CSS hides the
  // inactive one). Desktop ignores this entirely — the tab bar is display:none.
  const [mobileTab, setMobileTab] = useState('lesson');
  const [courseOutline, setCourseOutline] = useState(null);
  const [activeLessonCode, setActiveLessonCode] = useState(null);
  const [sections, setSections] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [checkpoint, setCheckpoint] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const sectionsSeenSinceCheckpoint = useRef(0);

  // One learner session per objective. This used to be created once, for the
  // lesson the player opened on, and kept as the student navigated — so the
  // asked-question log for lesson A accumulated question ids from B, C and D,
  // and the checkpoint picker ran out of questions it had never actually
  // shown for that lesson.
  useEffect(() => {
    if (!activeLessonCode || !learnerId) {
      setSessionId(null);
      return undefined;
    }
    let cancelled = false;
    fetch('/api/v2/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ learner_id: learnerId, lesson_code: activeLessonCode }),
    })
      .then(res => res.json())
      .then(data => { if (!cancelled) setSessionId(data.id || null); })
      .catch(() => { if (!cancelled) setSessionId(null); });
    return () => { cancelled = true; };
  }, [activeLessonCode, learnerId]);

  // Write progress (fire and forget — loss on network error is acceptable)
  const writeProgress = useCallback((lessonCode, slideIndex) => {
    if (!learnerId || !courseId) return;
    fetch(`/api/v2/progress/${encodeURIComponent(learnerId)}/${courseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        last_lesson_code: lessonCode,
        last_slide: slideIndex + 1,  // store 1-based
      }),
    }).catch(() => {});
  }, [learnerId, courseId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load: fetch outline + progress, resolve starting objective
  useEffect(() => {
    if (!initialLessonCode) return;
    setLoading(true);

    const isCourse = isCourseCode(initialLessonCode);

    const outlineFetch = fetch(`/api/v2/course/${courseId}/outline`).then(r => r.json());
    const progressFetch = isCourse && learnerId
      ? fetch(`/api/v2/progress/${encodeURIComponent(learnerId)}/${courseId}`).then(r => r.json())
      : Promise.resolve(null);
    const structureFetch = learnerId
      ? fetch(`/api/platform/course-structure/${courseId}`, { credentials: 'include' })
          .then(r => r.ok ? r.json() : null).catch(() => null)
      : Promise.resolve(null);

    Promise.all([outlineFetch, progressFetch, structureFetch])
      .then(async ([outline, progress, structure]) => {
        if (outline.error) throw new Error(outline.error);

        // Merge lock/completion state from gated structure into outline
        if (structure?.chapters) {
          const lockMap = new Map(structure.chapters.map(ch => [ch.chapter_num, ch]));
          for (const ch of outline.chapters || []) {
            const s = lockMap.get(ch.chapter_num);
            if (!s) continue;
            ch.locked = s.locked;
            const objMap = new Map((s.objectives || []).map(o => [o.lesson_code, o]));
            for (const obj of ch.objectives || []) {
              const so = objMap.get(obj.lesson_code);
              if (so) { obj.locked = so.locked; obj.completed = so.completed; }
            }
          }
        }

        setCourseOutline(outline);

        // Resolve starting lesson code and slide index
        let startCode, startSlide;
        if (isCourse) {
          startCode = progress?.last_lesson_code
            || outline.chapters[0]?.objectives[0]?.lesson_code;
          startSlide = progress?.last_slide ? progress.last_slide - 1 : 0;
        } else {
          startCode = initialLessonCode;
          startSlide = 0;
        }

        if (!startCode) throw new Error('No lessons found for this course');

        // Fetch sections for starting objective
        const secRes = await fetch(`/api/v2/lesson/${startCode}`);
        const secData = await secRes.json();
        if (secData.error) throw new Error(secData.error);
        const fetchedSections = secData.sections || [];

        const clamped = Math.max(0, Math.min(startSlide, fetchedSections.length - 1));
        setActiveLessonCode(startCode);
        setSections(fetchedSections);
        setSectionIndex(clamped);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate to a different objective
  const navigateTo = useCallback(async (lessonCode, slideIndex = 0) => {
    try {
      const res = await fetch(`/api/v2/lesson/${lessonCode}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const newSections = data.sections || [];
      const clamped = Math.max(0, Math.min(slideIndex, newSections.length - 1));
      setActiveLessonCode(lessonCode);
      setSections(newSections);
      setSectionIndex(clamped);
      setAutoPlay(false);
      setCheckpoint(null);
      sectionsSeenSinceCheckpoint.current = 0;
      writeProgress(lessonCode, clamped);
    } catch (err) {
      console.error('navigateTo error:', err);
    }
  }, [writeProgress]);

  // Derive navigation neighbours from the outline (pure computation, no state)
  const { prevLessonCode, nextLessonCode, prevChapter, nextChapter } = useMemo(() => {
    if (!courseOutline || !activeLessonCode) return {};
    const parts = activeLessonCode.split('-');
    const chapterNum = parseInt(parts[1], 10);
    const chapters = courseOutline.chapters || [];
    const chapterIdx = chapters.findIndex(c => c.chapter_num === chapterNum);
    const chapter = chapters[chapterIdx] || null;
    const objIdx = chapter ? chapter.objectives.findIndex(o => o.lesson_code === activeLessonCode) : -1;

    let prevCode = null;
    if (objIdx > 0) {
      prevCode = chapter.objectives[objIdx - 1].lesson_code;
    } else if (chapterIdx > 0) {
      const prevCh = chapters[chapterIdx - 1];
      prevCode = prevCh.objectives[prevCh.objectives.length - 1]?.lesson_code || null;
    }

    let nextCode = null;
    if (chapter && objIdx >= 0 && objIdx < chapter.objectives.length - 1) {
      nextCode = chapter.objectives[objIdx + 1].lesson_code;
    } else if (chapterIdx >= 0 && chapterIdx < chapters.length - 1) {
      nextCode = chapters[chapterIdx + 1].objectives[0]?.lesson_code || null;
    }

    return {
      prevLessonCode: prevCode,
      nextLessonCode: nextCode,
      prevChapter: chapterIdx > 0 ? chapters[chapterIdx - 1] : null,
      nextChapter: chapterIdx >= 0 && chapterIdx < chapters.length - 1 ? chapters[chapterIdx + 1] : null,
    };
  }, [courseOutline, activeLessonCode]);

  // Pull the next practice question for a lesson pause. Nothing is shown when
  // the lesson has no question to give — the tutor stays quiet rather than
  // announcing a question that isn't there.
  const triggerCheckpoint = useCallback(async () => {
    if (!sessionId || !activeLessonCode) return;
    try {
      const res = await fetch('/api/v2/checkpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, lesson_code: activeLessonCode }),
      });
      const data = await res.json();
      if (data?.question) setCheckpoint(data);
    } catch {
      // checkpoint failure is non-fatal
    }
  }, [sessionId, activeLessonCode]);

  function goNext() {
    // Last slide → show completion screen
    if (sectionIndex >= sections.length - 1) {
      setSectionIndex(sections.length);  // virtual "completion" index
      writeProgress(activeLessonCode, sections.length);
      return;
    }
    const next = sectionIndex + 1;
    setSectionIndex(next);
    setAutoPlay(true);
    setCheckpoint(null);
    sectionsSeenSinceCheckpoint.current += 1;
    writeProgress(activeLessonCode, next);

    if (sessionId) {
      fetch(`/api/v2/session/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_section: sections[next]?.slide_number }),
      }).catch(() => {});
    }

    const nextSection = sections[next];
    const forceCheckpoint = nextSection?.checkpoint_after === true;
    const intervalCheckpoint = sectionsSeenSinceCheckpoint.current >= CHECKPOINT_INTERVAL;
    if (forceCheckpoint || intervalCheckpoint) {
      triggerCheckpoint();
      sectionsSeenSinceCheckpoint.current = 0;
    }
  }

  function goBack() {
    if (sectionIndex <= 0) return;
    // From completion screen, go back to last slide; otherwise go to previous slide
    const prev = sectionIndex >= sections.length ? sections.length - 1 : sectionIndex - 1;
    setSectionIndex(prev);
    setAutoPlay(false);
    setCheckpoint(null);
    writeProgress(activeLessonCode, prev);
  }

  function handleAnswered(entry) {
    if (!sessionId) return;
    fetch(`/api/v2/session/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkpoint_entry: { ...entry, section: sectionIndex } }),
    }).catch(() => {});
  }

  if (error) return <div className="error">Error: {error}</div>;
  if (loading) return <div className="loading">Loading lesson…</div>;

  const isComplete = sectionIndex === sections.length;

  return (
    <div className={`lesson-player lesson-player--show-${mobileTab}${hideTutor ? ' lesson-player--tutor-hidden' : ''}`}>
      <div className="lesson-mobile-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={mobileTab === 'lesson'}
          className={mobileTab === 'lesson' ? 'active' : ''}
          onClick={() => setMobileTab('lesson')}
        >
          📖 Lesson
        </button>
        {!hideTutor && (
          <button
            role="tab"
            aria-selected={mobileTab === 'tutor'}
            className={mobileTab === 'tutor' ? 'active' : ''}
            onClick={() => setMobileTab('tutor')}
          >
            💬 AI Tutor
          </button>
        )}
      </div>
      <ContentPanel
        section={sections[sectionIndex] || null}
        sectionIndex={sectionIndex}
        totalSections={sections.length}
        autoPlay={autoPlay}
        onNext={goNext}
        onBack={goBack}
        courseOutline={courseOutline}
        activeLessonCode={activeLessonCode}
        onNavigate={navigateTo}
        prevChapter={prevChapter}
        nextChapter={nextChapter}
        nextLessonCode={nextLessonCode}
        isComplete={isComplete}
      />
      {!hideTutor && (
        <TutorPanel
          lessonCode={activeLessonCode}
          learnerId={learnerId || 'anonymous'}
          sectionIndex={sectionIndex}
          checkpoint={checkpoint}
          onAnswered={handleAnswered}
        />
      )}
    </div>
  );
}
