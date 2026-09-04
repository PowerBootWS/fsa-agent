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
