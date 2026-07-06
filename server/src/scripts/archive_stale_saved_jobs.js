#!/usr/bin/env node
/**
 * archive_stale_saved_jobs.js — moves saved_jobs rows still in status
 * 'saved' to 'archived' once they've sat untouched past a threshold
 * (default 90 days, override via SAVED_JOB_ARCHIVE_DAYS). Only 'saved'
 * rows are eligible; 'applied'/'interviewing' jobs are excluded regardless
 * of age since the candidate may still be mid-process. Reactivating an
 * archived job (marking it applied/interviewing/saved again) needs no
 * new code — PATCH /api/jobs/:id and JobsPage.jsx already allow any
 * status transition.
 *
 * Usage (run inside the api container, WORKDIR /app):
 *   docker exec fsa-agent-api-1 node src/scripts/archive_stale_saved_jobs.js
 *
 * A daily cron entry on the host runs this; see the crontab line added
 * in Task 2 of docs/superpowers/plans/2026-07-05-saved-jobs-auto-archive.md.
 */

const { pool } = require('../services/database');

async function archiveStaleSavedJobs(days) {
  const result = await pool.query(
    `UPDATE saved_jobs
       SET status = 'archived'
     WHERE status = 'saved'
       AND saved_at < now() - ($1 || ' days')::interval
     RETURNING id`,
    [days]
  );
  return result.rows.length;
}

async function main() {
  const days = parseInt(process.env.SAVED_JOB_ARCHIVE_DAYS, 10) || 90;
  const count = await archiveStaleSavedJobs(days);
  console.log(`Archived ${count} saved job(s) older than ${days} days.`);
  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { archiveStaleSavedJobs };
