-- Migration v4: add last_name to users table

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
