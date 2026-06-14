-- Adds client IP + user agent capture to login_events for account-sharing review.
-- Populated on each login (normal + magic-link setup) from the CF-Connecting-IP
-- header (real visitor IP behind the Cloudflare Tunnel), falling back to req.ip.
-- Forward-only: rows written before this migration stay NULL — IPs for past
-- logins cannot be recovered. Both columns nullable; a missing header never
-- blocks a login. IPs are PII (PIPEDA) — see scripts/login_audit.js for the
-- on-demand review tool; retention pruning is a future consideration.
ALTER TABLE login_events ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE login_events ADD COLUMN IF NOT EXISTS user_agent text;
