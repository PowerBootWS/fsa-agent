# LMS first-party usage tracking

**Date:** 2026-09-04
**Backlog:** #113
**Projects:** fsa-agent (primary), fsa-dashboard, `fsa-daily-brief` skill
**Status:** approved design, not yet implemented

## Why

`learn.fullsteamahead.ca` has never produced a single GA4 event.

`server/src/index.js` sets a global helmet Content-Security-Policy whose
`scriptSrc` is `['self', 'unsafe-eval', https://cdn.jsdelivr.net,
https://static.cloudflareinsights.com]`. That header was committed on
**2026-04-16** (`5417cc3`). The gtag snippet was added to
`client-v2/index.html` on **2026-06-09** (`eed30ee`). The CSP predates the tag
by nearly two months, so the tag has been blocked from the moment it landed —
both the `googletagmanager.com` script load and the inline `gtag()` bootstrap.
GA4 property `G-LVH4ZMZJKV` has been empty its entire life.

Nothing reads that property: `fsa-dashboard/collect_ga4.py` uses a single
`GA4_PROPERTY_ID`, which is the marketing site's `G-5ZFF5FB8R8`. So no existing
report is wrong — the LMS has simply never been measured.

**Owner decision (2026-09-04):** do not loosen the CSP on the authenticated app
that holds student accounts. Measure the platform from our own database
instead, which is the system of record anyway and cannot be blocked by a header
or an ad-blocker.

## What already exists

Nearly all meaningful student activity is already recorded in `fsa_agent`
(`public` schema). Counts as of 2026-09-04:

| Table | Rows | Latest | What it tells us |
|---|---|---|---|
| `question_responses` | 5,764 | 2026-09-03 | questions answered, correctness, by course/chapter |
| `user_progress` | 152 | 2026-08-27 | lesson completion, scores, struggles |
| `learner_sessions` | 83 | 2026-09-04 | sections viewed, checkpoint log |
| `login_events` | 43 | 2026-09-03 | logins, device type, IP, session displacement |
| `course_progress` | 27 | 2026-09-04 | last lesson/slide per course |
| `practice_exam_attempts` | 26 | 2026-09-03 | free practice exam funnel |
| `saved_jobs` | 17 | 2026-08-25 | Job Assist usage |
| `chat_history` | 7 | 2026-08-27 | AI tutor turns |
| `subscriptions` | 15 active | — | subscriber state |

The single genuine gap is **navigation**: nothing writes a row when a student
merely opens a screen, so we cannot see which parts of the platform get used,
or where someone stalls without acting.

## Approach

Chosen from three (client beacons / server-side request logging / hybrid).

**Hybrid.** Client beacons capture only what no table records — screen views
and a short allowlist of feature interactions. Everything already in a table is
read from that table at report time.

The governing rule:

> **If a row already exists for it, it is not an event.**

Server-side request logging was rejected because it records API calls rather
than what a student saw: a screen that makes no fetch is invisible, and polling
calls look like engagement. Pure client-side capture of everything was rejected
because it would duplicate `question_responses` and friends into a second,
less trustworthy copy.

## Scope decisions

| Decision | Choice | Rationale |
|---|---|---|
| Anonymous visitors | **Logged-in students only** | The endpoint sits behind `requireAuth`; every event carries a `user_id`. No anonymous identifiers, no bot noise, no public write endpoint. |
| Retention | **90 days raw, then daily rollups** | Bounded table growth, long-run trends preserved, and a real deletion policy from day one. |
| Surfacing | **Daily brief + an admin page in the platform** | The brief for the standing numbers, the page for ad-hoc digging the brief's fixed shape can't answer. |

## 1. Remove the dead tag

Delete `client-v2/index.html:23-29` (the gtag comment, script tag and inline
bootstrap).

The CSP is **not** changed. No `googletagmanager.com` entry, no nonce, no
`'unsafe-inline'` on the authenticated app.

