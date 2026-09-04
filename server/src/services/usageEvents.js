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
const MAX_PROPS_BYTES = 2000;
const MAX_SESSION_ID_LEN = 64;

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
  try {
    if (Buffer.byteLength(JSON.stringify(props), 'utf8') > MAX_PROPS_BYTES) return {};
  } catch {
    return {}; // circular or otherwise unserialisable
  }
  return props;
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
