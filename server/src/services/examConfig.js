// The only exam settings a client may choose: length (50 or 100; 25 was removed with the
// leveled exams, 2026-11-22) and whether it is timed. lead_magnet is set by the free-exam
// route only, never taken from a client.
const LENGTHS = new Set([50, 100]);

function sanitizeExamConfig(raw, { leadMagnet = false } = {}) {
  if (!raw || typeof raw !== 'object') return undefined;
  const n = parseInt(raw.count, 10);
  const out = { count: LENGTHS.has(n) ? n : 50, timed: raw.timed === true };
  if (leadMagnet) out.lead_magnet = true;
  return out;
}

// Timed practice exam: the student's clock (pauses excluded) when they answered, in whole
// seconds. Anything else is dropped rather than forwarded.
function cleanElapsedSeconds(v) {
  return Number.isInteger(v) && v >= 0 && v <= 86400 ? v : undefined;
}

module.exports = { sanitizeExamConfig, cleanElapsedSeconds };
