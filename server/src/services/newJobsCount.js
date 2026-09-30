// "N new postings in the last 7 days" for the Home page. Rolling window
// (now minus 7x24h), not a calendar week. Counts fsa-jobs-bot's public
// /jobs list by first_seen. Cached in-process: 10 minutes on success, 60
// seconds on failure so a down jobs API doesn't slow every Home load.

const JOBS_API_BASE = process.env.JOBS_API_BASE_URL || 'https://jobs-api.fullsteamahead.ca';
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SUCCESS_TTL_MS = 10 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;
const TIMEOUT_MS = 2000;

let cache = null; // { value, expiresAt }

async function getNewJobsCount() {
  const now = Date.now();
  if (cache && now < cache.expiresAt) return cache.value;
  try {
    const res = await fetch(`${JOBS_API_BASE}/jobs`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`jobs api ${res.status}`);
    const jobs = await res.json();
    const cutoff = now - WINDOW_MS;
    const value = jobs.filter(j => j && j.first_seen && Date.parse(j.first_seen) >= cutoff).length;
    cache = { value, expiresAt: now + SUCCESS_TTL_MS };
    return value;
  } catch (err) {
    console.error('[new-jobs-count] failed:', err.message);
    cache = { value: null, expiresAt: now + FAILURE_TTL_MS };
    return null;
  }
}

function _resetNewJobsCache() { cache = null; }

module.exports = { getNewJobsCount, _resetNewJobsCache };
