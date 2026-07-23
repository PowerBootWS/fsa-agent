-- 4th Class platform integration (see
-- docs/superpowers/specs/2026-07-13-fourth-class-platform-integration-design.md).
--
-- subscriptions.class_code gains a third informal value, 'fourth' -- enforced only by
-- application logic, same as 'second'/'third' today (no CHECK constraint exists to update).
--
-- Closes a latent gap: provision-user's "already has an active subscription" guard was
-- scoped to (user_id, class_code), not user_id alone, so nothing ever prevented two
-- simultaneous active subscriptions rows for the same user under different class_codes.
-- requireAuth.js's LEFT JOIN ... WHERE status='active' assumes exactly one active row and
-- picks arbitrarily if more than one exists. 4th Class must be mutually exclusive with a
-- 2nd/3rd Class subscription, so make the one-active-subscription-per-user invariant a real
-- DB constraint instead of an assumption.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_active_per_user
  ON subscriptions (user_id) WHERE status = 'active';
