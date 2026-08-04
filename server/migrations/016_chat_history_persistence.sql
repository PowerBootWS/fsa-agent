-- chat_history has never been written to by any code path (dead since the
-- initial commit — the client never called POST /api/chat-history, and
-- ai-service kept its conversation transcript purely in-memory). Fixing the
-- write path (ai-service periodic save, matching user_progress) needs a
-- per-user-per-lesson row to upsert into, same pattern as user_progress.
ALTER TABLE chat_history
  ADD CONSTRAINT uq_chat_history_user_lesson UNIQUE (user_email, lesson_id);
