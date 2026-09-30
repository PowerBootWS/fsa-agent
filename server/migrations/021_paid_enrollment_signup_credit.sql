-- 021: give the free custom-resume credit to every account that never got one.
-- The grant lived only in POST /api/auth/signup; paid accounts are created by
-- POST /api/platform/provision-user, which granted nothing, so every paid
-- student created after migration 011's one-time backfill (13 accounts on
-- 2026-09-30) had no credit. provision-user now grants it too.
--
-- Exact criterion (same as 011): a platform user with no signup_grant row.
-- A user who had the grant and spent it is excluded. Replay-safe: the second
-- run finds every user already granted.

WITH missing AS (
  INSERT INTO credit_transactions (user_id, delta, reason)
  SELECT id, 1, 'signup_grant' FROM platform_users
  WHERE id NOT IN (SELECT user_id FROM credit_transactions WHERE reason = 'signup_grant')
  RETURNING user_id
)
INSERT INTO credit_balances (user_id, balance)
SELECT user_id, 1 FROM missing
ON CONFLICT (user_id) DO UPDATE SET balance = credit_balances.balance + 1, updated_at = now();
