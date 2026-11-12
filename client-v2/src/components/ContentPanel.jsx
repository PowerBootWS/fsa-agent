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

// A body is paragraphs (consecutive plain lines, joined) and bullet lists, in
// the order written. Every non-empty line is shown: plain lines after a bullet
// used to be dropped, which hid text a mini lesson's checks had verified.
export function parseBody(body) {
  const blocks = [];
  for (const raw of (body || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-•*]\s/.test(line);
    const type = bullet ? 'bullets' : 'text';
    const text = bullet ? line.replace(/^[-•*]\s*/, '') : line;
    const last = blocks[blocks.length - 1];
    if (last && last.type === type) last.lines.push(text);
    else blocks.push({ type, lines: [text] });
  }
  return blocks;
}

export function BodyContent({ body, imageUrl, chunkType }) {
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

  const blocks = parseBody(body);
  const isLatex = chunkType === 'formula';

  return (
    <div className="body-content">
      {imageUrl && !isLatex && <img className="slide-image" src={imageUrl} alt="" />}
      {blocks.map((b, k) => (b.type === 'text' ? (
        <p key={k} className="slide-seed">{renderInline(b.lines.join(' '), `seed${k}`)}</p>
      ) : (
        <ul key={k} className="slide-bullets">
          {b.lines.map((line, i) => (
            <li key={i}>{renderInline(line, `b${k}-${i}`)}</li>
          ))}
        </ul>
      )))}
      {imageUrl && isLatex && <img className="slide-image-latex" src={imageUrl} alt="" />}
    </div>
  );
}

// Phone control-bar icons. Inline SVG so they render the same on every
// platform (iOS turns a bare ▶ into a colour emoji).
function Icon({ children, fill = 'none' }) {
  return (
    <svg className="ctl-svg" viewBox="0 0 24 24" width="22" height="22" fill={fill}
      stroke={fill === 'none' ? 'currentColor' : 'none'} strokeWidth="2.25"
      strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden="true">
      {children}
    </svg>
  );
}
const BackIcon = () => <Icon><path d="M19 12H5M11 6l-6 6 6 6" /></Icon>;
const NextIcon = () => <Icon><path d="M5 12h14M13 6l6 6-6 6" /></Icon>;
const PlayIcon = () => <Icon fill="currentColor"><path d="M8 5.5v13l10.5-6.5z" /></Icon>;
const PauseIcon = () => <Icon fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1" /><rect x="13.5" y="5" width="4" height="14" rx="1" /></Icon>;
const SpeakerIcon = () => <Icon><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></Icon>;
const SpeakerOffIcon = () => <Icon><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></Icon>;

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
  lastSlideLabel = 'Finish Objective →',
  lastSlideShortLabel = 'Finish',
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
  const nextLabel = isLastSlide ? lastSlideLabel : 'Next →';
  // Accessible name: the visible label without its arrow. Phones show an icon
  // (or the short last-slide label) instead of the text.
  const nextName = isLastSlide ? lastSlideLabel.replace(/\s*→\s*$/, '') : 'Next';

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

          {/* Desktop: .player-controls is display:contents, so the audio row and
              the nav bar lay out exactly as before. Phones (<=768px): it becomes
              one compact bar pinned to the bottom of the player, icon-only
              buttons, the slide content scrolling above it (index.css). */}
          <div className={`player-controls${isLastSlide ? ' player-controls--last' : ''}`}>
            <div className="audio-controls">
              {section?.audio_url && (
                <button
                  className="play-btn"
                  aria-label={playing ? 'Pause narration' : 'Play narration'}
                  onClick={() => {
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
                  }}
                >
                  <span className="ctl-text" aria-hidden="true">{playing ? '⏸ Pause' : '▶ Play'}</span>
                  <span className="ctl-icon" aria-hidden="true">{playing ? <PauseIcon /> : <PlayIcon />}</span>
                </button>
              )}
              {section?.audio_url && (
                <label className="toggle-label speed-control">
                  <span className="ctl-text">Speed</span>
                  <select
                    aria-label="Speed"
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
                  <span className="ctl-text">Autoplay</span>
                  <span className="ctl-icon ctl-pill" aria-hidden="true">Auto</span>
                </label>
              )}
              <label className="toggle-label mute-control">
                <input type="checkbox" checked={muted} onChange={toggleMute} />
                <span className="ctl-text">Mute audio</span>
                <span className="ctl-icon" aria-hidden="true">{muted ? <SpeakerOffIcon /> : <SpeakerIcon />}</span>
              </label>
              {onAsk && (
                <button className="ask-tutor-btn" onClick={onAsk}>💬 Ask about this slide</button>
              )}
              {onExercise && (
                <button className="ask-tutor-btn exercise-tutor-btn" onClick={onExercise}>✏️ Quick exercise</button>
              )}
            </div>

            <div className="nav-bar">
              <button className="nav-back" aria-label="Back" onClick={onBack} disabled={sectionIndex === 0}>
                <span className="ctl-text" aria-hidden="true">← Back</span>
                <span className="ctl-icon" aria-hidden="true"><BackIcon /></span>
              </button>
              <span className="nav-counter">
                {sectionIndex + 1} of {totalSections}
              </span>
              <button className="nav-next" aria-label={nextName} onClick={onNext}>
                <span className="ctl-text" aria-hidden="true">{nextLabel}</span>
                {isLastSlide ? (
                  <span className="ctl-icon ctl-icon--text" aria-hidden="true">{lastSlideShortLabel}<NextIcon /></span>
                ) : (
                  <span className="ctl-icon" aria-hidden="true"><NextIcon /></span>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
