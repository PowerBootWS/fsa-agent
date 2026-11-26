// Timed practice exam clock. A plain object kept in the exam's chat state so it survives the
// exam view re-mounting: { base: seconds already run, since: ms timestamp while running, null
// while paused }. Pauses never count toward the time taken.

export function startClock(now) {
  return { base: 0, since: now };
}

// A refreshed page picks the sitting back up from the clock at the last answer, paused, so
// the student restarts it when they are back at the desk.
export function resumedClock(elapsedSeconds) {
  return { base: elapsedSeconds, since: null };
}

export function clockElapsed(clock, now) {
  if (!clock) return 0;
  return clock.base + (clock.since === null ? 0 : Math.max(0, Math.floor((now - clock.since) / 1000)));
}

export function pauseClock(clock, now) {
  return { ...clock, base: clockElapsed(clock, now), since: null };
}

export function resumeClock(clock, now) {
  return clock.since === null ? { ...clock, since: now } : clock;
}

export function isPaused(clock) {
  return !!clock && clock.since === null;
}

// 9000 → "2 h 30 min", 2700 → "45 min", 30 → "1 min". Rounded to the minute.
export function fmtDuration(seconds) {
  const mins = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
