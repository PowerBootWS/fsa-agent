const { getNewJobsCount, _resetNewJobsCache } = require('../src/services/newJobsCount');

const DAY = 24 * 60 * 60 * 1000;

describe('getNewJobsCount', () => {
  const realFetch = global.fetch;
  beforeEach(() => _resetNewJobsCache());
  afterEach(() => { global.fetch = realFetch; });

  it('counts jobs first seen in the last 7 x 24h, rolling', async () => {
    const now = Date.now();
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [
      { first_seen: new Date(now - 1 * DAY).toISOString() },
      { first_seen: new Date(now - 6.9 * DAY).toISOString() },
      { first_seen: new Date(now - 7.1 * DAY).toISOString() },  // just outside
      { first_seen: null },
      {},
    ] }));
    expect(await getNewJobsCount()).toBe(2);
  });

  it('caches a success so a second call does not refetch', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [] }));
    await getNewJobsCount();
    await getNewJobsCount();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns null on failure and does not throw', async () => {
    global.fetch = jest.fn(async () => { throw new Error('down'); });
    expect(await getNewJobsCount()).toBeNull();
  });
});
