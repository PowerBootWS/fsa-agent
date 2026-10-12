-- 023: chat_history.updated_at (backlog #116).
-- chat_history is one row per (user_email, lesson_id), upserted with
-- ON CONFLICT ... DO UPDATE SET messages = ..., so created_at only says when a
-- conversation began. updated_at says when it last had a turn, which is what
-- "how much tutoring happened this week" needs. Maintained by a trigger rather
-- than in the upserts because two writers exist (server/src/services/database.js
-- and ai-service/agents/researcher.py) and a trigger cannot be forgotten by a
-- third. Existing rows start at created_at: their last turn is unknowable.
-- Replay-safe.

ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;
UPDATE chat_history SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE chat_history ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE chat_history ALTER COLUMN updated_at SET NOT NULL;

CREATE OR REPLACE FUNCTION chat_history_touch_updated_at() RETURNS trigger AS $$
BEGIN
  IF NEW.messages IS DISTINCT FROM OLD.messages THEN
    NEW.updated_at := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_history_touch_updated_at ON chat_history;
CREATE TRIGGER chat_history_touch_updated_at
  BEFORE UPDATE ON chat_history
  FOR EACH ROW EXECUTE FUNCTION chat_history_touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_chat_history_updated_at ON chat_history (updated_at);
