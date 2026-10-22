-- 029: Student goals and the commitment memory (backlog #139 phase 2, 2026-10-22).
-- Spec: docs/superpowers/specs/2026-10-22-student-goals-design.md (root repo).
-- Replay-safe.

-- One row per student who has been invited. invite_status records the answer
-- to "Want a hand setting a goal?"; the goal fields fill in once they say yes.
CREATE TABLE IF NOT EXISTS coaching_profiles (
  user_id          INTEGER PRIMARY KEY REFERENCES platform_users(id) ON DELETE CASCADE,
  invite_status    TEXT NOT NULL DEFAULT 'pending'
                     CHECK (invite_status IN ('pending', 'later', 'declined', 'accepted')),
  invite_snoozed_until TIMESTAMPTZ,
  paper            TEXT,
  target_date      DATE,          -- the exam date, or the 1st of the month when only a month is known
  date_is_exact    BOOLEAN NOT NULL DEFAULT false,
  exam_booked      BOOLEAN NOT NULL DEFAULT false,
  shift_pattern    TEXT,
  shift_other      TEXT,
  study_places     TEXT[] NOT NULL DEFAULT '{}',
  weekly_sessions  SMALLINT CHECK (weekly_sessions BETWEEN 1 AND 14),
  best_exam_pct    JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {paper: best practice-exam %}
  wins_checked_at  TIMESTAMPTZ,
  goal_set_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The commitment memory. Each row is one dated thing to follow up on. The
-- hourly job (src/scripts/coaching_due.js) reads only open rows that are due.
CREATE TABLE IF NOT EXISTS coaching_commitments (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('book_exam', 'exam_date', 'weekly_sessions', 'custom')),
  detail      TEXT NOT NULL,
  due_at      TIMESTAMPTZ NOT NULL,
  check_type  TEXT NOT NULL CHECK (check_type IN ('platform', 'ask')),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'kept', 'missed', 'closed')),
  source      TEXT NOT NULL CHECK (source IN ('goal_form', 'email_reply', 'russ', 'text')),
  created_by  TEXT,
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- asked_at, emailed_at, answer, ...
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_coaching_commitments_due
  ON coaching_commitments (due_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_coaching_commitments_user
  ON coaching_commitments (user_id, created_at DESC);

-- One-way "From Russ" messages shown on Home to students who set a goal.
-- `answers` lists the buttons for a question (e.g. booked yet?); null = plain note.
CREATE TABLE IF NOT EXISTS coaching_messages (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('commitment', 'win', 'weekly', 'reply')),
  body          TEXT NOT NULL,
  answers       JSONB,
  commitment_id INTEGER REFERENCES coaching_commitments(id) ON DELETE SET NULL,
  dedupe_key    TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + interval '14 days',
  seen_at       TIMESTAMPTZ,
  answer        TEXT
);
CREATE INDEX IF NOT EXISTS idx_coaching_messages_user
  ON coaching_messages (user_id, created_at DESC);
