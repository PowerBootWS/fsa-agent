/**
 * Backlog #102 — checkpoints fired every 4 slides regardless of content.
 *
 * `CHECKPOINT_INTERVAL = 4` in LessonPlayer.jsx counts slides, so on 2A2-1-1
 * the pause landed at slide 4 — mid-way through "Energy Forms and Conversion",
 * four conceptual slides in — and then served whatever question came next by
 * id, which was a sensible-heat calculation needing Q = m·c·ΔT from slide 15.
 *
 * The player already forces a checkpoint on `checkpoint_after === true`
 * (LessonPlayer.jsx:238) and already receives each chunk's `title`, so the
 * boundary is derived here on read and no client code moves. The column is NULL
 * on all 27,286 rows; an authored value always wins over the derivation.
 */
const { markSectionBoundaries } = require('../src/services/lessonSections');

const slide = (slide_number, title, chunk_type = 'principle', checkpoint_after = null) => ({
  slide_number, title, chunk_type, checkpoint_after,
});

describe('markSectionBoundaries', () => {
  it('marks the last slide of each section, not every fourth slide', () => {
    const marked = markSectionBoundaries([
      slide(2, 'Energy Forms and Conversion'),
      slide(3, 'Energy Forms and Conversion'),
      slide(4, 'Energy Forms and Conversion'),
      slide(5, 'Energy Forms and Conversion'),
      slide(6, 'Power and Energy Measurement'),
      slide(7, 'Power and Energy Measurement'),
      slide(8, 'Heat and Temperature Basics'),
      slide(9, 'Heat and Temperature Basics'),
    ]);
    expect(marked.filter(s => s.checkpoint_after).map(s => s.slide_number))
      .toEqual([5, 7]);
  });

  it('does not fire inside a section', () => {
    const marked = markSectionBoundaries([
      slide(2, 'Energy Forms and Conversion'),
      slide(3, 'Energy Forms and Conversion'),
      slide(4, 'Energy Forms and Conversion'),
      slide(5, 'Energy Forms and Conversion'),
    ]);
    expect(marked.find(s => s.slide_number === 4).checkpoint_after).toBe(false);
  });

  it('handles a one-slide section', () => {
    const marked = markSectionBoundaries([
      slide(2, 'Heat Absorption Formula'),
      slide(3, 'Worked Example'),
      slide(4, 'Summary'),
    ]);
    // The final slide is never marked — see below; the lesson ends there.
    expect(marked.map(s => s.checkpoint_after)).toEqual([true, true, false]);
  });

  it('treats a repeated title after a gap as a new section', () => {
    // Titles recur legitimately; only *consecutive* runs are one section.
    const marked = markSectionBoundaries([
      slide(2, 'Formula'), slide(3, 'Example'), slide(4, 'Formula'),
    ]);
    expect(marked.map(s => s.checkpoint_after)).toEqual([true, true, false]);
  });

  it('never marks the final slide — the lesson ends there anyway', () => {
    const marked = markSectionBoundaries([
      slide(2, 'A'), slide(3, 'B'), slide(4, 'B'),
    ]);
    expect(marked[marked.length - 1].checkpoint_after).toBe(false);
  });

  it('leaves an authored checkpoint_after alone', () => {
    const marked = markSectionBoundaries([
      { slide_number: 2, title: 'Energy Forms', chunk_type: 'principle', checkpoint_after: true },
      slide(3, 'Energy Forms'),
      slide(4, 'Energy Forms'),
    ]);
    expect(marked[0].checkpoint_after).toBe(true);
  });

  it('falls back to no boundaries when every slide shares one title', () => {
    // The interval of 4 in the player then remains the only mechanism, which
    // is the intended fallback rather than a lesson with zero checkpoints.
    const marked = markSectionBoundaries([
      slide(2, 'Lesson'), slide(3, 'Lesson'), slide(4, 'Lesson'), slide(5, 'Lesson'),
    ]);
    expect(marked.some(s => s.checkpoint_after)).toBe(false);
  });

  it('treats missing titles as one undifferentiated section', () => {
    const marked = markSectionBoundaries([
      slide(2, null), slide(3, null), slide(4, ''),
    ]);
    expect(marked.some(s => s.checkpoint_after)).toBe(false);
  });

  it('never fires on the title or intro slides', () => {
    // Caught in live verification: 2A2-1-1 derived checkpoints at slides 0 and
    // 1. Both end a "section" by the title test — "Objective 1" then
    // "Introduction" then the first real section — so a student was stopped for
    // practice twice before anything had been taught. Exactly the bug #102 is
    // about, reintroduced by the fix for it.
    const marked = markSectionBoundaries([
      slide(0, 'Objective 1', 'title'),
      slide(1, 'Introduction', 'intro'),
      slide(2, 'Energy Forms and Conversion'),
      slide(3, 'Energy Forms and Conversion'),
      slide(4, 'Power and Energy Measurement'),
      slide(5, 'Power and Energy Measurement'),
    ]);
    expect(marked.filter(s => s.checkpoint_after).map(s => s.slide_number)).toEqual([3]);
  });

  it('never fires on slides 0 and 1 even when chunk_type is missing', () => {
    // chunk_type is NULL on 14,688 of 27,286 rows, so it cannot be the only guard.
    const marked = markSectionBoundaries([
      slide(0, 'Objective 4'),
      slide(1, 'Introduction'),
      slide(2, 'Real Section'),
      slide(3, 'Another Section'),
      slide(4, 'Another Section'),
    ]);
    expect(marked.filter(s => s.checkpoint_after).map(s => s.slide_number)).toEqual([2]);
  });

  it('returns an empty array unchanged', () => {
    expect(markSectionBoundaries([])).toEqual([]);
  });
});
