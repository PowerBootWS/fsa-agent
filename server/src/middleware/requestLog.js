// One line per request, written when the response finishes, so the support
// fix agent (fsa-customer-support logs.sh api) can see slow or failing pages.
// Before this the api logged nothing per request, and a "the site is slow"
// report (2026-11-16) could not be diagnosed from the server at all.
//
// Logged: method, path WITHOUT the query string (setup/login links carry
// tokens there), status, duration, platform user id (never the email),
// Cloudflare ray id and country. Token-bearing path segments are redacted.

// Lesson session ids are kept so one session can be followed through the log:
// they are not credentials (the session routes check the id belongs to the
// signed-in student, student-access audit 2026-10-21).
const KEEP_ID = /^\/api\/v2\/session\/[0-9a-f-]{36}$/i;

function redactPath(p) {
  if (KEEP_ID.test(p)) return p;
  return p
    // /explained-media/<slug>/<ver>/p/<token>/<file>
    .replace(/\/p\/[^/]+\//, '/p/[token]/')
    // /api/jobs/capture-stash/<token>
    .replace(/(\/capture-stash\/)[^/]+/, '$1[token]')
    // any other long opaque segment (tokens, hashes)
    .replace(/\/[A-Za-z0-9_-]{32,}(?=\/|$)/g, '/[redacted]');
}

function formatLine(req, res, ms) {
  const parts = [
    'req',
    req.method,
    redactPath((req.originalUrl || req.url || '').split('?')[0]),
    res.statusCode,
    `${ms}ms`,
  ];
  if (req.user && req.user.id) parts.push(`user=${req.user.id}`);
  const ray = req.headers['cf-ray'];
  if (ray) parts.push(`ray=${ray}`);
  const country = req.headers['cf-ipcountry'];
  if (country) parts.push(`cc=${country}`);
  return parts.join(' ');
}

function requestLog(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number((process.hrtime.bigint() - start) / 1000000n);
    console.log(formatLine(req, res, ms));
  });
  next();
}

module.exports = requestLog;
module.exports.formatLine = formatLine;
module.exports.redactPath = redactPath;
