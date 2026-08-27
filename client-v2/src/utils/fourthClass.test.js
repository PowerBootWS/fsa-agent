// First test in client-v2. Backlog #68: this project had no test runner at all,
// which is why the 2026-08-12 audit left 21 unchecked fetch sites alone rather
// than change error paths in a live student-facing app with no way to verify.
//
// Note the argument is a subscription `class_code` (`fourth_a` / `fourth_b`),
// not a lesson code — every caller passes `user.class_code`. The name reads
// like it might take `4A-3-2` and it does not.
import { describe, it, expect } from 'vitest';
import { isFourthClassCode, FOURTH_CLASS_CODES } from './fourthClass';

describe('isFourthClassCode', () => {
  it('recognises both 4th Class subscription codes', () => {
    expect(isFourthClassCode('fourth_a')).toBe(true);
    expect(isFourthClassCode('fourth_b')).toBe(true);
  });

  it('rejects 2nd and 3rd Class subscriptions', () => {
    expect(isFourthClassCode('second')).toBe(false);
    expect(isFourthClassCode('third')).toBe(false);
  });

  it('rejects the bare "fourth" that predates the A/B split', () => {
    // 4th Class is sold as two independent papers; a single `fourth` code was
    // never implemented, and anything testing for it is wrong by construction.
    expect(isFourthClassCode('fourth')).toBe(false);
  });

  it('is safe on empty input', () => {
    expect(isFourthClassCode('')).toBe(false);
    expect(isFourthClassCode(null)).toBe(false);
    expect(isFourthClassCode(undefined)).toBe(false);
  });

  it('exports the codes it matches on', () => {
    expect(FOURTH_CLASS_CODES).toEqual(['fourth_a', 'fourth_b']);
  });
});
