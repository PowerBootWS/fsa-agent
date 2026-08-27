/**
 * Backlog #102 — placing a question at the first slide that teaches it.
 *
 * The first matcher I tried looked excellent (84.7% of the bank placed) and was
 * wrong: intro slides preview the whole lesson, so every topic matched slide 0
 * or 1 and `sensible_heat_calculation` came out answerable before anything had
 * been taught. Excluding intro/title slides drops coverage to ~64% and makes
 * the placements correct, which is the trade that matters — a wrong placement
 * is worse than an absent one, because absent means "unrestricted" and merely
 * preserves today's behaviour.
 */
const {
  significantTokens,
  isTeachingSlide,
  placeQuestion,
} = require('../src/services/questionSlideMapping');

const slide = (slide_number, title, body = '', chunk_type = 'principle') =>
  ({ slide_number, title, body, narration: '', chunk_type });

describe('significantTokens', () => {
  it('splits a topic slug into matchable words', () => {
    expect(significantTokens('sensible_heat_calculation'))
      .toEqual(['sensible', 'heat', 'calculation']);
  });

  it('drops short and filler words that match everything', () => {
    expect(significantTokens('power_vs_energy')).toEqual(['power', 'energy']);
    expect(significantTokens('heat_and_the_work')).toEqual(['heat', 'work']);
  });

  it('is empty for a topic with nothing usable', () => {
    expect(significantTokens('the_and_vs')).toEqual([]);
    expect(significantTokens(null)).toEqual([]);
  });
});

describe('isTeachingSlide', () => {
  it('rejects the title and intro slides', () => {
    // These preview the whole lesson, so they match every topic and would
    // place every question at slide 0.
    expect(isTeachingSlide(slide(0, 'Objective 1', '', 'title'))).toBe(false);
    expect(isTeachingSlide(slide(1, 'Introduction', '', 'intro'))).toBe(false);
  });

  it('rejects slides 0 and 1 even when chunk_type is missing', () => {
    // chunk_type is NULL on 14,688 of 27,286 rows, so it cannot be the only guard.
    expect(isTeachingSlide(slide(0, 'Objective 1', '', null))).toBe(false);
    expect(isTeachingSlide(slide(1, 'Introduction', '', null))).toBe(false);
  });

  it('accepts a real teaching slide', () => {
    expect(isTeachingSlide(slide(2, 'Energy Forms and Conversion'))).toBe(true);
    expect(isTeachingSlide(slide(5, 'Heat Absorption Formula', '', null))).toBe(true);
  });
});

describe('placeQuestion', () => {
  const LESSON = [
    slide(0, 'Objective 1', '', 'title'),
    slide(1, 'Introduction', 'Heat calculations are critical for sizing thermal equipment', 'intro'),
    slide(2, 'Energy Forms and Conversion', 'Energy is the capacity to do work'),
    slide(3, 'Energy Forms and Conversion', 'Kinetic energy'),
    slide(6, 'Power and Energy Measurement', 'Power measures how fast work is done'),
    slide(12, 'Heat and Temperature Basics', 'Sensible heat causes a temperature change'),
    slide(15, 'Heat Required to Warm Water', 'Sensible heat equation for temperature change'),
    slide(25, 'Heat Quantity and Mixture Specific Heat', 'mixture specific heat capacity'),
  ];

  it('places a question at the section whose title names its topic', () => {
    expect(placeQuestion('energy_forms', LESSON).slide).toBe(2);
    expect(placeQuestion('power_vs_energy', LESSON).slide).toBe(6);
    expect(placeQuestion('mixture_specific_heat', LESSON).slide).toBe(25);
  });

  it('prefers a section title over a passing mention in a body', () => {
    // "Heat calculations" appears in the intro body; the titled section wins.
    expect(placeQuestion('sensible_heat_calculation', LESSON).slide).toBeGreaterThan(1);
  });

  it('never places a question on the intro, whatever it mentions', () => {
    const placed = placeQuestion('sensible_heat_calculation', LESSON);
    expect(placed.slide).not.toBe(0);
    expect(placed.slide).not.toBe(1);
  });

  it('returns null rather than guessing when nothing matches', () => {
    // Unplaced means unrestricted, which is today's behaviour — safe.
    expect(placeQuestion('boiler_mountings_inspection', LESSON)).toBeNull();
    expect(placeQuestion('', LESSON)).toBeNull();
  });

  it('breaks a score tie by taking the earliest slide', () => {
    const twice = [
      slide(4, 'Specific Heat'),
      slide(9, 'Specific Heat'),
    ];
    expect(placeQuestion('specific_heat', twice).slide).toBe(4);
  });

  it('reports how confident the placement is', () => {
    const strong = placeQuestion('energy_forms', LESSON);
    const weak = placeQuestion('sensible_heat_calculation', LESSON);
    expect(strong.matchedTitleTokens).toBe(2);
    expect(weak.matchedTitleTokens).toBeLessThan(3);
  });

  it('handles a lesson with no teaching slides', () => {
    expect(placeQuestion('energy_forms', [slide(0, 'Objective 1', '', 'title')])).toBeNull();
    expect(placeQuestion('energy_forms', [])).toBeNull();
  });
});
