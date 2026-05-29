// fsa-agent/client-v2/src/components/ContentPanel.jsx
import { useEffect, useState } from 'react';
import { InlineMath, BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css';
import { useAudio } from '../hooks/useAudio';
import { useNarrationSync } from '../hooks/useNarrationSync';

/**
 * Render body text, replacing $$...$$ and $...$ with KaTeX components.
 */
function MathContent({ text }) {
  if (!text) return null;
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('$$') && part.endsWith('$$')) {
          return <BlockMath key={i} math={part.slice(2, -2)} />;
        }
        if (part.startsWith('$') && part.endsWith('$')) {
          return <InlineMath key={i} math={part.slice(1, -1)} />;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/**
 * ContentPanel — left 60% of the lesson player.
 *
 * Props:
 *   section        — { title, body, image_url, audio_url, narration_timing, slide_number }
 *   sectionIndex   — 0-based current index
 *   totalSections  — total section count
 *   autoPlay       — true when navigating forward, false when going back
 *   onNext         — () => void
 *   onBack         — () => void
 */
export function ContentPanel({ section, sectionIndex, totalSections, autoPlay, onNext, onBack }) {
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

  // Reset start time when section changes
  useEffect(() => {
    setSectionStartTime(Date.now());
  }, [section?.slide_number]);

  // Auto-play on forward navigation only
  useEffect(() => {
    if (autoPlay && section?.audio_url && !muted) {
      play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section?.slide_number]);

  if (!section) return null;

  return (
    <div className="content-panel">
      <h2 className="section-title">{section.title}</h2>

      {section.image_url && (
        <img
          className="section-image"
          src={section.image_url}
          alt={section.title}
        />
      )}

      <div className="section-body">
        <MathContent text={section.body} />
      </div>

      {section.narration_timing && (
        <div className="narration-box">{visibleText || ' '}</div>
      )}

      <div className="audio-controls">
        {section.audio_url && (
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
        <button onClick={onNext} disabled={sectionIndex === totalSections - 1}>
          Next →
        </button>
      </div>
    </div>
  );
}
