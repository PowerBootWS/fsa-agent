module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // All server test files share one fsa_agent_test database. Teardown deletes
  // are now scoped to each file's own fixtures (2026-08-17 — see
  // tests/fixtureCleanup.js and tests/testPool.js), but several suites still
  // assert on table-wide state (e.g. archive_stale_saved_jobs.test.js,
  // sync_saved_job_status.test.js — see the notes in those files) or share a
  // fixture domain across files, so running suites in parallel would still let
  // them interleave and stomp each other. --runInBand in package.json's test
  // script already enforces serial execution, but that only helps when the
  // script is actually used; this makes the guarantee travel with the harness
  // regardless of how jest is invoked.
  maxWorkers: 1,
};
