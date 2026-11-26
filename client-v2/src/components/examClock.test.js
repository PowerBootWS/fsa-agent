import { describe, it, expect } from 'vitest';
import { startClock, resumedClock, clockElapsed, pauseClock, resumeClock, isPaused, fmtDuration } from './examClock';

describe('examClock', () => {
  it('counts running time and leaves pauses out', () => {
    let c = startClock(1_000_000);
    expect(clockElapsed(c, 1_030_000)).toBe(30);
    c = pauseClock(c, 1_030_000);
    expect(isPaused(c)).toBe(true);
    expect(clockElapsed(c, 1_900_000)).toBe(30);           // away 14 min: not counted
    c = resumeClock(c, 1_900_000);
    expect(clockElapsed(c, 1_935_000)).toBe(65);
  });

  it('resumes a refreshed sitting paused at the last answer', () => {
    const c = resumedClock(230);
    expect(isPaused(c)).toBe(true);
    expect(clockElapsed(c, 9_999_999)).toBe(230);
    expect(clockElapsed(resumeClock(c, 0), 10_000)).toBe(240);
  });

  it('formats durations in hours and minutes', () => {
    expect(fmtDuration(9000)).toBe('2 h 30 min');
    expect(fmtDuration(2700)).toBe('45 min');
    expect(fmtDuration(10800)).toBe('3 h');
    expect(fmtDuration(30)).toBe('1 min');
  });
});
