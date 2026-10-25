const affiliateClient = require('../src/services/affiliateClient');

describe('affiliateClient', () => {
  const originalEnv = process.env;
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env = { ...originalEnv, AFFILIATE_INTERNAL_URL: 'http://aff.test', AFFILIATE_INTERNAL_SECRET: 's3cret' };
  });
  afterEach(() => { process.env = originalEnv; global.fetch = realFetch; });

  it('getSummary sends the secret and the encoded email', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ is_affiliate: false }) }));
    expect(await affiliateClient.getSummary('a+b@example.com')).toEqual({ is_affiliate: false });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('http://aff.test/internal/affiliates/summary?email=a%2Bb%40example.com');
    expect(opts.headers['x-affiliate-secret']).toBe('s3cret');
  });

  it('getSummary returns null on a non-2xx, a network error, or missing config', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(await affiliateClient.getSummary('x@example.com')).toBeNull();
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    expect(await affiliateClient.getSummary('x@example.com')).toBeNull();
    delete process.env.AFFILIATE_INTERNAL_URL;
    expect(await affiliateClient.getSummary('x@example.com')).toBeNull();
  });

  it('getSummary gives up after the timeout instead of hanging', async () => {
    global.fetch = jest.fn((url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const started = Date.now();
    expect(await affiliateClient.getSummary('slow@example.com')).toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('join posts source in_app and returns the service body', async () => {
    const body = { affiliate: { id: 1, code: 'SAM1234', status: 'active' }, created: true };
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => body }));
    expect(await affiliateClient.join({ name: 'Sam Lee', email: 'sam@example.com' })).toEqual(body);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('http://aff.test/internal/affiliates/create');
    expect(JSON.parse(opts.body)).toEqual({ name: 'Sam Lee', email: 'sam@example.com', source: 'in_app' });
  });

  it('join throws on a non-2xx', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 400, text: async () => 'bad' }));
    await expect(affiliateClient.join({ name: 'X', email: 'x@example.com' })).rejects.toThrow(/400/);
  });
  it('getDashboard returns null when the service times out', async () => {
    global.fetch = jest.fn((url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    expect(await affiliateClient.getDashboard('slow@example.com')).toBeNull();
  });

  it('getDashboard returns null on a 500', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(await affiliateClient.getDashboard('x@example.com')).toBeNull();
  });

  it('getDashboard sends the secret and the encoded email', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ is_affiliate: false }) }));
    expect(await affiliateClient.getDashboard('a+b@example.com')).toEqual({ is_affiliate: false });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('http://aff.test/internal/affiliates/dashboard?email=a%2Bb%40example.com');
    expect(opts.headers['x-affiliate-secret']).toBe('s3cret');
  });

  it('createDiscountCode returns status and body for a 429', async () => {
    const body = { error: 'You can generate up to 3 codes a day. Try again tomorrow.' };
    global.fetch = jest.fn(async () => ({ ok: false, status: 429, json: async () => body }));
    expect(await affiliateClient.createDiscountCode('x@example.com')).toEqual({ status: 429, body });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('http://aff.test/internal/affiliates/discount-codes');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ email: 'x@example.com' });
  });

  it('createDiscountCode throws on a network failure', async () => {
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    await expect(affiliateClient.createDiscountCode('x@example.com')).rejects.toThrow(/ECONNREFUSED/);
  });
});
