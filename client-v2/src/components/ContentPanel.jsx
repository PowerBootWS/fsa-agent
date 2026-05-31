// fsa-agent/client-v2/src/components/ContentPanel.jsx
import { useEffect, useState } from 'react';
import { InlineMath, BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css';
import { useAudio } from '../hooks/useAudio';
import { useNarrationSync } from '../hooks/useNarrationSync';

// Render a text segment with math and **bold** support.
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

// Parses body text into seed sentence(s) + bullet lines.
// Seed sentences are non-bullet lines before the first bullet.
// Bullets start with - / • / *.
function BodyContent({ body, imageUrl }) {
  if (!body && !imageUrl) return null;

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

  return (
    <div className="body-content">
      {(seedText || imageUrl) && (
        <div className="slide-header">
          {seedText && (
            <p className="slide-seed">{renderInline(seedText, 'seed')}</p>
          )}
          {imageUrl && (
            <img className="slide-image" src={imageUrl} alt="" />
          )}
        </div>
      )}
      {bulletLines.length > 0 && (
        <ul className="slide-bullets">
          {bulletLines.map((line, i) => (
            <li key={i}>{renderInline(line, `b${i}`)}</li>
          ))}
        </ul>
      )}
    </div>
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

  useEffect(() => {
    setSectionStartTime(Date.now());
  }, [section?.slide_number]);

  useEffect(() => {
    if (autoPlay && section?.audio_url && !muted) {
      play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section?.slide_number]);

  if (!section) return null;

  return (
    <div className="content-panel">
      <div className="content-scroll">
        <h2 className="section-title">{section.title}</h2>
        <BodyContent body={section.body} imageUrl={section.image_url} />
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
