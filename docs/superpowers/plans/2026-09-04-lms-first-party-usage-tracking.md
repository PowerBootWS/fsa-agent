# LMS First-Party Usage Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the permanently CSP-blocked GA4 tag on `learn.fullsteamahead.ca` with first-party usage capture in `fsa-postgres`, surfaced in the daily brief and an admin page.

**Architecture:** A `usage_events` table records only what no existing table records — screen views and a short allowlist of feature interactions — written by batched client beacons to `POST /api/events` behind `requireAuth`. Everything already stored (questions answered, lessons, exams, saved jobs, tutor turns) is read from its own table at report time. Raw events are pruned to daily rollups after 90 days.

**Tech Stack:** Node 20 + Express 5 + `pg` (server), React 19 + Vite + react-router-dom (client-v2), jest + supertest (server tests), vitest + jsdom (client tests), Python 3 + psycopg2 (fsa-dashboard).

**Spec:** `docs/superpowers/specs/2026-09-04-lms-first-party-usage-tracking-design.md`

## Global Constraints

- **Governing rule:** *If a row already exists for it, it is not an event.* Never add an event type for something `question_responses`, `user_progress`, `practice_exam_attempts`, `saved_jobs`, `chat_history` or `credit_transactions` already records.
- **Do not modify the CSP.** `server/src/index.js` `scriptSrc` stays exactly `["'self'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://static.cloudflareinsights.com"]`. No `googletagmanager.com`, no nonce, no `'unsafe-inline'`.
- **Never store IP or user agent in `usage_events`.** `login_events` already holds both.
- **Server tests:** run with `npm test` from `fsa-agent/server` only. It sets `POSTGRES_DB=fsa_agent_test POSTGRES_HOST=localhost POSTGRES_PORT=5434`. `tests/testPool.js` throws at require time on any other database name. Never run the suite with production env vars sourced.
- **Client tests:** run with `npm test` from `fsa-agent/client-v2` (vitest, jsdom, globals enabled).
- **Route patterns, never raw paths**, in `usage_events.screen`.
- **`occurred_at` is client-supplied and untrusted** — clamp to `received_at` if older than 24h or more than 5 minutes in the future.
- **Telemetry never breaks the app.** Client-side failures are swallowed; server-side insert failures are logged and still answer 204.
- **Commits go to the sub-project's own repo.** Tasks 1–8 commit in `/home/debian/fsa-agent`; Task 9's collector commits in `/home/debian/fsa-dashboard`; Task 9's skill edit commits in `/home/debian` (the root FSA repo, which tracks `.claude/skills/`).
- Every commit message ends with `Claude-Session: https://claude.ai/code/session_01Ro1EMTMGEherJAf8x2PokQ`.

---

### Task 1: Schema and taxonomy config

**Files:**
- Create: `server/migrations/018_usage_events.sql`
- Create: `server/src/config/usageTaxonomy.json`
- Create: `client-v2/src/utils/usageTaxonomy.json`
- Test: `server/tests/usageEventsSchema.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `usage_events` and `usage_events_daily`; a taxonomy JSON of shape `{ "screens": string[], "actions": string[] }` present identically at both paths above.

- [ ] **Step 1: Write the migration**

Create `server/migrations/018_usage_events.sql`:

```sql
-- First-party LMS usage tracking (backlog #113).
--
-- learn.fullsteamahead.ca's helmet CSP (server/src/index.js, committed
-- 2026-04-16) predates its gtag snippet (client-v2/index.html, 2026-06-09) by
-- two months, so GA4 property G-LVH4ZMZJKV has never recorded a single event.
-- Owner decision 2026-09-04: do not loosen CSP on the authenticated app —
-- measure from this database instead.
--
-- This table holds ONLY what no other table records: screen views and a short
-- allowlist of feature interactions. Questions answered, lessons completed,
-- exams attempted, jobs saved and tutor turns each already have their own
-- table and are read from there at report time. If a row already exists for
-- it, it is not an event.
--
-- Deliberately NO ip_address and NO user_agent: login_events already stores
-- both, and IP is PIPEDA-relevant PII that should not be spread across a
-- second table.

