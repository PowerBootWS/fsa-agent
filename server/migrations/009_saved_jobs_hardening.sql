-- Minor hardening from the Job Search Dashboard Foundation final review:
-- index the FK column actually queried on (every "list this user's saved jobs"
-- query filters by user_id; user_documents already gets this for free as the
-- leftmost column of its UNIQUE(user_id, doc_type) index, but saved_jobs had
-- no supporting index at all), and make both FKs cascade so a future hard
-- delete of a platform_users row doesn't orphan-block on these tables.
CREATE INDEX IF NOT EXISTS saved_jobs_user_id_idx ON saved_jobs (user_id);

ALTER TABLE saved_jobs DROP CONSTRAINT saved_jobs_user_id_fkey;
ALTER TABLE saved_jobs ADD CONSTRAINT saved_jobs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES platform_users(id) ON DELETE CASCADE;

ALTER TABLE user_documents DROP CONSTRAINT user_documents_user_id_fkey;
ALTER TABLE user_documents ADD CONSTRAINT user_documents_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES platform_users(id) ON DELETE CASCADE;
