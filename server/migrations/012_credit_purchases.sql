-- Sub-project 2 (Credits & Purchases): adds what's needed to let a logged-in account buy a
-- one-time credit pack via Stripe Checkout. No Stripe Customer ID exists anywhere in the
-- schema today (confirmed: platform_users has no Stripe fields; the only existing linkage
-- is subscriptions.stripe_subscription_id, which a job-only account with no course
-- subscription won't have) -- a one-time purchase needs its own Customer so repeat
-- purchases reuse the same Stripe Customer object rather than creating a new anonymous one
-- every time.
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Idempotency guard against Stripe's at-least-once webhook delivery: a given Checkout
-- Session can produce at most one credit grant. Partial (WHERE stripe_session_id IS NOT
-- NULL) so existing signup_grant/generation_debit rows, which have no session ID, are
-- unaffected.
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_stripe_session_id_idx
  ON credit_transactions (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