`G-LVH4ZMZJKV` is abandoned in place rather than deleted — no code references
it after this change. `wiki/projects/fsa-agent.md` records that the LMS is
deliberately not GA4-instrumented and why, so the tag does not get re-added
later by someone who notices it missing.

## 2. Schema — `server/migrations/018_usage_events.sql`

```sql
CREATE TABLE usage_events (
  id                bigserial PRIMARY KEY,
  user_id           integer NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  event_type        text NOT NULL,        -- 'screen_view' | 'feature_use'
  screen            text,                 -- route PATTERN, never a raw path
  action            text,                 -- feature name; NULL for screen_view
  props             jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_session_id text,                 -- per-tab uuid; one visit
  occurred_at       timestamptz NOT NULL, -- client-supplied, clamped (see below)
  received_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX usage_events_occurred_idx ON usage_events (occurred_at DESC);
CREATE INDEX usage_events_user_idx     ON usage_events (user_id, occurred_at DESC);

CREATE TABLE usage_events_daily (
  day         date    NOT NULL,
  event_type  text    NOT NULL,
  screen      text    NOT NULL DEFAULT '',  -- '' not NULL, so the PK works
  action      text    NOT NULL DEFAULT '',
  event_count integer NOT NULL,
  user_count  integer NOT NULL,
  PRIMARY KEY (day, event_type, screen, action)
);
```

Design notes, each of which is a decision rather than an accident:

- **`screen` holds the route pattern** (`/lesson/:lessonCode`), never the raw
  path. Raw paths are unbounded cardinality and bury content identifiers in a
  column meant for grouping. The concrete lesson code goes in `props`.
- **No IP, no user agent.** `login_events` already stores both. IP is PII under
  PIPEDA (already flagged in `wiki/projects/fsa-agent.md`); spreading it across
  a second table would double the problem for no analytical gain.
- **`occurred_at` is untrusted.** It comes from the client. On insert, anything
  older than 24 hours or more than 5 minutes in the future is clamped to
  `received_at`, so one device with a wrong clock cannot bend a day's numbers.
- `ON DELETE CASCADE` means deleting a student deletes their events, which is
  the behaviour a deletion request requires.

## 3. Event taxonomy

Two event types, both allowlisted. Anything not on an allowlist is **dropped
server-side and logged, never rejected with a 4xx** — a stale client left over
from a previous deploy must not spray errors.

**`screen_view`** — one per route change, allowlist of the nine authenticated
route patterns in `App.jsx`:

```
/select-paper  /lobby  /jobs  /chapters  /lesson/:lessonCode
/practice-exam  /exam/results  /profile  /credits
```

Deliberately excluded: `/login`, `/signup`, `/setup`, `/forgot-password`,
`/reset-password`, `/jobs/capture`, `/free-practice-exam` (all reachable
without a session — out of scope per the logged-in-only decision), and the new
`/admin/usage` (internal, would pollute its own numbers).

**`feature_use`** — initial allowlist:

```
tutor_chat_opened       lesson_audio_played     results_lesson_expanded
paper_switched          tailoring_started       job_detail_opened
```

**Not events**, because a row already exists: questions answered
(`question_responses`), lessons completed (`user_progress`), exams attempted
(`practice_exam_attempts`), jobs saved (`saved_jobs`), tutor turns
(`chat_history`), credit spends (`credit_transactions`).

## 4. Capture path

### Endpoint

`POST /api/events`, mounted behind **`requireAuth` only** — deliberately *not*
`requireActiveSubscription`. How a lapsed subscriber behaves in the weeks
before they leave is exactly the thing worth being able to see.

- Body: `{ events: [ { type, screen, action, props, session_id, at } ] }`
- Maximum 50 events per batch; a larger batch is a 400.
- Unknown `type`, `screen` or `action` → that event is dropped and counted in a
  single server log line; the request still returns 204.
- Success: `204 No Content`, empty body.

### Rate limiting

