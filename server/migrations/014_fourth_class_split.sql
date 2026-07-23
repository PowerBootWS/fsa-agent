-- 4th Class is now sold as two independently-purchasable annual subscriptions
-- (fourth_a for 4A, fourth_b for 4B) instead of one combined 'fourth' product. A
-- student can hold both simultaneously (bought separately, in either order), which
-- the previous one-active-subscription-per-user constraint (013_fourth_class.sql)
-- doesn't allow.
DROP INDEX IF EXISTS subscriptions_one_active_per_user;

-- One active row per (user, class_code) -- still blocks a duplicate purchase of the
-- SAME product (including the same 4th Class paper twice), no longer blocks
-- fourth_a + fourth_b coexisting (different class_code values). Cross-tier exclusion
-- (2nd/3rd Class vs any 4th Class paper) is enforced in provision-user's application
-- code instead (server/src/routes/platform.js) -- "these two specific values are
-- mutually exclusive with everything else but not with each other" isn't
-- expressible as a single partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_active_per_user_class
  ON subscriptions (user_id, class_code) WHERE status = 'active';
