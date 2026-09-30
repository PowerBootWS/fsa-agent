// The one free custom-resume credit every platform account gets, whichever way
// the account was created: free job-only signup (routes/auth.js /signup) or a
// paid enrollment (routes/platform.js /provision-user). Until 2026-09-30 only
// the signup path granted it, so paid students created after the migration-011
// backfill had no credit at all.
//
// Idempotent on the signup_grant row: calling it twice for one user grants once.
async function grantSignupCredit(queryable, userId) {
  const tx = await queryable.query(
    `INSERT INTO credit_transactions (user_id, delta, reason)
     SELECT $1, 1, 'signup_grant'
     WHERE NOT EXISTS (
       SELECT 1 FROM credit_transactions WHERE user_id = $1 AND reason = 'signup_grant'
     )
     RETURNING id`,
    [userId]
  );
  if (tx.rows.length === 0) return false;
  await queryable.query(
    `INSERT INTO credit_balances (user_id, balance) VALUES ($1, 1)
     ON CONFLICT (user_id) DO UPDATE SET balance = credit_balances.balance + 1, updated_at = now()`,
    [userId]
  );
  return true;
}

module.exports = { grantSignupCredit };
