#!/usr/bin/env node
/**
 * sync_saved_job_status.js — refreshes saved_jobs.source_status by checking
 * each saved job's source posting against fsa-jobs-bot's public API (the
 * same GET /jobs/<id> endpoint jobs.html itself calls). Lets the saved-jobs
 * page show a "Closed" badge / swap the apply link for a static message
 * once a posting stops being active, without depending on the source
 * surviving (fsa-jobs-bot never deletes rows, only changes status, but
 * this script tolerates a missing/failed row gracefully either way).
 *
 * Only 'saved'/'applied'/'interviewing' rows with a source_job_id are
 * checked — already-archived rows are skipped (no user-facing reason to
 * keep refreshing their status), and manually-pasted jobs (no
 * source_job_id) have nothing to check against.
 *
 * Usage (run inside the api container, WORKDIR /app):
 *   docker exec fsa-agent-api-1 node src/scripts/sync_saved_job_status.js
 *
 * A daily cron entry on the host runs this at 08:15, after fsa-jobs-bot's
 * own 07:30 URL health check has updated its own status column.
 */

const axios = require('axios');
const { pool } = require('../services/database');

const JOBS_API_BASE = process.env.JOBS_API_BASE_URL || 'https://jobs-api.fullsteamahead.ca';

async function syncSavedJobStatuses() {
  const { rows } = await pool.query(
    `SELECT id, source_job_id FROM saved_jobs
      WHERE source_job_id IS NOT NULL
        AND status IN ('saved', 'applied', 'interviewing')`
  );

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const res = await axios.get(`${JOBS_API_BASE}/jobs/${encodeURIComponent(row.source_job_id)}`, { timeout: 10000 });
      await pool.query(
        `UPDATE saved_jobs SET source_status = $1, source_status_checked_at = now() WHERE id = $2`,
        [res.data.status || null, row.id]
      );
      updated += 1;
    } catch (err) {
      failed += 1;
      console.error(`sync_saved_job_status: failed for saved_jobs.id=${row.id} (source_job_id=${row.source_job_id}): ${err.message}`);
    }
  }

  return { checked: rows.length, updated, failed };
}

async function main() {
  const result = await syncSavedJobStatuses();
  console.log(`Checked ${result.checked} saved job(s): ${result.updated} updated, ${result.failed} failed.`);
  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { syncSavedJobStatuses };
