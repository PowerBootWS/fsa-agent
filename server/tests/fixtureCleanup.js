/**
 * Shared teardown helper for server/tests/*.test.js.
 *
 * Every suite that creates platform_users fixtures must clean up scoped to
 * ONLY the rows it created — never an unscoped DELETE. See
 * tests/mediaAuth.test.js and tests/idorRoutes.test.js for the pattern this
 * generalizes, and CLAUDE.md for why: on 2026-08-12 an unscoped
 * `DELETE FROM platform_users` (and friends) teardown wiped ten production
 * tables when a suite ran against POSTGRES_DB=fsa_agent (prod).
 *
 * Convention: give every fixture email in a file a distinct, file-scoped
 * prefix ending in '@example.com' (a domain no real FSA account ever uses),
 * e.g. 'requireauth-jobonly@example.com', and pass
 * `'<prefix>-%@example.com'` here as emailLikePattern.
 *
 * Deletes child rows that do NOT cascade from platform_users (auth_tokens,
 * subscriptions, login_events — none of their FKs are ON DELETE CASCADE, so
 * deleting platform_users first would just fail with a FK violation) before
 * deleting the platform_users rows themselves. Tables that DO cascade from
 * platform_users (credit_balances, credit_transactions, saved_jobs,
 * user_documents, generated_documents) clean up automatically once the
 * owning user row goes and need no explicit statement here. Also deletes the
 * fixture users' question_responses and assessment_attempts (keyed by email).
 */
async function deleteFixtureUsersByEmailLike(pool, emailLikePattern) {
  if (!emailLikePattern || !emailLikePattern.includes('@example.com')) {
    throw new Error(
      `deleteFixtureUsersByEmailLike: emailLikePattern "${emailLikePattern}" must target the ` +
      `@example.com fixture domain — refusing to run a teardown that could match a real account.`
    );
  }
  await pool.query(
    `DELETE FROM auth_tokens WHERE user_id IN (SELECT id FROM platform_users WHERE email LIKE $1)`,
    [emailLikePattern]
  );
  await pool.query(
    `DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM platform_users WHERE email LIKE $1)`,
    [emailLikePattern]
  );
  await pool.query(
    `DELETE FROM login_events WHERE user_id IN (SELECT id FROM platform_users WHERE email LIKE $1)`,
    [emailLikePattern]
  );
  // Keyed by email, not by an FK to platform_users. Since migration 034
  // (2026-11-10) deleting a fixture question no longer cascades to its
  // answers (question_id is ON DELETE SET NULL), so answers must be removed
  // explicitly; deleting the attempts cascades to any still linked to them.
  await pool.query(`DELETE FROM question_responses WHERE user_email LIKE $1`, [emailLikePattern]);
  await pool.query(`DELETE FROM assessment_attempts WHERE user_email LIKE $1`, [emailLikePattern]);
  await pool.query(`DELETE FROM platform_users WHERE email LIKE $1`, [emailLikePattern]);
}

module.exports = { deleteFixtureUsersByEmailLike };
