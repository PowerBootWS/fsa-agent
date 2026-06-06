-- platform_users: authenticated students on learn.fullsteamahead.ca
CREATE TABLE IF NOT EXISTS platform_users (
  id                    SERIAL PRIMARY KEY,
  email                 TEXT UNIQUE NOT NULL,
  first_name            TEXT NOT NULL,
  last_name             TEXT NOT NULL,
  password_hash         TEXT,
  current_session_token TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  last_login_at         TIMESTAMPTZ
);

-- subscriptions: tracks active paper and class access
CREATE TABLE IF NOT EXISTS subscriptions (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES platform_users(id),
  class_code            TEXT NOT NULL,  -- 'second' | 'third'
  status                TEXT NOT NULL,  -- 'active' | 'inactive'
  active_paper          TEXT,           -- e.g. '2A1', '3B2' — NULL until first paper picker
  last_paper_switch_at  TIMESTAMPTZ,
  stripe_subscription_id TEXT,
  activated_at          TIMESTAMPTZ DEFAULT NOW(),
  deactivated_at        TIMESTAMPTZ
);

-- auth_tokens: magic links and password reset tokens
CREATE TABLE IF NOT EXISTS auth_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES platform_users(id),
  token      TEXT UNIQUE NOT NULL,
  type       TEXT NOT NULL,        -- 'magic_link' | 'password_reset'
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
