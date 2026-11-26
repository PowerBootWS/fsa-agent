const { sanitizeExamConfig, cleanElapsedSeconds } = require('../src/services/examConfig');

describe('sanitizeExamConfig', () => {
  it('passes nothing through when nothing was sent', () => {
    expect(sanitizeExamConfig(undefined)).toBeUndefined();
    expect(sanitizeExamConfig(null)).toBeUndefined();
  });

  it('keeps 50 and 100 and maps any other length to 50', () => {
    expect(sanitizeExamConfig({ count: 100, timed: true })).toEqual({ count: 100, timed: true });
    expect(sanitizeExamConfig({ count: '100' })).toEqual({ count: 100, timed: false });
    expect(sanitizeExamConfig({ count: 25 })).toEqual({ count: 50, timed: false });
    expect(sanitizeExamConfig({})).toEqual({ count: 50, timed: false });
  });

  it('drops lead_magnet and unknown keys for a course exam', () => {
    expect(sanitizeExamConfig({ count: 50, lead_magnet: true, first_name: 'X', x: 1 })).toEqual({ count: 50, timed: false });
  });

  it('forces lead_magnet on the free exam path', () => {
    expect(sanitizeExamConfig({ count: 100, timed: 'yes' }, { leadMagnet: true }))
      .toEqual({ count: 100, timed: false, lead_magnet: true });
  });
});

describe('cleanElapsedSeconds', () => {
  it('keeps a whole number of seconds up to a day', () => {
    expect(cleanElapsedSeconds(0)).toBe(0);
    expect(cleanElapsedSeconds(5400)).toBe(5400);
    expect(cleanElapsedSeconds(86400)).toBe(86400);
  });

  it('drops anything else', () => {
    for (const v of [undefined, null, -1, 1.5, 86401, '60', true, {}, NaN]) {
      expect(cleanElapsedSeconds(v)).toBeUndefined();
    }
  });
});
