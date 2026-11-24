// Pure unit test: no database.
const { formatLine, redactPath } = require('../src/middleware/requestLog');

const res = { statusCode: 200 };

test('logs method, path, status, duration, user id and Cloudflare ray', () => {
  const req = {
    method: 'GET', originalUrl: '/api/v2/lesson/2A1-1-1',
    user: { id: 42, email: 'student@example.com' },
    headers: { 'cf-ray': '8abc123-YEG', 'cf-ipcountry': 'CA' },
  };
  const line = formatLine(req, res, 123);
  expect(line).toBe('req GET /api/v2/lesson/2A1-1-1 200 123ms user=42 ray=8abc123-YEG cc=CA');
  expect(line).not.toContain('student@example.com');
});

test('never logs the query string', () => {
  const req = { method: 'GET', originalUrl: '/setup?token=SECRETSECRET', headers: {} };
  expect(formatLine(req, res, 5)).toBe('req GET /setup 200 5ms');
});

test('redacts token-bearing path segments', () => {
  expect(redactPath('/explained-media/boiler-foo/3/p/abcDEF123/slide-1.png'))
    .toBe('/explained-media/boiler-foo/3/p/[token]/slide-1.png');
  expect(redactPath('/api/jobs/capture-stash/xyz789')).toBe('/api/jobs/capture-stash/[token]');
  expect(redactPath('/api/auth/verify/' + 'a'.repeat(40))).toBe('/api/auth/verify/[redacted]');
  expect(redactPath('/media/2A1-3-2/slide-003.mp3')).toBe('/media/2A1-3-2/slide-003.mp3');
});