CREATE TABLE IF NOT EXISTS usage_events (
  id                bigserial PRIMARY KEY,
  user_id           integer NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  event_type        text NOT NULL,
  -- Route PATTERN ('/lesson/:lessonCode'), never a raw path: raw paths are
  -- unbounded cardinality and bury content ids in a grouping column. The
  -- concrete lesson code lives in props.
  screen            text,
  action            text,
  props             jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Per-tab uuid from sessionStorage. One value = one visit.
  client_session_id text,
  -- Client-supplied and therefore untrusted; the API clamps it to received_at
  -- when it is older than 24h or more than 5 minutes in the future, so one
  -- device with a wrong clock cannot bend a day's numbers.
  occurred_at       timestamptz NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_occurred_idx ON usage_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_user_idx     ON usage_events (user_id, occurred_at DESC);

-- Rollup target for rows older than 90 days (see
-- server/src/scripts/prune_usage_events.js). screen/action default to '' rather
-- than NULL so the primary key actually constrains duplicates.
CREATE TABLE IF NOT EXISTS usage_events_daily (
  day         date    NOT NULL,
  event_type  text    NOT NULL,
  screen      text    NOT NULL DEFAULT '',
  action      text    NOT NULL DEFAULT '',
  event_count integer NOT NULL,
  user_count  integer NOT NULL,
  PRIMARY KEY (day, event_type, screen, action)
);
```

- [ ] **Step 2: Write the taxonomy config**

Create `server/src/config/usageTaxonomy.json`:

```json
{
  "screens": [
    "/select-paper",
    "/lobby",
    "/jobs",
    "/chapters",
    "/lesson/:lessonCode",
    "/practice-exam",
    "/exam/results",
    "/profile",
    "/credits"
  ],
  "actions": [
    "tutor_chat_opened",
    "lesson_audio_played",
    "results_lesson_expanded",
    "paper_switched",
    "tailoring_started",
    "job_detail_opened"
  ]
}
```

Copy the identical file to `client-v2/src/utils/usageTaxonomy.json`. Task 2 adds a test that fails if they ever drift.

The nine screens are the authenticated route patterns in `client-v2/src/App.jsx`. Deliberately absent: `/login`, `/signup`, `/setup`, `/forgot-password`, `/reset-password`, `/jobs/capture`, `/free-practice-exam` (all reachable without a session — out of scope), and `/admin/usage` (internal; would pollute its own numbers).

- [ ] **Step 3: Write the failing schema test**

Create `server/tests/usageEventsSchema.test.js`:

```js
const { pool } = require('./testPool');

async function columnsOf(table) {
  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return Object.fromEntries(rows.map((r) => [r.column_name, r]));
}

afterAll(async () => {
  await pool.end();
});

describe('018_usage_events schema', () => {
  it('creates usage_events with the expected columns', async () => {
    const cols = await columnsOf('usage_events');
    expect(Object.keys(cols).sort()).toEqual([
      'action', 'client_session_id', 'event_type', 'id', 'occurred_at',
      'props', 'received_at', 'screen', 'user_id',
    ]);
    expect(cols.user_id.is_nullable).toBe('NO');
    expect(cols.event_type.is_nullable).toBe('NO');
    expect(cols.occurred_at.data_type).toBe('timestamp with time zone');
    expect(cols.props.data_type).toBe('jsonb');
  });

  it('stores no IP or user agent — that is login_events’ job', async () => {
    const cols = await columnsOf('usage_events');
    expect(cols.ip_address).toBeUndefined();
    expect(cols.user_agent).toBeUndefined();
  });

  it('creates the rollup table with a usable primary key', async () => {
    const cols = await columnsOf('usage_events_daily');
    expect(Object.keys(cols).sort()).toEqual([
      'action', 'day', 'event_count', 'event_type', 'screen', 'user_count',
    ]);
    expect(cols.screen.is_nullable).toBe('NO');
    expect(cols.action.is_nullable).toBe('NO');
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

```bash
cd /home/debian/fsa-agent/server && npm test -- usageEventsSchema
```

Expected: FAIL — `usage_events` does not exist yet, so `Object.keys(cols)` is `[]`.

- [ ] **Step 5: Apply the migration to the test database**

```bash
docker cp /home/debian/fsa-agent/server/migrations/018_usage_events.sql fsa-postgres:/tmp/018.sql
docker exec fsa-postgres psql -U postgres -d fsa_agent_test -f /tmp/018.sql
```

Production and scratch are **not** touched here — that is Task 10 (deploy), after a backup.

- [ ] **Step 6: Run it and watch it pass**

```bash
cd /home/debian/fsa-agent/server && npm test -- usageEventsSchema
```

Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
cd /home/debian/fsa-agent
git add server/migrations/018_usage_events.sql server/src/config/usageTaxonomy.json \
        client-v2/src/utils/usageTaxonomy.json server/tests/usageEventsSchema.test.js
git commit -m "$(cat <<'EOF'
feat(usage): usage_events schema and event taxonomy

Backlog #113. Holds only what no other table records — screen views and
an allowlist of feature interactions. No IP, no user agent: login_events
already has both and IP is PIPEDA-relevant.

Claude-Session: https://claude.ai/code/session_01Ro1EMTMGEherJAf8x2PokQ
EOF
)"
```

---

### Task 2: Event validation service

**Files:**
- Create: `server/src/services/usageEvents.js`
- Test: `server/tests/usageEvents.test.js`

**Interfaces:**
- Consumes: `server/src/config/usageTaxonomy.json` from Task 1.
- Produces:
  - `MAX_BATCH` — number, `50`
  - `clampOccurredAt(at: string|undefined, receivedAt: Date) -> Date`
  - `validateBatch(events: unknown[], receivedAt: Date) -> { rows: Row[], dropped: number }` where `Row = { user_id: null, event_type: string, screen: string|null, action: string|null, props: object, client_session_id: string|null, occurred_at: Date }` (`user_id` is filled by the route, not here)

Pure functions with no database access, so this task's tests need no fixtures.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/usageEvents.test.js`:

```js
const fs = require('fs');
const path = require('path');
const { MAX_BATCH, clampOccurredAt, validateBatch } = require('../src/services/usageEvents');

const NOW = new Date('2026-09-04T12:00:00.000Z');

describe('clampOccurredAt', () => {
  it('keeps a sane timestamp', () => {
    const at = '2026-09-04T11:59:00.000Z';
    expect(clampOccurredAt(at, NOW).toISOString()).toBe(at);
  });

  it('clamps a timestamp from the future', () => {
    expect(clampOccurredAt('2026-09-04T12:30:00.000Z', NOW)).toEqual(NOW);
  });

  it('clamps a timestamp older than 24 hours', () => {
    expect(clampOccurredAt('2026-09-01T12:00:00.000Z', NOW)).toEqual(NOW);
  });

  it('falls back to received_at on garbage', () => {
    expect(clampOccurredAt('not a date', NOW)).toEqual(NOW);
    expect(clampOccurredAt(undefined, NOW)).toEqual(NOW);
  });
});

describe('validateBatch', () => {
  it('accepts an allowlisted screen_view and normalises it', () => {
    const { rows, dropped } = validateBatch(
      [{ type: 'screen_view', screen: '/lobby', props: { a: 1 }, session_id: 'sess-1', at: NOW.toISOString() }],
      NOW
    );
    expect(dropped).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_type: 'screen_view',
      screen: '/lobby',
      action: null,
      props: { a: 1 },
      client_session_id: 'sess-1',
    });
  });

  it('accepts an allowlisted feature_use', () => {
    const { rows } = validateBatch([{ type: 'feature_use', action: 'paper_switched', at: NOW.toISOString() }], NOW);
    expect(rows[0]).toMatchObject({ event_type: 'feature_use', action: 'paper_switched', screen: null });
  });

  it('drops an off-allowlist screen but keeps the rest of the batch', () => {
    const { rows, dropped } = validateBatch(
      [
        { type: 'screen_view', screen: '/login', at: NOW.toISOString() },
        { type: 'screen_view', screen: '/lobby', at: NOW.toISOString() },
      ],
      NOW
    );
    expect(dropped).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].screen).toBe('/lobby');
  });

  it('drops an unknown event type and an off-allowlist action', () => {
    const { rows, dropped } = validateBatch(
      [
        { type: 'rage_click', at: NOW.toISOString() },
        { type: 'feature_use', action: 'not_a_real_action', at: NOW.toISOString() },
      ],
      NOW
    );
    expect(rows).toHaveLength(0);
    expect(dropped).toBe(2);
  });

  it('drops non-objects and nulls without throwing', () => {
    const { rows, dropped } = validateBatch([null, 'nope', 42], NOW);
    expect(rows).toHaveLength(0);
    expect(dropped).toBe(3);
  });

  it('replaces a non-object or oversized props with an empty object', () => {
    const huge = { blob: 'x'.repeat(3000) };
    const { rows } = validateBatch(
      [
        { type: 'screen_view', screen: '/lobby', props: 'not-an-object', at: NOW.toISOString() },
        { type: 'screen_view', screen: '/lobby', props: huge, at: NOW.toISOString() },
      ],
      NOW
    );
    expect(rows[0].props).toEqual({});
    expect(rows[1].props).toEqual({});
  });

  it('rejects an over-long session id rather than storing it', () => {
    const { rows } = validateBatch(
      [{ type: 'screen_view', screen: '/lobby', session_id: 'x'.repeat(100), at: NOW.toISOString() }],
      NOW
    );
    expect(rows[0].client_session_id).toBeNull();
  });

  it('ignores an action sent alongside a screen_view', () => {
    const { rows } = validateBatch(
      [{ type: 'screen_view', screen: '/lobby', action: 'paper_switched', at: NOW.toISOString() }],
      NOW
    );
    expect(rows[0].action).toBeNull();
  });
});

describe('taxonomy parity', () => {
  it('server and client taxonomies are identical', () => {
    const server = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/config/usageTaxonomy.json'), 'utf8'));
    const client = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../client-v2/src/utils/usageTaxonomy.json'), 'utf8')
    );
    expect(client).toEqual(server);
  });
});

describe('MAX_BATCH', () => {
  it('is 50', () => {
    expect(MAX_BATCH).toBe(50);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /home/debian/fsa-agent/server && npm test -- usageEvents.test
```

Expected: FAIL — `Cannot find module '../src/services/usageEvents'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/services/usageEvents.js`:

```js
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
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /home/debian/fsa-agent/server && npm test -- usageEvents.test
```

Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/debian/fsa-agent
git add server/src/services/usageEvents.js server/tests/usageEvents.test.js
git commit -m "$(cat <<'EOF'
feat(usage): event validation, clamping and taxonomy parity test

Off-allowlist events are dropped and counted, never 4xx'd — a stale
client after a deploy must degrade quietly rather than spray errors.

Claude-Session: https://claude.ai/code/session_01Ro1EMTMGEherJAf8x2PokQ
EOF
)"
```

---

### Task 3: The `POST /api/events` endpoint

**Files:**
- Create: `server/src/routes/events.js`
- Modify: `server/src/index.js` (limiter definition ~line 58; mounts ~line 110)
- Test: `server/tests/events.test.js`

**Interfaces:**
- Consumes: `validateBatch`, `MAX_BATCH` from Task 2; `pool` from `server/src/services/database.js`.
- Produces: `POST /api/events` accepting `{ events: [...] }`, answering `204` on success and `400` on a malformed envelope.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/events.test.js`:

```js
const request = require('supertest');
const express = require('express');
const { pool } = require('./testPool');
const eventsRouter = require('../src/routes/events');

// A stand-in for requireAuth: the real middleware needs a session cookie and a
// platform_users row. What this route cares about is req.user.id, so the test
// app injects one directly and the auth middleware is tested in auth.test.js.
function buildTestApp(user) {
  const app = express();
  app.use(express.json());
  app.use('/api/events', (req, res, next) => {
    if (user) req.user = user;
    next();
  }, eventsRouter);
  return app;
}

let userId;

beforeAll(async () => {
  const { rows } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash)
     VALUES ('usage-events-test@test.example', 'Usage', 'Test', 'x')
     RETURNING id`
  );
  userId = rows[0].id;
});

afterAll(async () => {
  // Scoped to this test's own fixture — never a bare DELETE FROM (2026-08-12).
  await pool.query('DELETE FROM usage_events WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM platform_users WHERE id = $1', [userId]);
  await pool.end();
});

afterEach(async () => {
  await pool.query('DELETE FROM usage_events WHERE user_id = $1', [userId]);
});

