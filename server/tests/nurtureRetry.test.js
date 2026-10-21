// Audit 2026-10-21: nurture.enroll made one attempt, so any nurture restart
// dropped the enrolment silently (4 of 62 verified practice-exam leads lost).
const nurture = require('../src/services/nurture');

const ok = () => ({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' });
const status = (s) => ({ ok: false, status: s, json: async () => ({}), text: async () => 'nope' });

describe('nurture.enroll retries', () => {
  const saved = { ...process.env };
  let warn;
  beforeEach(() => {
    process.env.NURTURE_URL = 'https://nurture.test';
    process.env.NURTURE_INTAKE_KEY = 'k';
    process.env.NURTURE_RETRY_DELAYS_MS = '1,1,1';
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { process.env = { ...saved }; warn.mockRestore(); delete global.fetch; });

  test('a network error then success enrols on the retry', async () => {
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(ok());
    await expect(nurture.enroll({ email: 'a@b.c', sequence: 'practice_exam' })).resolves.toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('a 503 is retried', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(status(503)).mockResolvedValueOnce(ok());
    await nurture.enroll({ email: 'a@b.c', sequence: 'exam' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('a 400 is not retried', async () => {
    global.fetch = jest.fn().mockResolvedValue(status(400));
    await expect(nurture.enroll({ email: 'a@b.c', sequence: 'x' })).rejects.toThrow(/400/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('gives up after the last retry and throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed'));
    await expect(nurture.enroll({ email: 'a@b.c', sequence: 'x' })).rejects.toThrow(/fetch failed/);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  test('missing config throws instead of skipping quietly', async () => {
    delete process.env.NURTURE_URL;
    await expect(nurture.enroll({ email: 'a@b.c', sequence: 'x' })).rejects.toThrow(/not set/);
  });
});
