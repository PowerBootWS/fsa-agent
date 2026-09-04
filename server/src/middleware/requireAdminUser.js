// Identity-based admin gate (backlog #113).
//
// platform_users has no role column, and /api/admin's existing routes are
// gated by an x-admin-api-key header — not something to type into a browser.
// This gate reuses the session the owner already has: requireAuth establishes
// identity, this checks that identity against an allowlist.
//
// Fails closed: an unset or empty ADMIN_EMAILS admits nobody.
module.exports = function requireAdminUser(req, res, next) {
  const allowed = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const email = (req.user?.email || '').trim().toLowerCase();
  if (!email || !allowed.includes(email)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
};
