// fsa-agent/client-v2/src/hooks/useNarrationSync.js
import { useMemo } from 'react';

const DEFAULT_WPM = 150;
const MS_PER_WORD = Math.round((60 / DEFAULT_WPM) * 1000);

/**
 * Given narration timing data and the current audio position (ms),
 * returns the narration text with words revealed up to the current time.
 *
 * When muted=true, advances at DEFAULT_WPM based on elapsed wall-clock time
 * from sectionStartTime.
 *
 * narrationTiming: [{word, offset_ms, duration_ms}] | null
 * currentTimeMs: number (from useAudio hook)
 * muted: boolean
 * sectionStartTime: number (Date.now() when section loaded)
 */
export function useNarrationSync(narrationTiming, currentTimeMs, muted, sectionStartTime) {
  const words = useMemo(
    () => (narrationTiming || []).map(t => t.word),
    [narrationTiming]
  );

  const revealedCount = useMemo(() => {
    if (!narrationTiming || narrationTiming.length === 0) return 0;

    if (muted) {
      // Fallback: reveal at DEFAULT_WPM based on wall clock
      const elapsed = Date.now() - (sectionStartTime || Date.now());
      return Math.min(words.length, Math.floor(elapsed / MS_PER_WORD));
    }

    // Find last word whose offset_ms <= currentTimeMs
    let count = 0;
    for (let i = 0; i < narrationTiming.length; i++) {
      if (narrationTiming[i].offset_ms <= currentTimeMs) count = i + 1;
      else break;
    }
    return count;
  }, [narrationTiming, currentTimeMs, muted, sectionStartTime, words.length]);

  const visibleText = words.slice(0, revealedCount).join(' ');

  return { visibleText, totalWords: words.length, revealedCount };
}
