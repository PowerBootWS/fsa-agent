// Entitlement gate, distinct from requireAuth (identity only). requireAuth was
// loosened (LEFT JOIN) so job-only accounts with zero subscription rows can
// authenticate — this middleware is what keeps paid content (lessons, AI tutor,
// v2 course/session/progress/checkpoint) restricted to an actual active,
// non-cancelled subscriber. Apply after platformAuth/requireAuth on any route
// group that gates paid content; never assume requireAuth alone means "paid."
module.exports = function requireActiveSubscription(req, res, next) {
  if (!req.isPlatformMode) return next(); // legacy iframe mode has no auth at all; unchanged
  if (!req.user || !req.user.subscription_id) {
    return res.status(403).json({ error: 'An active subscription is required to access this content.' });
  }
  next();
};
