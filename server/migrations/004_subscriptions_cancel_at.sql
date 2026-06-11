-- Adds cancel_at to subscriptions table.
-- When a subscription is canceled immediately in Stripe but the customer has paid
-- through a future date, the webhook handler sets cancel_at = current_period_end
-- rather than deactivating immediately. requireAuth gates access on this field,
-- and the /api/platform/expire-grace-periods endpoint (called daily by cloud routine)
-- finalises the deactivation once cancel_at passes.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at TIMESTAMP WITH TIME ZONE;
