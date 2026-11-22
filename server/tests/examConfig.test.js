const { sanitizeExamConfig } = require('../src/services/examConfig');

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
