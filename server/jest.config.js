module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // All server test files share one fsa_agent_test database and each does
  // unconditional DELETEs in afterEach — running suites in parallel would let
  // them stomp each other. --runInBand in package.json's test script already
  // enforces this, but that only helps when the script is actually used; this
  // makes the guarantee travel with the harness regardless of how jest is invoked.
  maxWorkers: 1,
};
