// Placing a practice question at the first slide that teaches it — backlog #102.
//
// Questions carry a `topic` slug (`sensible_heat_calculation`, `energy_forms`)
// on all 6,724 rows, and slides carry a section `title`. Matching one against
// the other places most of the bank without any authoring pass.
//
// THE TRAP, and why this module exists rather than a one-line SQL LIKE: the
// first matcher placed 84.7% of the bank and was wrong. Title and intro slides
// preview the whole lesson ("Heat calculations are critical for sizing and
// operating thermal equipment"), so every topic matched slide 0 or 1 and every
// question came out answerable immediately — the exact bug, with a
// reassuring coverage number on top. Restricting to teaching slides drops
// coverage to ~64% and makes the placements right.
//
// A wrong placement is worse than no placement: NULL means unrestricted, which
// is merely today's behaviour, while a wrong early number keeps serving
// unanswerable questions with the appearance of a fix.

// Words too short or too common to distinguish one section from another.
const FILLER = new Set([
  'with', 'from', 'that', 'this', 'and', 'the', 'into', 'over', 'when',
  'what', 'vs', 'for', 'per', 'its', 'are', 'was',
]);

// A section title naming the topic is a far stronger signal than the same word
// appearing somewhere in a body or narration, so title hits are weighted well
// clear of any plausible number of body hits.
const TITLE_WEIGHT = 10;

/** Matchable words from a topic slug, e.g. 'power_vs_energy' -> ['power','energy']. */
function significantTokens(topic) {
  if (!topic) return [];
  return String(topic)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 3 && !FILLER.has(t));
}

/**
 * Is this a slide that TEACHES, as opposed to announcing or previewing?
 *
 * Both guards are needed: `chunk_type` is NULL on 14,688 of 27,286 rows, so it
 * cannot be the only test, and slides 0-1 are the title and intro by
 * convention throughout the corpus.
 */
function isTeachingSlide(slide) {
  if (!slide) return false;
  const type = (slide.chunk_type || '').toLowerCase();
  if (type === 'title' || type === 'intro') return false;
  return Number(slide.slide_number) > 1;
}

function scoreSlide(tokens, slide) {
  const title = (slide.title || '').toLowerCase();
  const body = `${slide.body || ''} ${slide.narration || ''}`.toLowerCase();
  let titleHits = 0;
  let bodyHits = 0;
  for (const token of tokens) {
    if (title.includes(token)) titleHits += 1;
    else if (body.includes(token)) bodyHits += 1;
  }
  return { score: titleHits * TITLE_WEIGHT + bodyHits, titleHits };
}

/**
 * The earliest slide at which `topic` has been taught.
 *
 * @returns {{slide:number, score:number, matchedTitleTokens:number}|null}
 *          null when nothing matches — the caller must leave the question
 *          unrestricted rather than invent a number.
 */
function placeQuestion(topic, slides) {
  const tokens = significantTokens(topic);
  if (tokens.length === 0 || !Array.isArray(slides)) return null;

  let best = null;
  for (const slide of slides) {
    if (!isTeachingSlide(slide)) continue;
    const { score, titleHits } = scoreSlide(tokens, slide);
    if (score === 0) continue;
    // Strictly greater, so an equal score keeps the earlier slide.
    if (!best || score > best.score) {
      best = { slide: Number(slide.slide_number), score, matchedTitleTokens: titleHits };
    }
  }
  return best;
}

module.exports = { significantTokens, isTeachingSlide, scoreSlide, placeQuestion, TITLE_WEIGHT };