`index.js` currently mounts one limiter at `app.use('/api', limiter)`, 300
requests per IP per 15 minutes. A 10-second flush cadence would let beacons
consume a large share of a student's budget and could rate-limit real product
calls.

Therefore:

1. Add `skip: (req) => req.path === '/events'` to the global limiter.
2. Mount a dedicated `eventsLimiter` with `app.use('/api/events',
   eventsLimiter)` **before** the `app.use('/api', limiter)` line, sized for the
   flush cadence (200 batches per IP per 15 minutes). Step 1 already exempts the
   path from the global cap; mounting first is what guarantees a flood of
   beacons is capped by the dedicated limiter rather than reaching the router.

`index.js` already carries a comment explaining why limiter mount order matters
(the `requireLearnHost` ordering fix of 2026-08-16). This change gets an
equivalent comment, because the ordering is again load-bearing.

### Client

- **`client-v2/src/utils/usage.js`** — a module-level queue and a `track(type,
  {screen, action, props})` function. Flushed on a 10-second timer, and on
  `visibilitychange` (to `hidden`) and `pagehide` via `navigator.sendBeacon`
  with a JSON `Blob` (cookies ride along same-origin). Falls back to
  `fetch(..., { keepalive: true, credentials: 'include' })` where `sendBeacon`
  is unavailable. Failures are swallowed: telemetry must never surface an error
  to a student or block a render.
- **`client-v2/src/hooks/useScreenView.js`** — fires `screen_view` on
  `useLocation()` change, resolving the matched pattern rather than the path.
- **Mounting**: once at `App` level. It no-ops unless `fsa_user` is present in
  `localStorage` — the same signal `ProtectedRoute` already uses — so public
  routes stay untracked and full-screen routes that bypass `AppShell`
  (`/lesson/:lessonCode`, `/practice-exam`) are still covered.
- **`client_session_id`**: `crypto.randomUUID()` held in `sessionStorage`, so it
  is per-tab and resets on a new tab. That is the "visit" grain.
- **Transport split, deliberate.** The 10-second timer flush goes through
  `utils/api.js` (`postJson`), per backlog #68's "one way to call the API". The
  unload flush cannot: `api.js` has no beacon path, and a normal fetch during
  `pagehide` is not guaranteed to be sent. So the unload flush calls
  `navigator.sendBeacon` directly. This is the one sanctioned exception to #68
  and is commented as such at the call site.

## 5. Retention

`server/src/scripts/prune_usage_events.js`:

1. Upsert every `usage_events` row older than 90 days into `usage_events_daily`,
   grouped by `(day, event_type, screen, action)`, with `user_count` as the
   distinct `user_id` count **computed before deletion**.
2. Delete those raw rows in batches.

Idempotent: re-running it produces the same rollup rows and finds nothing left
to delete.

Run from the host crontab, following the `device_switch_report.js` precedent
already documented in the wiki. **The crontab line is host state that lives in
no repository** — it must be recorded in `wiki/projects/fsa-agent.md` alongside
the existing one, or a box rebuild silently loses the pruning and the table
grows without bound.

## 6. Admin page

### Auth

`platform_users` has no role column and `/api/admin`'s existing routes are gated
by an `x-admin-api-key` header, which is not something to type into a browser.

New `server/src/middleware/requireAdminUser.js`: run `requireAuth`, then require
`req.user.email` (lowercased) to appear in a comma-separated `ADMIN_EMAILS` in
`fsa-agent/.env`. 403 otherwise. This is identity-based and reuses the session
the owner already has.

`admin.js` applies `requireAdminKey` **per route**, not router-wide, so
`GET /api/admin/usage` slots into the same router behind `requireAdminUser`
without disturbing the two existing API-key routes.

### Endpoint and page

`GET /api/admin/usage?days=N` returns aggregates over the window:

