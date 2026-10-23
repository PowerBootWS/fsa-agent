-- 032: When a student schedules a cancellation in the Stripe billing portal
-- (2026-10-22). Informational only: access is NOT driven by this column.
-- subscriptions.cancel_at still controls access, and is only set when Stripe
-- actually ends the subscription, through the deactivation confirmation gate.
-- Set and cleared by fsa-webhook-listener on customer.subscription.updated.
-- Replay-safe.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_scheduled_at TIMESTAMPTZ;