describe('POST /api/events', () => {
  it('401s without an authenticated user', async () => {
    const res = await request(buildTestApp(null))
      .post('/api/events')
      .send({ events: [{ type: 'screen_view', screen: '/lobby' }] });
    expect(res.status).toBe(401);
  });

  it('inserts a valid batch against the authenticated user and returns 204', async () => {
    const res = await request(buildTestApp({ id: userId }))
      .post('/api/events')
      .send({
        events: [
          { type: 'screen_view', screen: '/lobby', session_id: 's1', at: new Date().toISOString() },
          { type: 'feature_use', action: 'paper_switched', session_id: 's1', at: new Date().toISOString() },
        ],
      });
    expect(res.status).toBe(204);

    const { rows } = await pool.query(
      'SELECT event_type, screen, action, client_session_id FROM usage_events WHERE user_id = $1 ORDER BY id',
      [userId]
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ event_type: 'screen_view', screen: '/lobby', action: null, client_session_id: 's1' });
    expect(rows[1]).toMatchObject({ event_type: 'feature_use', action: 'paper_switched', screen: null });
  });

  it('ignores a client-supplied user_id and uses the session owner', async () => {
    await request(buildTestApp({ id: userId }))
      .post('/api/events')
      .send({ events: [{ type: 'screen_view', screen: '/lobby', user_id: 999999 }] });

    const { rows } = await pool.query('SELECT user_id FROM usage_events WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(1);
  });

  it('drops off-allowlist events, keeps the rest, and still answers 204', async () => {
    const res = await request(buildTestApp({ id: userId }))
      .post('/api/events')
      .send({
        events: [
          { type: 'screen_view', screen: '/login' },
          { type: 'screen_view', screen: '/lobby' },
          { type: 'rage_click' },
        ],
      });
    expect(res.status).toBe(204);

    const { rows } = await pool.query('SELECT screen FROM usage_events WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].screen).toBe('/lobby');
  });

  it('400s a batch larger than 50', async () => {
    const events = Array.from({ length: 51 }, () => ({ type: 'screen_view', screen: '/lobby' }));
    const res = await request(buildTestApp({ id: userId })).post('/api/events').send({ events });
    expect(res.status).toBe(400);
  });

  it('400s a malformed envelope', async () => {
    const res = await request(buildTestApp({ id: userId })).post('/api/events').send({ events: 'nope' });
    expect(res.status).toBe(400);
  });

  it('204s an empty batch without inserting anything', async () => {
    const res = await request(buildTestApp({ id: userId })).post('/api/events').send({ events: [] });
    expect(res.status).toBe(204);
    const { rows } = await pool.query('SELECT 1 FROM usage_events WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(0);
  });

  it('clamps a wildly future occurred_at to received_at', async () => {
    await request(buildTestApp({ id: userId }))
      .post('/api/events')
      .send({ events: [{ type: 'screen_view', screen: '/lobby', at: '2030-01-01T00:00:00.000Z' }] });

    const { rows } = await pool.query(
      'SELECT occurred_at, received_at FROM usage_events WHERE user_id = $1',
      [userId]
    );
    const drift = Math.abs(new Date(rows[0].occurred_at) - new Date(rows[0].received_at));
    expect(drift).toBeLessThan(2000); // clamped to received_at, not stored as 2030
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /home/debian/fsa-agent/server && npm test -- events.test
```

Expected: FAIL — `Cannot find module '../src/routes/events'`.

- [ ] **Step 3: Write the route**

Create `server/src/routes/events.js`:

```js
const express = require('express');
const router = express.Router();
const { pool } = require('../services/database');
const { MAX_BATCH, validateBatch } = require('../services/usageEvents');

const COLUMNS = ['user_id', 'event_type', 'screen', 'action', 'props', 'client_session_id', 'occurred_at'];

// POST /api/events — batched first-party usage beacons (backlog #113).
//
// Mounted behind requireAuth but deliberately NOT requireActiveSubscription:
// how a lapsed subscriber behaves in the weeks before they leave is exactly
// the thing worth being able to see.
router.post('/', async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const events = req.body?.events;
  if (!Array.isArray(events)) {
    return res.status(400).json({ error: 'events must be an array' });
  }
  if (events.length > MAX_BATCH) {
    return res.status(400).json({ error: `at most ${MAX_BATCH} events per batch` });
  }

  const { rows, dropped } = validateBatch(events, new Date());
  if (dropped > 0) {
    console.warn(`[usage] dropped ${dropped} off-allowlist event(s) from user ${userId}`);
  }

  if (rows.length > 0) {
    const params = [];
    const tuples = rows.map((row, i) => {
      const base = i * COLUMNS.length;
      params.push(userId, row.event_type, row.screen, row.action, row.props, row.client_session_id, row.occurred_at);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });

    try {
      await pool.query(
        `INSERT INTO usage_events (${COLUMNS.join(', ')}) VALUES ${tuples.join(', ')}`,
        params
      );
    } catch (err) {
      // Telemetry must never be a source of client-visible failure or of retry
      // storms. Log loudly, answer 204: the client swallows errors anyway, and
      // a 5xx here would only turn a database blip into a beacon flood.
      console.error('[usage] insert failed:', err);
    }
  }

  res.status(204).end();
});

module.exports = router;
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /home/debian/fsa-agent/server && npm test -- events.test
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Mount the route and wire the rate limiters**

In `server/src/index.js`, immediately after the existing `limiter` definition, add:

```js
// Usage beacons flush every ~10s per open tab, so they must not share the
// 300-per-15-min budget the product's own API calls draw on — a student with
// two tabs open could otherwise rate-limit themselves out of the app with
// telemetry. Two changes make that safe, and BOTH are required:
//   1. the global limiter skips /api/events (see its `skip` below), and
//   2. this dedicated limiter is mounted FIRST, so a flood of beacons is
//      capped here rather than reaching the router.
// Same class of ordering concern as the requireLearnHost fix of 2026-08-16.
const eventsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
});
```

Add `skip` to the existing global limiter:

```js
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // limit each IP to 300 API requests per windowMs
  // /api/events has its own, separately-tuned limiter mounted ahead of this
  // one. Without this skip, telemetry would eat the product's budget.
  skip: (req) => req.path === '/events',
});
```

Then, in the mount block, put the beacon limiter **before** `app.use('/api', limiter)`:

```js
app.use('/api/events', eventsLimiter);
app.use('/api', limiter);
```

and mount the router alongside the other authenticated routers:

```js
const eventsRouter = require('./routes/events');
app.use('/api/events', requireAuth, eventsRouter);
```

- [ ] **Step 6: Verify the whole server suite still passes**

```bash
cd /home/debian/fsa-agent/server && npm test
```

Expected: PASS. Note the three files that drive the app's own pool unguarded (`apiNotFound.test.js`, `jobsCaptureStash.test.js`, `papersForClass.test.js`) — if any of them newly fails, stop and investigate rather than pressing on.

- [ ] **Step 7: Commit**

```bash
cd /home/debian/fsa-agent
git add server/src/routes/events.js server/src/index.js server/tests/events.test.js
git commit -m "$(cat <<'EOF'
feat(usage): POST /api/events with a dedicated rate limiter

Behind requireAuth but not requireActiveSubscription — a lapsed
subscriber's behaviour before they leave is the point. Beacons get their
own limiter mounted ahead of the global one, which now skips /events, so
telemetry can't eat a student's 300-per-15-min API budget.

Claude-Session: https://claude.ai/code/session_01Ro1EMTMGEherJAf8x2PokQ
EOF
)"
```

---

### Task 4: Client event queue and transport

**Files:**
- Create: `client-v2/src/utils/usage.js`
- Test: `client-v2/src/utils/usage.test.js`

**Interfaces:**
- Consumes: `client-v2/src/utils/usageTaxonomy.json` (Task 1), `postJson` from `client-v2/src/utils/api.js`.
- Produces:
  - `track(type: 'screen_view'|'feature_use', opts?: { screen?: string, action?: string, props?: object }) -> void`
  - `flush({ beacon = false } = {}) -> Promise<void>`
  - `startUsageFlushing() -> () => void` (installs timer + unload listeners, returns a teardown)
  - `__resetForTests() -> void`

- [ ] **Step 1: Write the failing tests**

Create `client-v2/src/utils/usage.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { track, flush, startUsageFlushing, __resetForTests } from './usage';

beforeEach(() => {
  __resetForTests();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('fsa_user', JSON.stringify({ email: 'a@test.example' }));
  global.fetch = vi.fn(() => Promise.resolve(new Response('', { status: 204 })));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('track', () => {
  it('queues nothing when the user is not logged in', async () => {
    localStorage.removeItem('fsa_user');
    track('screen_view', { screen: '/lobby' });
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('queues nothing for an off-allowlist screen', async () => {
    track('screen_view', { screen: '/login' });
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('queues nothing for an off-allowlist action', async () => {
    track('feature_use', { action: 'not_real' });
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends a queued screen_view on flush', async () => {
    track('screen_view', { screen: '/lobby', props: { x: 1 } });
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ type: 'screen_view', screen: '/lobby', props: { x: 1 } });
    expect(body.events[0].at).toBeTruthy();
  });

  it('reuses one session id across events and persists it in sessionStorage', async () => {
    track('screen_view', { screen: '/lobby' });
    track('screen_view', { screen: '/jobs' });
    await flush();
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.events[0].session_id).toBe(body.events[1].session_id);
    expect(sessionStorage.getItem('fsa_usage_session')).toBe(body.events[0].session_id);
  });

  it('never sends more than 50 events in one request', async () => {
    for (let i = 0; i < 60; i += 1) track('screen_view', { screen: '/lobby' });
    await flush();
    await flush();
    const first = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(first.events.length).toBeLessThanOrEqual(50);
  });
});

describe('flush', () => {
  it('does nothing on an empty queue', async () => {
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('never throws when the request fails', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('offline')));
    track('screen_view', { screen: '/lobby' });
    await expect(flush()).resolves.toBeUndefined();
  });

  it('uses sendBeacon when asked for one', async () => {
    const sendBeacon = vi.fn(() => true);
    navigator.sendBeacon = sendBeacon;
    track('screen_view', { screen: '/lobby' });
    await flush({ beacon: true });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe('/api/events');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to fetch when sendBeacon is unavailable', async () => {
    navigator.sendBeacon = undefined;
    track('screen_view', { screen: '/lobby' });
    await flush({ beacon: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('startUsageFlushing', () => {
  it('flushes on the timer and stops after teardown', async () => {
    vi.useFakeTimers();
    const stop = startUsageFlushing();
    track('screen_view', { screen: '/lobby' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    stop();
    track('screen_view', { screen: '/jobs' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('flushes with a beacon when the page is hidden', async () => {
    const sendBeacon = vi.fn(() => true);
    navigator.sendBeacon = sendBeacon;
    const stop = startUsageFlushing();
    track('screen_view', { screen: '/lobby' });

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    stop();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /home/debian/fsa-agent/client-v2 && npm test -- usage.test
```

Expected: FAIL — cannot resolve `./usage`.

- [ ] **Step 3: Write the implementation**

Create `client-v2/src/utils/usage.js`:

```js
/**
 * First-party usage beacons (backlog #113).
 *
 * learn.fullsteamahead.ca's CSP has blocked GA4 since before the tag was even
 * added, and the owner's decision was not to loosen CSP on the authenticated
 * app but to measure from our own database. This module is the client half.
 *
 * Two rules govern what belongs here:
 *   1. If a row already exists for it, it is not an event. Questions answered,
 *      lessons completed, exams and saved jobs all have their own tables and
 *      are read from there at report time.
 *   2. Telemetry never breaks the app. Every failure path here is swallowed.
 */
import taxonomy from './usageTaxonomy.json';
import { postJson } from './api';

const ENDPOINT = '/api/events';
const FLUSH_MS = 10000;
const MAX_BATCH = 50;

let queue = [];
let timer = null;

function isAuthenticated() {
  try {
    return Boolean(localStorage.getItem('fsa_user'));
  } catch {
    return false; // Safari private mode and friends
  }
}

function sessionId() {
  try {
    let id = sessionStorage.getItem('fsa_usage_session');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('fsa_usage_session', id);
    }
    return id;
  } catch {
    return null;
  }
}

export function track(type, { screen = null, action = null, props = {} } = {}) {
  if (!isAuthenticated()) return;
  if (type === 'screen_view' && !taxonomy.screens.includes(screen)) return;
  if (type === 'feature_use' && !taxonomy.actions.includes(action)) return;
  if (type !== 'screen_view' && type !== 'feature_use') return;

  queue.push({
    type,
    screen,
    action,
    props,
    session_id: sessionId(),
    at: new Date().toISOString(),
  });
}

export async function flush({ beacon = false } = {}) {
  if (queue.length === 0) return;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);
  const payload = JSON.stringify({ events: batch });

  // Transport split, deliberate. The timer flush goes through api.js per
  // backlog #68 ("one way to call the API"). The unload flush cannot: api.js
  // has no beacon path, and a normal fetch during pagehide is not guaranteed
  // to be sent. This is the one sanctioned exception to #68.
  if (beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
    } catch {
      /* telemetry never breaks the app */
    }
    return;
  }

  try {
    if (beacon) {
      await fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
    } else {
      await postJson(ENDPOINT, { events: batch });
    }
  } catch {
    /* dropped on the floor by design — never surface telemetry failure */
  }
}

export function startUsageFlushing() {
  timer = setInterval(() => {
    flush();
  }, FLUSH_MS);

  const onHide = () => {
    if (document.visibilityState === 'hidden') flush({ beacon: true });
  };
  const onPageHide = () => flush({ beacon: true });

  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);

  return () => {
    clearInterval(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onPageHide);
  };
}

export function __resetForTests() {
  queue = [];
  if (timer) clearInterval(timer);
  timer = null;
}

export default { track, flush, startUsageFlushing };
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /home/debian/fsa-agent/client-v2 && npm test -- usage.test
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/debian/fsa-agent
git add client-v2/src/utils/usage.js client-v2/src/utils/usage.test.js
git commit -m "$(cat <<'EOF'
feat(usage): client event queue with timer and beacon flushes

Timer flush goes through api.js per #68; the unload flush uses
sendBeacon directly, the one sanctioned exception, because a normal
fetch during pagehide is not guaranteed to be sent.

Claude-Session: https://claude.ai/code/session_01Ro1EMTMGEherJAf8x2PokQ
EOF
)"
```

---

### Task 5: Screen-view hook, App wiring, and GA4 removal

**Files:**
- Create: `client-v2/src/hooks/useScreenView.js`
- Modify: `client-v2/src/App.jsx`
- Modify: `client-v2/index.html:23-29` (delete the gtag block)
- Test: `client-v2/src/hooks/useScreenView.test.jsx`

**Interfaces:**
- Consumes: `track` from Task 4, the taxonomy JSON from Task 1.
- Produces: `resolveScreen(pathname) -> { screen, params } | null` and a default-exported `useScreenView()` hook.

- [ ] **Step 1: Write the failing tests**

Create `client-v2/src/hooks/useScreenView.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import useScreenView, { resolveScreen } from './useScreenView';
import { track } from '../utils/usage';

vi.mock('../utils/usage', () => ({ track: vi.fn() }));

function Probe() {
  useScreenView();
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('fsa_user', JSON.stringify({ email: 'a@test.example' }));
});

describe('resolveScreen', () => {
  it('resolves a static route to its own pattern', () => {
    expect(resolveScreen('/lobby')).toEqual({ screen: '/lobby', params: {} });
  });

  it('resolves a dynamic route to the PATTERN, with the id in params', () => {
    expect(resolveScreen('/lesson/2A1-3-2')).toEqual({
      screen: '/lesson/:lessonCode',
      params: { lessonCode: '2A1-3-2' },
    });
  });

  it('returns null for an unlisted route', () => {
    expect(resolveScreen('/login')).toBeNull();
    expect(resolveScreen('/free-practice-exam')).toBeNull();
    expect(resolveScreen('/admin/usage')).toBeNull();
  });
});

describe('useScreenView', () => {
  it('tracks the pattern, not the raw path', () => {
    render(
      <MemoryRouter initialEntries={['/lesson/2A1-3-2']}>
        <Probe />
      </MemoryRouter>
    );
    expect(track).toHaveBeenCalledWith('screen_view', {
      screen: '/lesson/:lessonCode',
      props: { lessonCode: '2A1-3-2' },
    });
  });

  it('does not track an unlisted route', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Probe />
      </MemoryRouter>
    );
    expect(track).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /home/debian/fsa-agent/client-v2 && npm test -- useScreenView
```

Expected: FAIL — cannot resolve `./useScreenView`.

- [ ] **Step 3: Write the hook**

Create `client-v2/src/hooks/useScreenView.js`:

```js
// Fires one screen_view per route change (backlog #113).
//
// The app uses declarative <Routes>, not a data router, so useMatches() is not
// available — matchPath against the taxonomy's ordered pattern list is the
// explicit, testable equivalent. Storing the PATTERN rather than the path is
// the point: raw paths are unbounded cardinality.
import { useEffect } from 'react';
import { useLocation, matchPath } from 'react-router-dom';
import taxonomy from '../utils/usageTaxonomy.json';
import { track } from '../utils/usage';

export function resolveScreen(pathname) {
  for (const pattern of taxonomy.screens) {
    const match = matchPath(pattern, pathname);
    if (match) return { screen: pattern, params: match.params || {} };
  }
  return null;
}

export default function useScreenView() {
  const { pathname } = useLocation();

  useEffect(() => {
    const hit = resolveScreen(pathname);
    if (!hit) return;
    // track() is itself a no-op when there is no fsa_user in localStorage —
    // the same signal ProtectedRoute uses — so public routes stay untracked.
    track('screen_view', { screen: hit.screen, props: hit.params });
  }, [pathname]);
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /home/debian/fsa-agent/client-v2 && npm test -- useScreenView
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into App and start the flusher**

In `client-v2/src/App.jsx`, add the imports:

```js
import { useEffect } from 'react';
import useScreenView from './hooks/useScreenView';
import { startUsageFlushing } from './utils/usage';
```

and, as the first lines inside `export default function App()` — before the `isLegacyMode` branch, so hook order stays stable across both returns:

```js
  useScreenView();
  useEffect(() => startUsageFlushing(), []);
```

- [ ] **Step 6: Delete the dead GA4 tag**

Remove lines 23–29 of `client-v2/index.html` — the `<!-- Google tag (gtag.js) … -->` comment, the `googletagmanager.com` script tag, and the inline `dataLayer`/`gtag` bootstrap. Change nothing else in that file, and **do not touch the CSP in `server/src/index.js`**.

Verify nothing references the property any more:

```bash
grep -rn "LVH4ZMZJKV\|googletagmanager\|gtag" /home/debian/fsa-agent/client-v2/src /home/debian/fsa-agent/client-v2/index.html
```

Expected: no output.

- [ ] **Step 7: Run the full client suite and a build**

```bash
cd /home/debian/fsa-agent/client-v2 && npm test && npm run build
```

Expected: tests PASS, build succeeds.

- [ ] **Step 8: Commit**

```bash
cd /home/debian/fsa-agent
git add client-v2/src/hooks/useScreenView.js client-v2/src/hooks/useScreenView.test.jsx \
        client-v2/src/App.jsx client-v2/index.html
git commit -m "$(cat <<'EOF'
feat(usage): screen_view tracking, and remove the dead GA4 tag

The gtag snippet has been CSP-blocked since the day it landed — the
header predates it by two months. Replaced with first-party screen_view
events keyed on the route pattern. CSP deliberately unchanged.

Claude-Session: https://claude.ai/code/session_01Ro1EMTMGEherJAf8x2PokQ
EOF
)"
```

---

### Task 6: Feature-use instrumentation

**Files:**
- Modify: `client-v2/src/pages/JobsPage.jsx` (job detail opened)
- Modify: `client-v2/src/pages/SelectPaperPage.jsx` (paper switched)
- Modify: `client-v2/src/pages/ExamResultsPage.jsx` (results lesson expanded)
- Modify: `client-v2/src/LessonPlayer.jsx` (lesson audio played)
- Modify: `client-v2/src/ExamRouter.jsx` (tutor chat opened)
- Modify: the resume-tailoring trigger in `client-v2/src/pages/JobsPage.jsx` or `JobDetailModal.jsx` (tailoring started)

**Interfaces:**
- Consumes: `track` from Task 4.
- Produces: no new exports. Emits the six `feature_use` actions from the Task 1 taxonomy.

Read each file before editing to find the existing handler; add the `track` call inside the handler that already exists rather than adding new handlers or wrappers. One line per site:

```js
import { track } from '../utils/usage';   // path depends on the file's depth
// …inside the existing handler:
track('feature_use', { action: 'job_detail_opened', props: { job_id: job.id } });
```

Action-to-site mapping:

| Action | Site |
|---|---|
| `job_detail_opened` | the handler that opens `JobDetailModal` |
| `paper_switched` | the confirm/submit handler on `SelectPaperPage` |
| `results_lesson_expanded` | the "▶ Watch a lesson on this" accordion toggle in `ExamResultsPage` |
| `lesson_audio_played` | the play handler in `LessonPlayer` (fire on play only, never on resume-after-pause) |
| `tutor_chat_opened` | the floating tutor chat open handler in `ExamRouter` |
| `tailoring_started` | the handler that kicks off resume tailoring |

`props` stays small and non-identifying: an id or code where one is naturally to hand, nothing more.

- [ ] **Step 1: Add the six `track` calls**

- [ ] **Step 2: Verify each action name is in the taxonomy**

```bash
cd /home/debian/fsa-agent
grep -rho "action: '[a-z_]*'" client-v2/src --include="*.jsx" | sort -u
```

Every action printed must appear in `client-v2/src/utils/usageTaxonomy.json`. Anything else is silently dropped by the server and is a bug.

- [ ] **Step 3: Run the client suite**

```bash
cd /home/debian/fsa-agent/client-v2 && npm test
```

Expected: PASS — existing page tests must not regress.

- [ ] **Step 4: Commit**

```bash
cd /home/debian/fsa-agent
git add client-v2/src
git commit -m "$(cat <<'EOF'
feat(usage): emit the six allowlisted feature_use events

Instrumented at the existing handlers only — no new wrappers, no events
for anything that already has a table row.

Claude-Session: https://claude.ai/code/session_01Ro1EMTMGEherJAf8x2PokQ
EOF
)"
```

---

### Task 7: Admin auth and the usage endpoint

**Files:**
- Create: `server/src/middleware/requireAdminUser.js`
- Modify: `server/src/routes/admin.js`
- Test: `server/tests/requireAdminUser.test.js`, `server/tests/adminUsage.test.js`

**Interfaces:**
- Consumes: `pool` from `services/database.js`; `req.user` shape from `requireAuth` (`{ id, email, ... }`).
- Produces:
  - `requireAdminUser(req, res, next)` — 403 unless `req.user.email` (lowercased, trimmed) is in `ADMIN_EMAILS`
  - `GET /api/admin/usage?days=N` → `{ window_days, active_learners, screens: [...], features: [...], activity: {...} }`

- [ ] **Step 1: Write the failing middleware test**

Create `server/tests/requireAdminUser.test.js`:

```js
const request = require('supertest');
const express = require('express');

function buildApp(user) {
  // Re-require per test so ADMIN_EMAILS is read fresh.
  jest.resetModules();
  const requireAdminUser = require('../src/middleware/requireAdminUser');
  const app = express();
  app.get('/x', (req, res, next) => { if (user) req.user = user; next(); }, requireAdminUser, (req, res) =>
    res.json({ ok: true })
  );
  return app;
}

const ORIGINAL = process.env.ADMIN_EMAILS;
afterAll(() => { process.env.ADMIN_EMAILS = ORIGINAL; });

describe('requireAdminUser', () => {
  it('allows an allowlisted address', async () => {
    process.env.ADMIN_EMAILS = 'russ@fullsteamahead.ca,sysadmin@powerboot.ca';
    const res = await request(buildApp({ email: 'russ@fullsteamahead.ca' })).get('/x');
    expect(res.status).toBe(200);
  });

  it('is case- and whitespace-insensitive', async () => {
    process.env.ADMIN_EMAILS = ' Russ@FullSteamAhead.ca ';
    const res = await request(buildApp({ email: 'russ@fullsteamahead.ca' })).get('/x');
    expect(res.status).toBe(200);
  });

  it('403s a non-allowlisted student', async () => {
    process.env.ADMIN_EMAILS = 'russ@fullsteamahead.ca';
    const res = await request(buildApp({ email: 'student@test.example' })).get('/x');
    expect(res.status).toBe(403);
  });

  it('403s when there is no authenticated user', async () => {
    process.env.ADMIN_EMAILS = 'russ@fullsteamahead.ca';
    const res = await request(buildApp(null)).get('/x');
    expect(res.status).toBe(403);
  });

  it('403s everyone when ADMIN_EMAILS is unset — fails closed', async () => {
    delete process.env.ADMIN_EMAILS;
    const res = await request(buildApp({ email: 'russ@fullsteamahead.ca' })).get('/x');
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /home/debian/fsa-agent/server && npm test -- requireAdminUser
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the middleware**

Create `server/src/middleware/requireAdminUser.js`:

```js
// Identity-based admin gate (backlog #113).
//
// platform_users has no role column, and /api/admin's existing routes are
// gated by an x-admin-api-key header — not something to type into a browser.
// This gate reuses the session the owner already has: requireAuth establishes
// identity, this checks that identity against an allowlist.
//
// Fails closed: an unset or empty ADMIN_EMAILS admits nobody.
module.exports = function requireAdminUser(req, res, next) {
  const allowed = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const email = (req.user?.email || '').trim().toLowerCase();
  if (!email || !allowed.includes(email)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
};
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /home/debian/fsa-agent/server && npm test -- requireAdminUser
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing endpoint test**

Create `server/tests/adminUsage.test.js`:

```js
const request = require('supertest');
const express = require('express');
const { pool } = require('./testPool');

process.env.ADMIN_EMAILS = 'admin@test.example';
const adminRouter = require('../src/routes/admin');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', (req, res, next) => { if (user) req.user = user; next(); }, adminRouter);
  return app;
}

let userId;

beforeAll(async () => {
  const { rows } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash)
     VALUES ('admin-usage-test@test.example', 'Admin', 'Usage', 'x') RETURNING id`
  );
  userId = rows[0].id;
  await pool.query(
    `INSERT INTO usage_events (user_id, event_type, screen, action, occurred_at)
     VALUES ($1, 'screen_view', '/lobby', NULL, now()),
            ($1, 'screen_view', '/lobby', NULL, now()),
            ($1, 'screen_view', '/jobs',  NULL, now()),
            ($1, 'feature_use', NULL, 'paper_switched', now())`,
    [userId]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM usage_events WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM platform_users WHERE id = $1', [userId]);
  await pool.end();
});

describe('GET /api/admin/usage', () => {
  it('403s a non-admin', async () => {
    const res = await request(buildApp({ email: 'student@test.example' })).get('/api/admin/usage');
    expect(res.status).toBe(403);
  });

  it('returns screen and feature aggregates for an admin', async () => {
    const res = await request(buildApp({ email: 'admin@test.example' })).get('/api/admin/usage?days=7');
    expect(res.status).toBe(200);
    expect(res.body.window_days).toBe(7);

    const lobby = res.body.screens.find((s) => s.screen === '/lobby');
    expect(lobby.views).toBeGreaterThanOrEqual(2);
    expect(lobby.viewers).toBeGreaterThanOrEqual(1);

    const switched = res.body.features.find((f) => f.action === 'paper_switched');
    expect(switched.uses).toBeGreaterThanOrEqual(1);
  });

  it('clamps an absurd or non-numeric days parameter to the default', async () => {
    const app = buildApp({ email: 'admin@test.example' });

    const tooBig = await request(app).get('/api/admin/usage?days=9999');
    expect(tooBig.status).toBe(200);
    expect(tooBig.body.window_days).toBe(30);

    const nonsense = await request(app).get('/api/admin/usage?days=nonsense');
    expect(nonsense.status).toBe(200);
    expect(nonsense.body.window_days).toBe(30);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
cd /home/debian/fsa-agent/server && npm test -- adminUsage
```

Expected: FAIL — the route 404s.

- [ ] **Step 7: Add the endpoint to `admin.js`**

At the top of `server/src/routes/admin.js`, alongside the existing requires:

```js
const requireAdminUser = require('../middleware/requireAdminUser');
```

Then add (note `requireAdminKey` is applied per-route in this file, so the two existing API-key routes are untouched):

```js
// GET /api/admin/usage?days=N — first-party platform usage (backlog #113).
//
// Gated by requireAdminUser (session identity + ADMIN_EMAILS), not by the
// x-admin-api-key used by the two routes above: this one is called from a
// browser page, and pasting an API key into a browser is not a design.
router.get('/usage', requireAdminUser, async (req, res) => {
  const parsed = parseInt(req.query.days, 10);
  const days = Number.isFinite(parsed) && parsed > 0 && parsed <= 365 ? parsed : 30;
  const since = `${days} days`;

  try {
    const [screens, features, learners, activity] = await Promise.all([
      pool.query(
        `SELECT screen, COUNT(*)::int AS views, COUNT(DISTINCT user_id)::int AS viewers
           FROM usage_events
          WHERE event_type = 'screen_view' AND occurred_at >= now() - $1::interval
          GROUP BY screen ORDER BY views DESC`,
        [since]
      ),
      pool.query(
        `SELECT action, COUNT(*)::int AS uses, COUNT(DISTINCT user_id)::int AS users
           FROM usage_events
          WHERE event_type = 'feature_use' AND occurred_at >= now() - $1::interval
          GROUP BY action ORDER BY uses DESC`,
        [since]
      ),
      pool.query(
        `SELECT occurred_at::date AS day, COUNT(DISTINCT user_id)::int AS learners
           FROM usage_events
          WHERE occurred_at >= now() - $1::interval
          GROUP BY 1 ORDER BY 1`,
        [since]
      ),
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM question_responses WHERE answered_at >= now() - $1::interval) AS questions_answered,
           (SELECT COUNT(*)::int FROM question_responses WHERE answered_at >= now() - $1::interval AND correct) AS questions_correct,
           (SELECT COUNT(*)::int FROM user_progress WHERE last_accessed >= now() - $1::interval) AS lessons_touched,
           (SELECT COUNT(*)::int FROM practice_exam_attempts WHERE created_at >= now() - $1::interval) AS exams_attempted,
           (SELECT COUNT(*)::int FROM saved_jobs WHERE saved_at >= now() - $1::interval) AS jobs_saved,
           (SELECT COUNT(*)::int FROM chat_history WHERE created_at >= now() - $1::interval) AS tutor_turns,
           (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'active') AS subscribers_active`,
        [since]
      ),
    ]);

    res.json({
      window_days: days,
      active_learners: learners.rows,
      screens: screens.rows,
      features: features.rows,
      activity: activity.rows[0],
    });
  } catch (error) {
    console.error('Error building usage report:', error);
    res.status(500).json({ error: 'Failed to build usage report' });
  }
});
```

- [ ] **Step 8: Run both admin tests and then the whole suite**

```bash
cd /home/debian/fsa-agent/server && npm test -- adminUsage && npm test
```

Expected: PASS.

- [ ] **Step 9: Add `ADMIN_EMAILS` to the environment**

Append to `/home/debian/fsa-agent/.env` (project layer — **not** `.env.shared`, since only fsa-agent reads it):

```
ADMIN_EMAILS=russ@fullsteamahead.ca,sysadmin@powerboot.ca
```

Confirm the exact addresses with the owner before writing them; the gate fails closed, so a wrong address means a 403 rather than an exposure.

- [ ] **Step 10: Commit**

```bash
cd /home/debian/fsa-agent
git add server/src/middleware/requireAdminUser.js server/src/routes/admin.js \
        server/tests/requireAdminUser.test.js server/tests/adminUsage.test.js
git commit -m "$(cat <<'EOF'
feat(usage): ADMIN_EMAILS-gated GET /api/admin/usage

Identity-based gate rather than the x-admin-api-key used by the existing
admin routes — this one is called from a browser. Fails closed on an
unset allowlist.

Claude-Session: https://claude.ai/code/session_01Ro1EMTMGEherJAf8x2PokQ
EOF
)"
```

---

### Task 8: The admin usage page

**Files:**
- Create: `client-v2/src/pages/AdminUsagePage.jsx`
- Create: `client-v2/src/pages/AdminUsagePage.css`
- Modify: `client-v2/src/App.jsx` (add the route)
- Test: `client-v2/src/pages/AdminUsagePage.test.jsx`

**Interfaces:**
- Consumes: `GET /api/admin/usage?days=N` from Task 7; `getJson` from `utils/api.js`.
- Produces: a `/admin/usage` route.

- [ ] **Step 1: Write the failing test**

Create `client-v2/src/pages/AdminUsagePage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminUsagePage from './AdminUsagePage';
import { getJson } from '../utils/api';

