// Validation and normalisation for first-party usage events (backlog #113).
//
// Pure functions, no database access — the route owns the insert. Everything
// here is defensive: the payload comes from a browser, and a client left over
// from a previous deploy must never be able to make this throw or 4xx. An
// event that does not match the taxonomy is DROPPED and counted, never
// rejected, so a stale client degrades quietly instead of spraying errors.
const TAXONOMY = require('../config/usageTaxonomy.json');

const MAX_BATCH = 50;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SKEW_MS = 5 * 60 * 1000;
const MAX_PROPS_BYTES = 512;
const MAX_SESSION_ID_LEN = 64;

// The only prop keys any client call site actually sends (verified against
// track() call sites across client-v2/src). A key allowlist is the real
// guard here — a size cap alone still lets an authenticated student write
// ~1.9GB/day of arbitrary text across 200 batches/15min, retained 90 days,
// on disk shared with ~20 other businesses' containers.
const ALLOWED_PROP_KEYS = new Set([
  'lessonCode',
  'lesson_code',
  'lesson_id',
  'chapter_id',
  'paper',
  'job_id',
]);

// occurred_at is client-supplied. A device with a wrong clock would otherwise
// land events in the wrong day and quietly bend every report built on them.
function clampOccurredAt(at, receivedAt) {
  const parsed = typeof at === 'string' ? Date.parse(at) : NaN;
  if (!Number.isFinite(parsed)) return receivedAt;
  if (parsed > receivedAt.getTime() + MAX_SKEW_MS) return receivedAt;
  if (parsed < receivedAt.getTime() - MAX_AGE_MS) return receivedAt;
  return new Date(parsed);
}

function safeProps(props) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {};

  const filtered = {};
  for (const key of Object.keys(props)) {
    if (!ALLOWED_PROP_KEYS.has(key)) continue;
    const value = props[key];
    // Values are route params or ids — primitives only. An object, array or
    // function for an allowlisted key is dropped rather than stored.
    if (value !== null && (typeof value === 'object' || typeof value === 'function')) continue;
    filtered[key] = value;
  }

  try {
    // Backstop, not the primary guard — the allowlist above already rejects
    // arbitrary shape; this just caps how much text an allowlisted key can carry.
    if (Buffer.byteLength(JSON.stringify(filtered), 'utf8') > MAX_PROPS_BYTES) return {};
  } catch {
    return {}; // circular or otherwise unserialisable
  }
  return filtered;
}

function safeSessionId(id) {
  if (typeof id !== 'string' || !id || id.length > MAX_SESSION_ID_LEN) return null;
  return id;
}

function validateEvent(raw, receivedAt) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  let event_type;
  let screen = null;
  let action = null;

  if (raw.type === 'screen_view') {
    if (!TAXONOMY.screens.includes(raw.screen)) return null;
    event_type = 'screen_view';
    screen = raw.screen;
    // An action on a screen_view is meaningless; ignore it rather than reject.
  } else if (raw.type === 'feature_use') {
    if (!TAXONOMY.actions.includes(raw.action)) return null;
    event_type = 'feature_use';
    action = raw.action;
  } else {
    return null;
  }

  return {
    user_id: null, // filled by the route from the authenticated session
    event_type,
    screen,
    action,
    props: safeProps(raw.props),
    client_session_id: safeSessionId(raw.session_id),
    occurred_at: clampOccurredAt(raw.at, receivedAt),
  };
}

function validateBatch(events, receivedAt) {
  const rows = [];
  let dropped = 0;
  for (const raw of events) {
    const row = validateEvent(raw, receivedAt);
    if (row) rows.push(row);
    else dropped += 1;
  }
  return { rows, dropped };
}

module.exports = { MAX_BATCH, clampOccurredAt, validateBatch };
