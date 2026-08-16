'use strict';

// Reject API traffic that did not arrive on the platform hostname.
//
// The retired fsachat.fullsteamahead.ca route is still live in the Cloudflare
// Tunnel and lands on this container. Rather than trusting every future route
// to remember its own auth, refuse the whole /api surface on any host that is
// not an allow-listed host. 421 Misdirected Request is the accurate status:
// the request reached a server that is not configured to answer for that
// authority.
//
// Fix round 1 (2026-08-16 review): the brief's original `host.includes(...)`
// check is REPLACED with a normalised exact-match allowlist, per the
// reviewer's ruling:
//   - `.includes()` admits forged hosts that merely contain the domain as a
//     substring (`learn.fullsteamahead.ca.evil.com`, `xlearn.fullsteamahead.ca`,
//     `evil.com?x=learn.fullsteamahead.ca`) and wrongly refuses the
//     RFC 7230-legal uppercase form (`LEARN.FULLSTEAMAHEAD.CA`), because Host
//     comparison must be case-insensitive.
//   - `fsa-webhook-listener` calls this API service-to-service over the
//     shared `cloudflare` Docker network at `FSA_AGENT_INTERNAL_URL` (see
//     /home/debian/.env), and its `fetch()` calls do not set a Host header,
//     so undici sends the container hostname `fsa-agent-api-1:3000` as Host.
//     That is a real, verified caller (stripe.js: provision-user,
//     credits/grant-purchase, deactivate-user) and must be allow-listed or
//     new-student provisioning, credit grants, and deactivation on
//     cancellation all silently break.
//   - fsa-dashboard (`PLATFORM_BASE_URL=https://learn.fullsteamahead.ca`),
//     fsa-overwatch (hits only the exempt `/health`), and ai-service (makes
//     no calls back into this API) need no entry — confirmed by grep, not
//     assumed.
//
// Fix round 2 (2026-08-16 re-review): `localhost` was removed from the
// allowlist. It was added on a guess ("local/host-side testing and tooling")
// with no verified caller — the exact mistake this allowlist exists to
// avoid. `Host` is client-supplied, so any allow-listed value is a
// permanent hole for whatever unauthenticated route gets mounted next.
// Nothing in fsa-webhook-listener, fsa-dashboard, fsa-overwatch, ai-service,
// docker-compose.yml (no healthcheck), or the three named Jest suites sends
// `Host: localhost` to `/api` — verified by grep, not assumed. This project's
// own infrastructure rules also say never to test via localhost; only the
// public URL through the Cloudflare Tunnel is real traffic.

const LEARN_DOMAIN = (process.env.LEARN_DOMAIN || 'learn.fullsteamahead.ca').toLowerCase();

// Container hostname fsa-webhook-listener's fetch() calls send as Host when
// calling FSA_AGENT_INTERNAL_URL=http://fsa-agent-api-1:3000 (see /home/debian/.env:108).
// Host comparison strips the port before matching, so the port is not listed here.
const INTERNAL_SERVICE_HOST = 'fsa-agent-api-1';

const ALLOWED_HOSTS = new Set([LEARN_DOMAIN, INTERNAL_SERVICE_HOST]);

module.exports = function requireLearnHost(req, res, next) {
  const rawHost = req.headers.host || '';
  // Strip the port and lowercase before comparing — Host is case-insensitive
  // per RFC 7230, and internal callers include a port (":3000") that must not
  // be part of the match.
  const hostname = rawHost.toLowerCase().split(':')[0];
  if (ALLOWED_HOSTS.has(hostname)) return next();
  console.warn(`[host-guard] refused ${req.method} ${req.originalUrl} for host "${rawHost}"`);
  return res.status(421).json({ error: 'Wrong host' });
};
