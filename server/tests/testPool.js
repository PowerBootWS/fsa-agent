const { Pool } = require('pg');

// Fix round 1 (2026-08-17 review): this used to be
// `process.env.POSTGRES_DB || 'fsa_agent_test'`, which meant an UNSET
// POSTGRES_DB passed the guard below. That is backwards from every other
// pool in this codebase — src/services/database.js, src/middleware/
// requireAuth.js and src/routes/admin.js each default to
// `process.env.POSTGRES_DB || 'fsa_agent'` (production). So the old message
// telling a reader to "unset POSTGRES_DB" as a fix, after sourcing
// /home/debian/.env and hitting this guard, would have left THIS pool safely
// on fsa_agent_test while every app pool a test exercises (every router,
// every script under test) stayed on production — e.g.
// archive_stale_saved_jobs.test.js calling archiveStaleSavedJobs(), which
// UPDATEs saved_jobs across every row past the threshold, would have run for
// real. There is no safe default here: POSTGRES_DB must be explicitly set
// and exactly equal to the test database name, full stop.
const RESOLVED_DB = process.env.POSTGRES_DB;

// Second line of defence (2026-08-16, post-mortem on the 2026-08-12 prod wipe).
// Per-file teardown scoping only helps a test file that was actually written
// carefully — it does nothing for the next person who copies an old unscoped
// pattern, or for anyone who runs jest a way other than `npm test` (the common
// habit on this host, `set -a; . /home/debian/.env; set +a`, exports the real
// production POSTGRES_DB and is exactly how August 12th happened). So this
// module refuses to hand out a pool at all — at require() time, before any
// query, before any test runs — unless the resolved database name is
// unambiguously a disposable test database.
//
// Allowlist, not a blocklist of known-bad names: only 'fsa_agent_test' (the
// one name every script in this repo actually uses for tests — see
// package.json's "test" script) is accepted. Anything else, including the
// real 'fsa_agent' database, its 'fsa_agent_scratch' scrubbed copy, an unset
// value, an empty string, or a typo, is refused loudly.
const ALLOWED_TEST_DB = 'fsa_agent_test';

if (RESOLVED_DB !== ALLOWED_TEST_DB) {
  throw new Error(
    `[tests/testPool.js] Refusing to connect: POSTGRES_DB="${RESOLVED_DB}" is not the ` +
    `disposable test database. Tests must run against "${ALLOWED_TEST_DB}" only, set explicitly ` +
    `— there is no safe default.\n` +
    `Use: npm test  (sets POSTGRES_DB=${ALLOWED_TEST_DB} POSTGRES_HOST=localhost POSTGRES_PORT=5434)\n` +
    `If you sourced /home/debian/.env first (e.g. "set -a; . /home/debian/.env; set +a"), that ` +
    `exports the production database name on every app pool this test suite exercises — that is ` +
    `exactly the mistake that wiped ten production tables on 2026-08-12. Export ` +
    `POSTGRES_DB=${ALLOWED_TEST_DB} explicitly before running tests.`
  );
}

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  database: RESOLVED_DB,
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD,
});

module.exports = { pool };