- active learners per day (distinct `user_id` with any event or any activity row)
- screen funnel: views and distinct viewers per `screen`
- feature usage: count and distinct users per `action`
- activity from the existing tables: questions answered and accuracy, lessons
  touched, exams attempted, jobs saved, tutor turns
- per-student recent activity: last login, last screen, last activity

Client route `/admin/usage` in `App.jsx`, rendering the above with a selectable
window. Not wrapped in `ProtectedRoute`'s paper/course requirements, and not
tracked itself.

## 7. Daily brief

`fsa-dashboard/collect_platform_usage.py`, following `collect_job_saves.py`
exactly: same env-var connection shape (`DATABASE_URL` or the
`POSTGRES_HOST_EXTERNAL`/`POSTGRES_PORT_EXTERNAL` fallback to
`localhost:5434`), same `{"error": "..."}` failure convention so one broken
collector never takes down the brief.

Returns, over the last 24 hours unless noted:

- `active_learners_24h`, `active_learners_7d` (distinct students with any event)
- `screen_views_24h` — count and top screens
- `feature_use_24h` — count per action
- `questions_answered_24h` and accuracy
- `lessons_touched_24h`, `exams_attempted_24h`, `tutor_turns_24h`
- `subscribers_active` from `subscriptions`

Registered in `collect.py`'s collector list as `("platform_usage",
collect_platform_usage)`, and rendered as a **Platform Usage** section in
`~/.claude/skills/fsa-daily-brief/SKILL.md`, following the existing convention
that a section with an `error` key renders as *"unavailable (<error>)"* rather
than being omitted.

Reporting both halves — events for screens, existing tables for activity — means
the brief's numbers reconcile against tables that are already trusted.

## 8. Testing

**Server** (jest, `server/package.json` already pins
`POSTGRES_DB=fsa_agent_test POSTGRES_HOST=localhost POSTGRES_PORT=5434`, and
`tests/testPool.js` throws at require time on any other database):

- `POST /api/events` rejects unauthenticated requests with 401
- a valid batch inserts rows with the authenticated `user_id`
- an event whose `type`/`screen`/`action` is off-allowlist is dropped, the rest
  of the batch still inserts, response is still 204
- a batch of 51 is a 400
- `occurred_at` in the future and older than 24h are both clamped to
  `received_at`
- `requireAdminUser` allows an `ADMIN_EMAILS` address and 403s another
- `prune_usage_events.js` rolls up and deletes correctly, and is idempotent on a
  second run

**Client** (vitest):

- `useScreenView` fires once per route change and not at all without `fsa_user`
- the queue batches, flushes on the timer, and flushes on `visibilitychange`
- a failing beacon never throws into the render path

**Cross-repo**: a test asserting the client and server allowlists match, since
they are literals in two places.

## 9. Deploy

Order matters; the database step comes first and is gated by the standing
production-safety rule.

1. `sudo /usr/local/bin/fsa-backup.sh daily` — note the path it prints.
2. Apply `018_usage_events.sql` to `fsa_agent` **and** to `fsa_agent_scratch`.
3. `cd fsa-agent/client-v2 && npm run build`
4. `cd fsa-agent && GITHUB_TOKEN=$(gh auth token) docker compose build api && docker compose up -d api`
   (`GITHUB_TOKEN` is required — `fsa-common` is a private `github:` dependency.)
5. Add `ADMIN_EMAILS` to `fsa-agent/.env`.
6. Add the prune crontab line, and record it in the wiki.
7. Deploy the `fsa-dashboard` collector (host cron, no container).

## 10. Out of scope

- **Anonymous and pre-login tracking** on `learn.*` — the signup funnel,
  `/free-practice-exam` and `/jobs/capture` stay unmeasured by this work.
- **Referrer attribution** for the LMS.
- **A retention policy for `login_events` IPs.** This is a real open PIPEDA
  question already recorded in the wiki. This design does not fix it; it does
  establish the pruning pattern that would make fixing it straightforward.
- **Re-enabling GA4 on the LMS** under any circumstances.
