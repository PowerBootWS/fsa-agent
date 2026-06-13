// client-v2/src/components/ContentPanel.jsx
import { useEffect, useState } from 'react';
import { InlineMath, BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css';
import { useAudio } from '../hooks/useAudio';
import { useNarrationSync } from '../hooks/useNarrationSync';
import { NavigationHeader } from './NavigationHeader';
import { ObjectiveComplete } from './ObjectiveComplete';

function renderInline(text, keyPrefix) {
  const mathParts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return mathParts.flatMap((part, i) => {
    if (part.startsWith('$$') && part.endsWith('$$')) {
      return [<BlockMath key={`${keyPrefix}-m${i}`} math={part.slice(2, -2)} />];
    }
    if (part.startsWith('$') && part.endsWith('$')) {
      return [<InlineMath key={`${keyPrefix}-m${i}`} math={part.slice(1, -1)} />];
    }
    return part.split(/(\*\*[^*]+\*\*)/g).map((p, j) => {
      if (p.startsWith('**') && p.endsWith('**')) {
        return <strong key={`${keyPrefix}-b${i}-${j}`}>{p.slice(2, -2)}</strong>;
      }
      return <span key={`${keyPrefix}-b${i}-${j}`}>{p}</span>;
    });
  });
}

function BodyContent({ body, imageUrl, chunkType }) {
  if (!body && !imageUrl) {
    if (chunkType === 'title') {
      return (
        <div className="title-card">
          <p className="title-card-hint">Click <strong>Next →</strong> to begin this objective.</p>
        </div>
      );
    }
    return null;
  }

  const seedLines = [];
  const bulletLines = [];

  if (body) {
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (/^[-•*]\s/.test(line)) {
        bulletLines.push(line.replace(/^[-•*]\s*/, ''));
      } else if (bulletLines.length === 0) {
        seedLines.push(line);
      }
    }
  }

  const seedText = seedLines.join(' ');
  const isLatex = chunkType === 'formula';

  return (
    <div className="body-content">
      {imageUrl && !isLatex && <img className="slide-image" src={imageUrl} alt="" />}
      {seedText && <p className="slide-seed">{renderInline(seedText, 'seed')}</p>}
      {bulletLines.length > 0 && (
        <ul className="slide-bullets">
          {bulletLines.map((line, i) => (
            <li key={i}>{renderInline(line, `b${i}`)}</li>
          ))}
        </ul>
      )}
      {imageUrl && isLatex && <img className="slide-image-latex" src={imageUrl} alt="" />}
    </div>
  );
}

export function ContentPanel({
  section,
  sectionIndex,
  totalSections,
  autoPlay,
  onNext,
  onBack,
  courseOutline,
  activeLessonCode,
  onNavigate,
  prevChapter,
  nextChapter,
  nextLessonCode,
  isComplete,
  hideNarration = false,
}) {
  const [sectionStartTime, setSectionStartTime] = useState(() => Date.now());
  const { play, pause, playing, muted, toggleMute, currentTimeMs } = useAudio(
    section?.audio_url || null
  );
  const { visibleText } = useNarrationSync(
    section?.narration_timing || null,
    currentTimeMs,
    muted,
    sectionStartTime
  );

  useEffect(() => {
    setSectionStartTime(Date.now());
  }, [section?.slide_number]);

  useEffect(() => {
    if (autoPlay && section?.audio_url && !muted) {
      play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section?.slide_number]);

  if (!section && !isComplete) return null;

  const isLastSlide = !isComplete && sectionIndex === totalSections - 1;
  const nextLabel = isLastSlide ? 'Finish Objective →' : 'Next →';

  return (
    <div className="content-panel">
      {courseOutline && activeLessonCode && (
        <NavigationHeader
          courseOutline={courseOutline}
          activeLessonCode={activeLessonCode}
          onNavigate={onNavigate}
          prevChapter={prevChapter}
          nextChapter={nextChapter}
        />
      )}

      {isComplete ? (
        <ObjectiveComplete
          activeLessonCode={activeLessonCode}
          nextLessonCode={nextLessonCode}
          nextChapter={nextChapter}
          onContinue={() => onNavigate(nextLessonCode, 0)}
          onReview={() => onNavigate(activeLessonCode, 0)}
        />
      ) : (
        <>
          <div className="content-scroll">
            <h2 className="section-title">{section?.title}</h2>
            <BodyContent
              body={section?.body}
              imageUrl={section?.image_url}
              chunkType={section?.chunk_type}
            />
          </div>

          {!hideNarration && section?.narration_timing && (
            <div className="narration-box">{visibleText || ' '}</div>
          )}

          <div className="audio-controls">
            {section?.audio_url && (
              <button onClick={playing ? pause : play}>
                {playing ? '⏸ Pause' : '▶ Play'}
              </button>
            )}
            <label className="toggle-label">
              <input type="checkbox" checked={muted} onChange={toggleMute} />
              Mute audio
            </label>
          </div>

          <div className="nav-bar">
            <button onClick={onBack} disabled={sectionIndex === 0}>← Back</button>
            <span className="nav-counter">
              {sectionIndex + 1} of {totalSections}
            </span>
            <button onClick={onNext}>{nextLabel}</button>
          </div>
        </>
      )}
    </div>
  );
}
