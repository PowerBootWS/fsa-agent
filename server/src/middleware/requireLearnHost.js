'use strict';

// Reject API traffic that did not arrive on the platform hostname.
//
// The retired fsachat.fullsteamahead.ca route is still live in the Cloudflare
// Tunnel and lands on this container. Rather than trusting every future route
// to remember its own auth, refuse the whole /api surface on any host that is
// not the platform host. 421 Misdirected Request is the accurate status: the
// request reached a server that is not configured to answer for that authority.

const LEARN_DOMAIN = process.env.LEARN_DOMAIN || 'learn.fullsteamahead.ca';

module.exports = function requireLearnHost(req, res, next) {
  const host = req.headers.host || '';
  if (host.includes(LEARN_DOMAIN)) return next();
  console.warn(`[host-guard] refused ${req.method} ${req.originalUrl} for host "${host}"`);
  return res.status(421).json({ error: 'Wrong host' });
};
