-- Free Practice Exam verification-gated attempts. Deliberately separate
-- from platform_users/subscriptions (see migration 006 auth tables) —
-- keeps free/unverified leads decoupled from the paying-student schema.
-- Replaces the naive "any question_responses row for this email" reuse
-- check in preview.js with a real once-per-(email,paper)-ever gate,
-- enforced by 6-digit email verification rather than a bare email field.

CREATE TABLE IF NOT EXISTS practice_exam_attempts (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  class_code VARCHAR(10) NOT NULL,
  paper_code VARCHAR(10) NOT NULL,
  verification_code VARCHAR(6) NOT NULL,
  code_expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (email, paper_code)
);

CREATE INDEX IF NOT EXISTS idx_practice_exam_attempts_email
  ON practice_exam_attempts (email);
