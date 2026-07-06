-- saved_jobs content rework: capture the AI summary and employer logo at
-- save time (description_snapshot already existed from migration 008 but,
-- like these, was never actually populated by the real save flow until
-- this round — see Task 5/the fsa-website change), and track the source
-- posting's last-known status so the saved-jobs page can show a "Closed"
-- badge / swap the apply link without depending on the source surviving.
ALTER TABLE saved_jobs ADD COLUMN IF NOT EXISTS ai_summary_snapshot TEXT;
ALTER TABLE saved_jobs ADD COLUMN IF NOT EXISTS employer_logo_url_snapshot TEXT;
ALTER TABLE saved_jobs ADD COLUMN IF NOT EXISTS source_status TEXT;
ALTER TABLE saved_jobs ADD COLUMN IF NOT EXISTS source_status_checked_at TIMESTAMPTZ;
