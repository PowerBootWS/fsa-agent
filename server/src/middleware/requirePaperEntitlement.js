// Paper-level entitlement: a subscriber may only open content for papers their
// active class(es) include. requireActiveSubscription alone answers "is this a
// paying student?", not "did they pay for THIS paper?" — before this, a 4th Class
// student ($99/yr) or a 3rd Class student could open any 2nd Class lesson, outline,
// checkpoint or tutor session by changing the code in the URL. Money/student-access
// audit, 2026-10-21. Fails closed: an unknown paper is a 404, an error is a 500.
const { pool } = require('../services/database');
const { PAPERS_BY_CLASS } = require('../config/papersForClass');

const ALL_PAPERS = new Set(Object.values(PAPERS_BY_CLASS).flat());

// Every paper across ALL of the user's live subscriptions. requireAuth exposes
// only one subscription row on req.user, and a student can hold 4A and 4B at once.
async function entitledPapers(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT class_code FROM subscriptions
      WHERE user_id = $1 AND status = 'active' AND (cancel_at IS NULL OR cancel_at > NOW())`,
    [userId]
  );
  return new Set(rows.flatMap(r => PAPERS_BY_CLASS[r.class_code] || []));
}

// '2A1-3-2' / '2A1-3' / '2A1' / a numeric lessons.id -> '2A1'; null if unknown.
async function paperOf(code, db = pool) {
  let s = String(code).trim();
  if (/^\d+$/.test(s)) {
    const r = await db.query('SELECT lesson_code FROM lessons WHERE id = $1', [s]);
    s = (r.rows[0] && r.rows[0].lesson_code) || '';
  }
  const paper = s.split('-')[0].toUpperCase();
  return ALL_PAPERS.has(paper) ? paper : null;
}

function requirePaperEntitlement(getCode, { db } = {}) {
  return async function paperEntitlement(req, res, next) {
    const code = getCode(req);
    // Missing parameter: let the route return its own 400.
    if (code === undefined || code === null || code === '') return next();
    try {
      const paper = await paperOf(code, db || pool);
      if (!paper) return res.status(404).json({ error: 'Not found' });
      const papers = await entitledPapers(req.user && req.user.id, db || pool);
      if (!papers.has(paper)) {
        return res.status(403).json({ error: 'This content is not part of your course.' });
      }
      return next();
    } catch (err) {
      console.error('paper entitlement check failed:', err.message);
      return res.status(500).json({ error: 'Could not check access' });
    }
  };
}

module.exports = { requirePaperEntitlement, entitledPapers, paperOf };
