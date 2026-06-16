-- Adds device classification + session-displacement capture to login_events so
-- we can measure how often students switch between mobile and desktop (which,
-- under single-session enforcement, bumps the other device).
--
--   device_type              — coarse class from the user agent: 'mobile' |
--                              'tablet' | 'desktop' | 'unknown'. Not a
--                              fingerprint; full user_agent is already stored.
--   displaced_active_session — true when this login overwrote a still-active
--                              session token (i.e. another device got signed
--                              out). false = the prior session had already been
--                              logged out / cleared. NULL for onboarding/unknown.
--
-- Forward-only: rows written before this migration stay NULL. Both nullable;
-- capture is best-effort and never blocks a login. Report:
-- scripts/device_switch_report.js
ALTER TABLE login_events ADD COLUMN IF NOT EXISTS device_type text;
ALTER TABLE login_events ADD COLUMN IF NOT EXISTS displaced_active_session boolean;