vi.mock('../utils/api', () => ({ getJson: vi.fn(), ApiError: class extends Error {} }));

const PAYLOAD = {
  window_days: 30,
  active_learners: [{ day: '2026-09-03', learners: 4 }],
  screens: [{ screen: '/lobby', views: 12, viewers: 5 }],
  features: [{ action: 'paper_switched', uses: 3, users: 2 }],
  activity: {
    questions_answered: 120, questions_correct: 90, lessons_touched: 8,
    exams_attempted: 2, jobs_saved: 5, tutor_turns: 4, subscribers_active: 15,
  },
};

beforeEach(() => vi.clearAllMocks());

function renderPage() {
  return render(<MemoryRouter><AdminUsagePage /></MemoryRouter>);
}

describe('AdminUsagePage', () => {
  it('renders screen, feature and activity figures', async () => {
    getJson.mockResolvedValue(PAYLOAD);
    renderPage();
    expect(await screen.findByText('/lobby')).toBeInTheDocument();
    expect(await screen.findByText('paper_switched')).toBeInTheDocument();
    expect(await screen.findByText(/120/)).toBeInTheDocument();
  });

  it('shows a clear message when the API refuses', async () => {
    getJson.mockRejectedValue(new Error('Forbidden'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/could not load usage/i)).toBeInTheDocument());
  });

  it('shows an empty state rather than a blank page when there is no data', async () => {
    getJson.mockResolvedValue({ ...PAYLOAD, screens: [], features: [], active_learners: [] });
    renderPage();
    expect(await screen.findByText(/no usage recorded/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /home/debian/fsa-agent/client-v2 && npm test -- AdminUsagePage
```

Expected: FAIL — cannot resolve `./AdminUsagePage`.

- [ ] **Step 3: Write the page**

Create `client-v2/src/pages/AdminUsagePage.jsx`:

```jsx
// First-party platform usage (backlog #113). The real gate is server-side
// requireAdminUser (session identity + ADMIN_EMAILS); this page just renders
// what that endpoint returns. /admin/usage is deliberately absent from the
// screen taxonomy, so the page never appears in its own numbers.
import { useEffect, useState } from 'react';
import { getJson } from '../utils/api';
import './AdminUsagePage.css';

const WINDOWS = [7, 30, 90];

function pct(correct, answered) {
  if (!answered) return '—';
  return `${Math.round((correct / answered) * 100)}%`;
}

export default function AdminUsagePage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);

    getJson(`/api/admin/usage?days=${days}`)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        // api.js throws; every call site owns its own message (backlog #68).
        if (!cancelled) setError('Could not load usage');
      });

    return () => {
      cancelled = true;
    };
  }, [days]);

  if (error) return <div className="admin-usage admin-usage-error">{error}</div>;
  if (!data) return <div className="admin-usage">Loading usage…</div>;

  const { screens = [], features = [], active_learners: learners = [], activity = {} } = data;
  const empty = screens.length === 0 && features.length === 0 && learners.length === 0;

  return (
    <div className="admin-usage">
      <header className="admin-usage-header">
        <h1>Platform usage</h1>
        <div className="admin-usage-windows">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              className={w === days ? 'is-active' : ''}
              onClick={() => setDays(w)}
            >
              {w} days
            </button>
          ))}
        </div>
      </header>

      <p className="admin-usage-provenance">
        From fsa-postgres. The LMS is deliberately not GA4-instrumented — see backlog #113.
      </p>

      {empty ? (
        <p className="admin-usage-empty">No usage recorded in this window.</p>
      ) : (
        <>
          <section>
            <h2>Activity</h2>
            <ul className="admin-usage-stats">
              <li><strong>{activity.questions_answered}</strong> questions answered</li>
              <li><strong>{pct(activity.questions_correct, activity.questions_answered)}</strong> accuracy</li>
              <li><strong>{activity.lessons_touched}</strong> lessons touched</li>
              <li><strong>{activity.exams_attempted}</strong> exams attempted</li>
              <li><strong>{activity.jobs_saved}</strong> jobs saved</li>
              <li><strong>{activity.tutor_turns}</strong> tutor turns</li>
              <li><strong>{activity.subscribers_active}</strong> active subscribers</li>
            </ul>
          </section>

          <section>
            <h2>Screens</h2>
            <table>
              <thead><tr><th>Screen</th><th>Views</th><th>Viewers</th></tr></thead>
              <tbody>
                {screens.map((s) => (
                  <tr key={s.screen}>
                    <td>{s.screen}</td><td>{s.views}</td><td>{s.viewers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h2>Features</h2>
            <table>
              <thead><tr><th>Action</th><th>Uses</th><th>People</th></tr></thead>
              <tbody>
                {features.map((f) => (
                  <tr key={f.action}>
                    <td>{f.action}</td><td>{f.uses}</td><td>{f.users}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h2>Active learners per day</h2>
            <table>
              <thead><tr><th>Day</th><th>Learners</th></tr></thead>
              <tbody>
                {learners.map((d) => (
                  <tr key={d.day}>
                    <td>{String(d.day).slice(0, 10)}</td><td>{d.learners}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
```

Create `AdminUsagePage.css` following the existing page CSS convention (see `CreditsPage.css` for the house style — plain classes, no CSS-in-JS). It needs, at minimum: `.admin-usage` (page padding and max width), `.admin-usage-header`, `.admin-usage-windows button` with an `.is-active` state, `.admin-usage-provenance` (small, muted), `.admin-usage-error`, `.admin-usage-empty`, `.admin-usage-stats`, and table styling.

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /home/debian/fsa-agent/client-v2 && npm test -- AdminUsagePage
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Add the route**

In `client-v2/src/App.jsx`, import the page and add, alongside the other routes:

```jsx
      <Route path="/admin/usage" element={<AdminUsagePage />} />
```

No `ProtectedRoute` wrapper — its paper/course redirects do not apply, and the server-side `requireAdminUser` is the real gate. `/admin/usage` is deliberately absent from the taxonomy, so the page does not track itself.

- [ ] **Step 6: Run the full client suite and build**

```bash
cd /home/debian/fsa-agent/client-v2 && npm test && npm run build
```

Expected: PASS and a successful build.

- [ ] **Step 7: Commit**

```bash
cd /home/debian/fsa-agent
git add client-v2/src/pages/AdminUsagePage.jsx client-v2/src/pages/AdminUsagePage.css \
        client-v2/src/pages/AdminUsagePage.test.jsx client-v2/src/App.jsx
git commit -m "$(cat <<'EOF'
feat(usage): /admin/usage page

Server-side requireAdminUser is the real gate; the page is excluded from
the screen taxonomy so it never pollutes its own numbers.

Claude-Session: https://claude.ai/code/session_01Ro1EMTMGEherJAf8x2PokQ
EOF
)"
```

---

### Task 9: Retention — rollup and prune

**Files:**
- Create: `server/src/scripts/prune_usage_events.js`
- Test: `server/tests/pruneUsageEvents.test.js`

**Interfaces:**
- Consumes: `usage_events`, `usage_events_daily` from Task 1.
- Produces: `pruneUsageEvents({ olderThanDays = 90, pool }) -> { rolled_up: number, deleted: number }`, plus a CLI entry point when run directly.

- [ ] **Step 1: Write the failing test**

Create `server/tests/pruneUsageEvents.test.js`:

```js
const { pool } = require('./testPool');
const { pruneUsageEvents } = require('../src/scripts/prune_usage_events');

let userId;
let otherId;

beforeAll(async () => {
  const a = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash)
     VALUES ('prune-a@test.example', 'A', 'A', 'x') RETURNING id`
  );
  const b = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash)
     VALUES ('prune-b@test.example', 'B', 'B', 'x') RETURNING id`
  );
  userId = a.rows[0].id;
  otherId = b.rows[0].id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM usage_events WHERE user_id = ANY($1)', [[userId, otherId]]);
  await pool.query("DELETE FROM usage_events_daily WHERE screen = '/lobby'");

  // Two users, same old day and screen → 2 events, 2 distinct users.
  await pool.query(
    `INSERT INTO usage_events (user_id, event_type, screen, occurred_at)
     VALUES ($1, 'screen_view', '/lobby', now() - interval '200 days'),
            ($2, 'screen_view', '/lobby', now() - interval '200 days'),
            ($1, 'screen_view', '/lobby', now() - interval '1 day')`,
    [userId, otherId]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM usage_events WHERE user_id = ANY($1)', [[userId, otherId]]);
  await pool.query("DELETE FROM usage_events_daily WHERE screen = '/lobby'");
  await pool.query('DELETE FROM platform_users WHERE id = ANY($1)', [[userId, otherId]]);
  await pool.end();
});

describe('pruneUsageEvents', () => {
  it('rolls up rows older than the window and deletes them', async () => {
    const result = await pruneUsageEvents({ olderThanDays: 90, pool });
    expect(result.deleted).toBe(2);

    const { rows } = await pool.query(
      "SELECT event_count, user_count FROM usage_events_daily WHERE screen = '/lobby'"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].event_count).toBe(2);
    expect(rows[0].user_count).toBe(2); // distinct users, counted BEFORE deletion
  });

  it('leaves rows inside the window alone', async () => {
    await pruneUsageEvents({ olderThanDays: 90, pool });
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM usage_events WHERE user_id = ANY($1)', [
      [userId, otherId],
    ]);
    expect(rows[0].n).toBe(1);
  });

  it('is idempotent — a second run changes nothing', async () => {
    await pruneUsageEvents({ olderThanDays: 90, pool });
    const second = await pruneUsageEvents({ olderThanDays: 90, pool });
    expect(second.deleted).toBe(0);

    const { rows } = await pool.query(
      "SELECT event_count, user_count FROM usage_events_daily WHERE screen = '/lobby'"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].event_count).toBe(2);
  });

  it('writes empty strings, not NULLs, into the rollup key columns', async () => {
    await pool.query(
      `INSERT INTO usage_events (user_id, event_type, action, occurred_at)
       VALUES ($1, 'feature_use', 'paper_switched', now() - interval '200 days')`,
      [userId]
    );
    await pruneUsageEvents({ olderThanDays: 90, pool });
    const { rows } = await pool.query(
      "SELECT screen FROM usage_events_daily WHERE action = 'paper_switched'"
    );
    expect(rows[0].screen).toBe('');
    await pool.query("DELETE FROM usage_events_daily WHERE action = 'paper_switched'");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /home/debian/fsa-agent/server && npm test -- pruneUsageEvents
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the script**

Create `server/src/scripts/prune_usage_events.js`:

```js
// Retention for usage_events (backlog #113): 90 days raw, then daily rollups.
//
// Run from the host crontab — see wiki/projects/fsa-agent.md. That crontab
// line is host state living in no repository; if this box is rebuilt and the
// line is not restored, the table grows without bound and nothing complains.
//
// Idempotent by construction: the rollup upserts on its primary key and the
// delete only touches rows it has just rolled up.
const { pool: defaultPool } = require('../services/database');

async function pruneUsageEvents({ olderThanDays = 90, pool = defaultPool } = {}) {
  const cutoff = `${olderThanDays} days`;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // user_count must be a DISTINCT count taken before the delete — computing
    // it afterwards, or summing rollup rows later, would both be wrong.
    //
    // On the ON CONFLICT path (a day partially rolled up by an earlier run)
    // event_count adds, but user_count takes GREATEST rather than a sum:
    // distinct users cannot be summed across runs without double-counting
    // anyone active in both. It is a floor, and deliberately so — the normal
    // path rolls a whole day at once and hits the plain INSERT.
    const rolled = await client.query(
      `INSERT INTO usage_events_daily (day, event_type, screen, action, event_count, user_count)
       SELECT occurred_at::date,
              event_type,
              COALESCE(screen, ''),
              COALESCE(action, ''),
              COUNT(*)::int,
              COUNT(DISTINCT user_id)::int
         FROM usage_events
        WHERE occurred_at < now() - $1::interval
        GROUP BY 1, 2, 3, 4
       ON CONFLICT (day, event_type, screen, action) DO UPDATE
          SET event_count = usage_events_daily.event_count + EXCLUDED.event_count,
              user_count  = GREATEST(usage_events_daily.user_count, EXCLUDED.user_count)`,
      [cutoff]
    );

    const deleted = await client.query(
      `DELETE FROM usage_events WHERE occurred_at < now() - $1::interval`,
      [cutoff]
    );

    await client.query('COMMIT');
    return { rolled_up: rolled.rowCount, deleted: deleted.rowCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pruneUsageEvents };

if (require.main === module) {
  const arg = process.argv.find((a) => a.startsWith('--days='));
  const olderThanDays = arg ? parseInt(arg.split('=')[1], 10) : 90;
  pruneUsageEvents({ olderThanDays })
    .then((r) => {
      console.log(`[usage] rolled up ${r.rolled_up} day-rows, deleted ${r.deleted} raw events`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[usage] prune failed:', err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /home/debian/fsa-agent/server && npm test -- pruneUsageEvents
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/debian/fsa-agent
git add server/src/scripts/prune_usage_events.js server/tests/pruneUsageEvents.test.js
git commit -m "$(cat <<'EOF'
feat(usage): 90-day retention with daily rollups

Distinct user counts are taken before the delete — computing them after,
or summing rollup rows later, would both be wrong. Idempotent.

Claude-Session: https://claude.ai/code/session_01Ro1EMTMGEherJAf8x2PokQ
EOF
)"
```

---

### Task 10: Daily-brief collector

**Files:**
- Create: `/home/debian/fsa-dashboard/collect_platform_usage.py`
- Modify: `/home/debian/fsa-dashboard/collect.py` (import list and `collectors` list)
- Modify: `/home/debian/.claude/skills/fsa-daily-brief/SKILL.md`
- Test: `/home/debian/fsa-dashboard/tests/test_collect_platform_usage.py`

**Interfaces:**
- Consumes: `usage_events` and the existing activity tables.
- Produces: `collect_platform_usage() -> dict` with keys `active_learners_24h`, `active_learners_7d`, `screen_views_24h`, `top_screens`, `feature_use_24h`, `questions_answered_24h`, `questions_accuracy_24h`, `lessons_touched_24h`, `exams_attempted_24h`, `tutor_turns_24h`, `subscribers_active`.

- [ ] **Step 1: Write the failing test**

Create `/home/debian/fsa-dashboard/tests/test_collect_platform_usage.py`:

```python
"""Unit tests for the platform-usage collector.

The database is mocked: this asserts the shape of the returned dict and the
error convention, not the SQL. Following collect_job_saves.py, a collector must
never raise into collect_all() — a failure is reported as a value.
"""
from unittest.mock import MagicMock, patch

import collect_platform_usage


def _cursor_returning(rows):
    """A cursor whose fetchone() returns `rows` in order.

    The order matters and is the same one collect_platform_usage() issues its
    queries in — see the ORDER comment in that module. `__enter__` must be set
    via .return_value: Python looks dunders up on the type, so assigning a
    lambda to the instance attribute would not make `with` work.
    """
    cur = MagicMock()
    cur.fetchone.side_effect = rows
    cur.fetchall.return_value = [("/lobby", 12), ("/jobs", 5)]
    cur.__enter__.return_value = cur
    cur.__exit__.return_value = False
    return cur


def test_returns_the_expected_keys():
    cur = _cursor_returning([(4,), (9,), (30,), (7,), (120, 90), (8,), (2,), (4,), (15,)])
    conn = MagicMock()
    conn.cursor.return_value = cur

    with patch("collect_platform_usage.psycopg2.connect", return_value=conn):
        result = collect_platform_usage.collect_platform_usage()

    for key in (
        "active_learners_24h", "active_learners_7d", "screen_views_24h",
        "top_screens", "feature_use_24h", "questions_answered_24h",
        "questions_accuracy_24h", "lessons_touched_24h", "exams_attempted_24h",
        "tutor_turns_24h", "subscribers_active",
    ):
        assert key in result


def test_accuracy_is_none_rather_than_a_divide_by_zero():
    cur = _cursor_returning([(0,), (0,), (0,), (0,), (0, 0), (0,), (0,), (0,), (0,)])
    conn = MagicMock()
    conn.cursor.return_value = cur

    with patch("collect_platform_usage.psycopg2.connect", return_value=conn):
        result = collect_platform_usage.collect_platform_usage()

    assert result["questions_accuracy_24h"] is None
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /home/debian/fsa-dashboard && python3 -m pytest tests/test_collect_platform_usage.py -q
```

Expected: FAIL — `ModuleNotFoundError: No module named 'collect_platform_usage'`.

- [ ] **Step 3: Write the collector**

Create `/home/debian/fsa-dashboard/collect_platform_usage.py`:

```python
"""Daily-brief collector for first-party LMS usage (backlog #113).

learn.fullsteamahead.ca has never produced a single GA4 event: the helmet CSP
in fsa-agent's server/src/index.js (2026-04-16) predates the gtag snippet
(2026-06-09) by two months, so property G-LVH4ZMZJKV has been empty its whole
life. Owner decision 2026-09-04: don't loosen CSP on the authenticated app —
report from fsa-postgres, which is the system of record anyway.

Two halves, deliberately: screen and feature figures come from usage_events
(the only things no other table records), and everything else is read from the
table that already owns it. That way the brief reconciles against tables that
are already trusted.

Read-only. Unlike collect.py as a whole -- whose reconcile_subscriptions() can
revoke platform access -- running this module directly against production is
safe.
"""

import os

import psycopg2


def _connect():
    # Same shape as collect_job_saves.py. From the host, fsa-postgres is
    # localhost:5434 -- a bare localhost:5432 reaches a DIFFERENT business's
    # database on this server.
    db_url = os.getenv('DATABASE_URL') or (
        f"postgresql://{os.getenv('POSTGRES_USER','postgres')}:"
        f"{os.getenv('POSTGRES_PASSWORD','fsa_dev_password')}@"
        f"{os.getenv('POSTGRES_HOST_EXTERNAL','localhost')}:"
        f"{os.getenv('POSTGRES_PORT_EXTERNAL','5434')}/"
        f"{os.getenv('POSTGRES_DB','fsa_agent')}"
    )
    return psycopg2.connect(db_url)


def collect_platform_usage() -> dict:
    conn = _connect()
    try:
        with conn.cursor() as cur:
            # ORDER IS LOAD-BEARING: tests/test_collect_platform_usage.py feeds
            # fetchone() a side_effect list in exactly this sequence.

            # 1. active learners, 24h
            cur.execute(
                "SELECT COUNT(DISTINCT user_id) FROM usage_events "
                "WHERE occurred_at >= NOW() - INTERVAL '24 hours'"
            )
            active_24h = cur.fetchone()[0]

            # 2. active learners, 7d
            cur.execute(
                "SELECT COUNT(DISTINCT user_id) FROM usage_events "
                "WHERE occurred_at >= NOW() - INTERVAL '7 days'"
            )
            active_7d = cur.fetchone()[0]

            # 3. screen views, 24h
            cur.execute(
                "SELECT COUNT(*) FROM usage_events "
                "WHERE event_type = 'screen_view' AND occurred_at >= NOW() - INTERVAL '24 hours'"
            )
            screen_views = cur.fetchone()[0]

            # 4. feature uses, 24h
            cur.execute(
                "SELECT COUNT(*) FROM usage_events "
                "WHERE event_type = 'feature_use' AND occurred_at >= NOW() - INTERVAL '24 hours'"
            )
            feature_use = cur.fetchone()[0]

            # 5. questions answered + correct, 24h (one row, two columns)
            cur.execute(
                "SELECT COUNT(*), COUNT(*) FILTER (WHERE correct) FROM question_responses "
                "WHERE answered_at >= NOW() - INTERVAL '24 hours'"
            )
            answered, correct = cur.fetchone()

            # 6. lessons touched, 24h
            cur.execute(
                "SELECT COUNT(*) FROM user_progress "
                "WHERE last_accessed >= NOW() - INTERVAL '24 hours'"
            )
            lessons_touched = cur.fetchone()[0]

            # 7. practice exams attempted, 24h
            cur.execute(
                "SELECT COUNT(*) FROM practice_exam_attempts "
                "WHERE created_at >= NOW() - INTERVAL '24 hours'"
            )
            exams_attempted = cur.fetchone()[0]

            # 8. tutor turns, 24h
            cur.execute(
                "SELECT COUNT(*) FROM chat_history "
                "WHERE created_at >= NOW() - INTERVAL '24 hours'"
            )
            tutor_turns = cur.fetchone()[0]

            # 9. active subscribers (point-in-time, not a window)
            cur.execute("SELECT COUNT(*) FROM subscriptions WHERE status = 'active'")
            subscribers_active = cur.fetchone()[0]

            # 10. top screens, 24h
            cur.execute(
                "SELECT screen, COUNT(*) AS views FROM usage_events "
                "WHERE event_type = 'screen_view' AND occurred_at >= NOW() - INTERVAL '24 hours' "
                "GROUP BY screen ORDER BY views DESC LIMIT 5"
            )
            top_screens = [{"screen": r[0], "views": r[1]} for r in cur.fetchall()]

        return {
            "active_learners_24h": active_24h,
            "active_learners_7d": active_7d,
            "screen_views_24h": screen_views,
            "top_screens": top_screens,
            "feature_use_24h": feature_use,
            "questions_answered_24h": answered,
            # None, never a ZeroDivisionError, on a day nobody answered anything.
            "questions_accuracy_24h": round(correct / answered, 3) if answered else None,
            "lessons_touched_24h": lessons_touched,
            "exams_attempted_24h": exams_attempted,
            "tutor_turns_24h": tutor_turns,
            "subscribers_active": subscribers_active,
        }
    finally:
        conn.close()


if __name__ == "__main__":
    import json
    print(json.dumps(collect_platform_usage(), indent=2, default=str))
```

A raised exception here is caught by `collect_all()`'s per-collector `try`, which
records `{"error": ...}` for this key and leaves every other section of the brief
intact — the existing convention, not something this collector re-implements.

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /home/debian/fsa-dashboard && python3 -m pytest tests/test_collect_platform_usage.py -q
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Verify it against the real database, read-only**

```bash
cd /home/debian/fsa-dashboard && python3 collect_platform_usage.py
```

Expected: JSON with plausible figures. This collector only ever SELECTs, so it is safe against `fsa_agent` — unlike `collect.py` as a whole, whose `reconcile_subscriptions()` has real production side effects.

- [ ] **Step 6: Register it in `collect.py`**

Add the import alongside the others:

```python
from collect_platform_usage import collect_platform_usage
```

and the entry in the `collectors` list, after `("job_saves", collect_job_saves)`:

```python
        ("platform_usage", collect_platform_usage),
```

- [ ] **Step 7: Add the brief section**

In `/home/debian/.claude/skills/fsa-daily-brief/SKILL.md`, add a **Platform Usage** section following the existing convention (see the Job saves paragraph around line 210 for the house style, including the `error`-key rule: render *"Platform usage: unavailable (<error>)"* rather than omitting the section).

The section reports: active learners (24h and 7d), screen views with the top screens, feature use, questions answered and accuracy, lessons touched, exams attempted, tutor turns, and active subscribers. Per the brief's report format, each section carries a Read, the Data, and Opportunities.

Add a line making the provenance explicit, because it is the whole point of the work: *"These figures come from fsa-postgres, not GA4. The LMS is deliberately not GA4-instrumented — see backlog #113."*

- [ ] **Step 8: Commit — two repos**

```bash
cd /home/debian/fsa-dashboard
git add collect_platform_usage.py collect.py tests/test_collect_platform_usage.py
git commit -m "$(cat <<'EOF'
feat(brief): platform usage collector reading fsa-postgres

The LMS has never had working GA4 (CSP-blocked since before the tag was
added). These figures come from the system of record instead.

Claude-Session: https://claude.ai/code/session_01Ro1EMTMGEherJAf8x2PokQ
EOF
)"

cd /home/debian
git add .claude/skills/fsa-daily-brief/SKILL.md
git commit -m "$(cat <<'EOF'
feat(daily-brief): Platform Usage section

Claude-Session: https://claude.ai/code/session_01Ro1EMTMGEherJAf8x2PokQ
EOF
)"
```

---

### Task 11: Deploy and document

**Files:**
- Modify: `/home/debian/wiki/projects/fsa-agent.md`
- Modify: `/home/debian/wiki/log.md`
- Modify: `/home/debian/wiki/tasks/backlog.md` (close #113)
- Modify: the `debian` user crontab (host state, no repo)

- [ ] **Step 1: Back up production**

```bash
sudo /usr/local/bin/fsa-backup.sh daily
```

Note the path it prints. Do not continue until it reports success.

- [ ] **Step 2: Apply the migration to production and scratch**

```bash
docker cp /home/debian/fsa-agent/server/migrations/018_usage_events.sql fsa-postgres:/tmp/018.sql
docker exec fsa-postgres psql -U postgres -d fsa_agent         -f /tmp/018.sql
docker exec fsa-postgres psql -U postgres -d fsa_agent_scratch -f /tmp/018.sql
```

Verify:

```bash
docker exec fsa-postgres psql -U postgres -d fsa_agent -c "\d usage_events"
```

- [ ] **Step 3: Build the client and the API**

```bash
cd /home/debian/fsa-agent/client-v2 && npm run build
GITHUB_TOKEN=$(gh auth token) docker compose build api && docker compose up -d api
```

`GITHUB_TOKEN` is required — `fsa-common` is a private `github:` dependency pulled through a BuildKit secret; without it the build fails at the clone step with git exit 128.

- [ ] **Step 4: Verify on the live site, not localhost**

Open `https://learn.fullsteamahead.ca`, log in, and move between `/lobby`, `/chapters` and `/jobs`. Then:

```bash
docker exec fsa-postgres psql -U postgres -d fsa_agent \
  -c "SELECT event_type, screen, action, occurred_at FROM usage_events ORDER BY id DESC LIMIT 10;"
```

Expected: rows for the screens just visited, with `screen` holding **patterns** (`/lesson/:lessonCode`), not raw paths. Confirm in the browser console that there are **no CSP violations** and no request to `googletagmanager.com`.

Then check the admin page loads at `https://learn.fullsteamahead.ca/admin/usage` as an `ADMIN_EMAILS` address, and 403s as an ordinary student.

- [ ] **Step 5: Add the prune crontab entry**

```bash
crontab -e
```

Add, following the `device_switch_report.js` line already there:

```
30 3 * * * /usr/bin/docker exec fsa-agent-api-1 node src/scripts/prune_usage_events.js >> /home/debian/fsa-agent/logs/usage-prune-cron.log 2>&1
```

03:30 deliberately follows the 03:15 `fsa-scratch-refresh` rather than competing with it.

- [ ] **Step 6: Update the wiki**

In `wiki/projects/fsa-agent.md`, add a section covering: the CSP-vs-gtag timeline and why GA4 is dead on the LMS; the `usage_events` schema and the "if a row already exists for it, it is not an event" rule; the taxonomy and where both copies live; the `ADMIN_EMAILS` gate and `/admin/usage`; and **the prune crontab line, called out as host state that lives in no repository**, exactly as the device-switch report line is.

Append to `wiki/log.md`:

```
## [2026-09-04] feat | The LMS has never had working GA4; usage now comes from our own database
```

Close #113 in `wiki/tasks/backlog.md` by moving it to `wiki/tasks/backlog-archive.md`, compressed, recording that the CSP was deliberately left alone.

- [ ] **Step 7: Commit the wiki**

```bash
cd /home/debian/wiki
git add projects/fsa-agent.md log.md tasks/backlog.md tasks/backlog-archive.md
git commit -m "$(cat <<'EOF'
docs(usage): first-party LMS tracking, and why GA4 stays off

Claude-Session: https://claude.ai/code/session_01Ro1EMTMGEherJAf8x2PokQ
EOF
)"
```

- [ ] **Step 8: Confirm the brief renders**

Run the daily brief and check the Platform Usage section appears with real figures rather than *"unavailable"*.
