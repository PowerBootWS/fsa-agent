-- user_documents: current resume/cover letter on file per user (no version history —
-- a new upload replaces the row and the old file is deleted from disk by the route handler)
CREATE TABLE IF NOT EXISTS user_documents (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES platform_users(id),
  doc_type          TEXT NOT NULL CHECK (doc_type IN ('resume', 'cover_letter')),
  original_filename TEXT NOT NULL,
  storage_path      TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  uploaded_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, doc_type)
);

-- saved_jobs: candidate's tracked postings. Snapshots title/company/description at save
-- time so the record stays readable after fsa-jobs-bot marks the source posting closed —
-- no runtime dependency on that data surviving.
CREATE TABLE IF NOT EXISTS saved_jobs (
  id                     SERIAL PRIMARY KEY,
  user_id                INTEGER NOT NULL REFERENCES platform_users(id),
  source_job_id          TEXT,           -- fsa-jobs-bot's job_id; NULL for manually-pasted postings
  title                  TEXT NOT NULL,
  company                TEXT,
  location               TEXT,
  job_class_label        TEXT,           -- free text from fsa-jobs-bot (e.g. '2nd Class', 'Other') — see Global Constraints
  url                    TEXT NOT NULL,
  description_snapshot   TEXT,
  posted_at              TEXT,           -- original posting date if the source supplied one; stored as TEXT
                                          -- because fsa-jobs-bot's own date_posted is an unreliable, often-empty
                                          -- string with no guaranteed format — casting to DATE could fail on ingest
  status                 TEXT NOT NULL DEFAULT 'saved'
                         CHECK (status IN ('saved', 'applied', 'interviewing', 'archived')),
  notes                  TEXT,
  saved_at               TIMESTAMPTZ DEFAULT NOW(),
  applied_at             TIMESTAMPTZ,
  interview_flagged_at   TIMESTAMPTZ
);
