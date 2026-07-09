-- Sub-project 3 (AI resume/cover-letter tailoring): credit ledger + generated-document
-- records. Ships free/ungated ahead of the Stripe purchase flow (sub-project 2) — every
-- account gets a small free grant here so the feature is usable before real purchases
-- exist. credit_transactions is the source of truth (audit trail); credit_balances is a
-- denormalized running total kept in sync inside the same DB transaction as every debit/grant.

CREATE TABLE IF NOT EXISTS credit_balances (
  user_id     INTEGER PRIMARY KEY REFERENCES platform_users(id) ON DELETE CASCADE,
  balance     INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id                      SERIAL PRIMARY KEY,
  user_id                 INTEGER NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  delta                   INTEGER NOT NULL,
  reason                  TEXT NOT NULL CHECK (reason IN ('signup_grant', 'generation_debit', 'stripe_purchase')),
  generated_document_id   INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS credit_transactions_user_id_idx ON credit_transactions (user_id);

CREATE TABLE IF NOT EXISTS generated_documents (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  saved_job_id        INTEGER NOT NULL REFERENCES saved_jobs(id) ON DELETE CASCADE,
  doc_type            TEXT NOT NULL CHECK (doc_type IN ('resume', 'cover_letter')),
  docx_path           TEXT NOT NULL,
  pdf_path            TEXT NOT NULL,
  changes_summary     TEXT NOT NULL,
  placeholder_count   INTEGER NOT NULL DEFAULT 0,
  model_used          TEXT NOT NULL,
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS generated_documents_user_id_idx ON generated_documents (user_id);
CREATE INDEX IF NOT EXISTS generated_documents_saved_job_id_idx ON generated_documents (saved_job_id);

ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_generated_document_id_fkey
  FOREIGN KEY (generated_document_id) REFERENCES generated_documents(id) ON DELETE SET NULL;

-- One-time backfill: every pre-existing account gets the same 1-credit free starter grant
-- new signups receive going forward (server/src/routes/auth.js, Task 2). Idempotent —
-- safe to re-run.
INSERT INTO credit_balances (user_id, balance)
SELECT id, 1 FROM platform_users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO credit_transactions (user_id, delta, reason)
SELECT id, 1, 'signup_grant' FROM platform_users
WHERE id NOT IN (SELECT user_id FROM credit_transactions WHERE reason = 'signup_grant');
