// Section boundaries for the v2 lesson player — backlog #102.
const { isTeachingSlide } = require('./questionSlideMapping');

//
// Checkpoints used to fire purely on slide count (CHECKPOINT_INTERVAL = 4 in
// LessonPlayer.jsx), so the pause landed wherever the counter happened to be —
// four slides into a six-slide explanation as often as at the end of one.
//
// Slides already carry a section `title`, and consecutive slides sharing one
// are a single taught idea. The end of such a run is the natural place to stop
// and practise. The player already forces a checkpoint on
// `checkpoint_after === true`, so deriving it here means no client code moves —
// which matters, because client-v2 still has no test runner (backlog #68) and
// this is student-facing.

/**
 * Set `checkpoint_after` on the last slide of each consecutive same-title run.
 *
 * Rules that are deliberate rather than incidental:
 * - An authored `checkpoint_after === true` always wins. The column is NULL on
 *   all 27,286 rows today, but populating it from fsa-lesson-creator should
 *   override this derivation rather than fight it.
 * - The final slide is never marked: the lesson ends there, and the completion
 *   screen is not a pause to practise.
 * - The title and intro slides never end a section. They each carry their own
 *   title, so the naive rule made them boundaries and stopped the student for
 *   practice twice before anything had been taught — the bug this fixes,
 *   reintroduced by the fix. Caught in live verification, not by the tests.
 * - A lesson whose slides share one title (or have none) gets no boundaries at
 *   all, leaving the player's interval as the fallback. That is the intended
 *   degradation — better a fixed interval than a lesson with no checkpoints.
 *
 * @param {Array<{slide_number:number, title:?string, checkpoint_after:?boolean}>} sections
 * @returns {Array} the same rows with `checkpoint_after` set to a boolean
 */
function markSectionBoundaries(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return sections || [];

  const sectionKey = (row) => (row && row.title ? String(row.title).trim() : '');

  return sections.map((row, i) => {
    const authored = row.checkpoint_after === true;
    const isLast = i === sections.length - 1;
    const endsRun = !isLast && sectionKey(row) !== sectionKey(sections[i + 1]);
    // An untitled run is not a section, so it never ends one.
    const derived = endsRun && sectionKey(row) !== '' && isTeachingSlide(row);
    return { ...row, checkpoint_after: authored || derived };
  });
}

module.exports = { markSectionBoundaries };
