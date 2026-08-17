const { Pool } = require('pg');

const RESOLVED_DB = process.env.POSTGRES_DB || 'fsa_agent_test';

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
// real 'fsa_agent' database, its 'fsa_agent_scratch' scrubbed copy, an empty/
// unset value resolving to some other default, or a typo, is refused loudly.
const ALLOWED_TEST_DB = 'fsa_agent_test';

if (RESOLVED_DB !== ALLOWED_TEST_DB) {
  throw new Error(
    `[tests/testPool.js] Refusing to connect: POSTGRES_DB="${RESOLVED_DB}" is not the ` +
    `disposable test database. Tests must run against "${ALLOWED_TEST_DB}" only.\n` +
    `Use: npm test  (sets POSTGRES_DB=${ALLOWED_TEST_DB} POSTGRES_HOST=localhost POSTGRES_PORT=5434)\n` +
    `If you sourced /home/debian/.env first (e.g. "set -a; . /home/debian/.env; set +a"), that ` +
    `exports the production database name — that is exactly the mistake that wiped ten ` +
    `production tables on 2026-08-12. Unset POSTGRES_DB or export POSTGRES_DB=${ALLOWED_TEST_DB} explicitly.`
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
