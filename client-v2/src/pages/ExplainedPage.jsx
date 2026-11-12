import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ContentPanel } from '../components/ContentPanel';
import { StagedQuestion } from '../components/StagedQuestion';
import { MiniLessonPitch } from '../components/MiniLessonPitch';
import './ExplainedPage.css';

// Public mini lesson (no login, no tracking): slides -> practice -> soft pitch.
export default function ExplainedPage() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const preview = params.get('preview');
  const [lesson, setLesson] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | missing
  const [phase, setPhase] = useState('lesson'); // lesson | questions | pitch
  const [idx, setIdx] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [qIdx, setQIdx] = useState(0);
  const stepRef = useRef(null);

  useEffect(() => {
    let live = true;
    setStatus('loading');
    const url = `/api/explained/${encodeURIComponent(slug)}` +
      (preview ? `?preview=${encodeURIComponent(preview)}` : '');
    fetch(url)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('nf'))))
      .then(data => { if (live) { setLesson(data); setStatus('ready'); } })
      .catch(() => { if (live) setStatus('missing'); });
    return () => { live = false; };
  }, [slug, preview]);

  // Focus jumps inside StagedQuestion can leave the explanation off-screen on
  // a phone: bring the new question / pitch to the top.
  useEffect(() => {
    if (phase === 'lesson' || !stepRef.current) return;
    stepRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [phase, qIdx]);

  if (status === 'loading') return <main className="ex-page"><p className="ex-note">Loading lesson…</p></main>;
  if (status === 'missing' || !lesson) {
    return (
      <main className="ex-page">
        <p className="ex-note">This lesson isn't available.</p>
        <p className="ex-note"><a href="https://fullsteamahead.ca">fullsteamahead.ca</a></p>
      </main>
    );
  }

  const sections = lesson.sections || [];
  const questions = [...(lesson.questions || [])].sort((a, b) => a.position - b.position);
  const isLast = idx >= sections.length - 1;

  const goNext = () => {
    if (!isLast) {
      setIdx(i => i + 1);
      setAutoPlay(true);
    } else {
      setPhase(questions.length ? 'questions' : 'pitch');
    }
  };
  const goBack = () => {
    setIdx(i => Math.max(i - 1, 0));
    setAutoPlay(false);
  };
  const onQuestionDone = () => {
    if (qIdx + 1 < questions.length) setQIdx(qIdx + 1);
    else setPhase('pitch');
  };

  return (
    <main className="ex-page">
      <header className="ex-header">
        <img className="ex-logo" src="/pwa-192.png" alt="Full Steam Ahead" width="40" height="40" />
        <div className="ex-heading">
          <h1>{lesson.title}</h1>
          <p className="ex-source">{lesson.source_label}</p>
        </div>
      </header>

      {phase === 'lesson' && (
        <div className="ex-lesson">
          <ContentPanel
            section={sections[idx] || null}
            sectionIndex={idx}
            totalSections={sections.length}
            autoPlay={autoPlay}
            onNext={goNext}
            onBack={goBack}
            isComplete={false}
            hideNarration={true}
            lastSlideLabel={questions.length > 1 ? 'Practice questions →' : questions.length ? 'Practice question →' : 'Finish'}
          />
        </div>
      )}

      {phase === 'questions' && questions[qIdx] && (
        <div ref={stepRef} className="ex-questions">
          <StagedQuestion
            key={questions[qIdx].position}
            question={questions[qIdx]}
            number={qIdx + 1}
            total={questions.length}
            onDone={onQuestionDone}
          />
        </div>
      )}

      {phase === 'pitch' && (
        <div ref={stepRef}>
          <MiniLessonPitch classCode={lesson.class_code} slug={lesson.slug || slug} paperCode={lesson.paper_code} />
        </div>
      )}
    </main>
  );
}
