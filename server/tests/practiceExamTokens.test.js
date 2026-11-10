// No database access — pure token sign/verify.
const tokens = require('../src/services/practiceExamTokens');

const claims = { email: 'lead@example.com', classCode: 'fourth_b', paperCode: '4B' };

describe('practiceExamTokens default TTL', () => {
  afterEach(() => jest.useRealTimers());

  it('outlives a full 100-question sitting (3h clock + overrun)', () => {
    jest.useFakeTimers({ now: new Date('2026-11-09T19:22:01-07:00') });
    const token = tokens.sign(claims);
    // 2026-11-09: the old 3h TTL expired 19s after question 99 appeared.
    jest.setSystemTime(new Date('2026-11-09T22:26:42-07:00'));
    expect(tokens.verify(token)).toMatchObject(claims);
    jest.setSystemTime(new Date('2026-11-10T03:00:00-07:00'));
    expect(tokens.verify(token)).toMatchObject(claims);
  });

  it('still expires', () => {
    jest.useFakeTimers({ now: new Date('2026-11-09T19:22:01-07:00') });
    const token = tokens.sign(claims);
    jest.setSystemTime(new Date('2026-11-10T03:23:00-07:00'));
    expect(tokens.verify(token)).toBeNull();
  });
});
