// client-v2/src/components/ContentPanel.jsx
import { useEffect, useRef, useState } from 'react';
import { KatexSpan } from './MathContent';
import 'katex/dist/katex.min.css';
import { useAudio } from '../hooks/useAudio';
import { useNarrationSync } from '../hooks/useNarrationSync';
import { track } from '../utils/usage';
import { NavigationHeader } from './NavigationHeader';
import { ObjectiveComplete } from './ObjectiveComplete';

// Pause between the end of a slide's narration and the next slide under
// autoplay. Short on purpose: any longer and students think they need to click.
export const AUTO_ADVANCE_DELAY_MS = 1500;

function renderInline(text, keyPrefix) {
  const mathParts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return mathParts.flatMap((part, i) => {
    if (part.startsWith('$$') && part.endsWith('$$')) {
      return [<KatexSpan key={`${keyPrefix}-m${i}`} math={part.slice(2, -2)} displayMode />];
    }
    if (part.startsWith('$') && part.endsWith('$')) {
      return [<KatexSpan key={`${keyPrefix}-m${i}`} math={part.slice(1, -1)} displayMode={false} />];
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
  completedCodes,
  onToggleComplete,
  hideNarration = false,
  overlay = null,
  onAsk = null,
  onExercise = null,
  autoAdvance = false,
  onToggleAutoAdvance = null,
  holdAutoAdvance = false,
  practicePrompt = null,
}) {
  const [sectionStartTime, setSectionStartTime] = useState(() => Date.now());
  const { play, pause, playing, ended, muted, toggleMute, currentTimeMs, playbackRate, setPlaybackRate } = useAudio(
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
    if (autoPlay && section?.audio_url && !muted && !overlay) {
      play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section?.slide_number]);

  // A check-in card (lesson tutor redesign, slice 4) is shown in place of the
  // slide it arrived on. Hold that slide's narration while the card is up, and
  // start it when the student continues — otherwise the audio for a slide they
  // can't see plays under the card.
  // The card can also be opened mid-slide (from the practice-question prompt):
  // then it resumes only if the narration was playing when the card opened.
  const holdAudio = Boolean(overlay);
  const wasHeld = useRef(holdAudio);
  const resumeAfterHold = useRef(false);
  useEffect(() => {
    if (holdAudio) {
      resumeAfterHold.current = playing;
      pause();
    } else if (wasHeld.current && section?.audio_url && !muted
      && (resumeAfterHold.current || (autoPlay && currentTimeMs === 0 && !ended))) {
      play();
    }
    wasHeld.current = holdAudio;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdAudio]);

  // Autoplay: once a slide's narration finishes, move on by itself. Held while
  // a card or the tutor is open, and stops at the end-of-objective screen.
  const onNextRef = useRef(onNext);
  useEffect(() => { onNextRef.current = onNext; });
  useEffect(() => {
    if (!autoAdvance || !ended || holdAutoAdvance || overlay || isComplete) return undefined;
    const t = setTimeout(() => onNextRef.current?.(), AUTO_ADVANCE_DELAY_MS);
    return () => clearTimeout(t);
  }, [autoAdvance, ended, holdAutoAdvance, overlay, isComplete]);

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
          completedCodes={completedCodes}
          onToggleComplete={onToggleComplete}
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
      ) : overlay ? (
        <div className="content-scroll">{overlay}</div>
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

          {practicePrompt && <div className="practice-prompt-row">{practicePrompt}</div>}

          {!hideNarration && section?.narration_timing && (
            <div className="narration-box">{visibleText || ' '}</div>
          )}

          <div className="audio-controls">
            {section?.audio_url && (
              <button onClick={() => {
                if (playing) {
                  pause();
                  return;
                }
                // currentTimeMs is 0 only when this slide's audio hasn't
                // started yet — a nonzero value means the button is resuming
                // a paused position, which is not a "played" event.
                if (currentTimeMs === 0) {
                  track('feature_use', { action: 'lesson_audio_played', props: { lesson_code: activeLessonCode } });
                }
                play();
              }}>
                {playing ? '⏸ Pause' : '▶ Play'}
              </button>
            )}
            {section?.audio_url && (
              <label className="toggle-label speed-control">
                Speed
                <select
                  value={playbackRate}
                  onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                >
                  <option value={1}>1×</option>
                  <option value={1.25}>1.25×</option>
                  <option value={1.5}>1.5×</option>
                </select>
              </label>
            )}
            {onToggleAutoAdvance && (
              <label className="toggle-label autoplay-control">
                <input
                  type="checkbox"
                  checked={autoAdvance}
                  onChange={() => {
                    const on = !autoAdvance;
                    onToggleAutoAdvance(on);
                    // Turning it on mid-slide starts this slide's narration too.
                    if (on && !playing && !ended && currentTimeMs === 0 && section?.audio_url && !muted) play();
                  }}
                />
                Autoplay
              </label>
            )}
            <label className="toggle-label">
              <input type="checkbox" checked={muted} onChange={toggleMute} />
              Mute audio
            </label>
            {onAsk && (
              <button className="ask-tutor-btn" onClick={onAsk}>💬 Ask about this slide</button>
            )}
            {onExercise && (
              <button className="ask-tutor-btn exercise-tutor-btn" onClick={onExercise}>✏️ Quick exercise</button>
            )}
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
