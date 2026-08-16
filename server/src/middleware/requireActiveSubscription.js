// Entitlement gate, distinct from requireAuth (identity only). requireAuth was
// loosened (LEFT JOIN) so job-only accounts with zero subscription rows can
// authenticate — this middleware is what keeps paid content (lessons, AI tutor,
// v2 course/session/progress/checkpoint) restricted to an actual active,
// non-cancelled subscriber. Apply after requireAuth on any route group that
// gates paid content; never assume requireAuth alone means "paid."
module.exports = function requireActiveSubscription(req, res, next) {
  // Was: if (!req.isPlatformMode) return next();
  // The entitlement gate fell open on exactly the same Host-header condition as
  // requireAuth, so both layers opened together for any non-platform host. A
  // subscription check that a request header can switch off is not a check.
  if (!req.user || !req.user.subscription_id) {
    return res.status(403).json({ error: 'An active subscription is required to access this content.' });
  }
  next();
};
