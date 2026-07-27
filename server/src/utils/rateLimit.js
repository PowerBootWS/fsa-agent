// server/src/utils/rateLimit.js — simple in-memory sliding-window limiter,
// ported from fsa-affiliate-program's src/rateLimit.js. Fine at fsa-agent's
// scale (single Express process); not meant to survive a restart or work
// across replicas.

function createRateLimiter({ windowMs, max }) {
  const hits = new Map(); // key -> array of hit timestamps (ms)

  function pruneExpired(now) {
    for (const [key, timestamps] of hits) {
      const fresh = timestamps.filter((t) => now - t < windowMs);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
  }

  function check(key) {
    const now = Date.now();
    const timestamps = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (timestamps.length >= max) {
      hits.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    hits.set(key, timestamps);
    return true;
  }

  const sweepTimer = setInterval(() => pruneExpired(Date.now()), windowMs);
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

  return { check };
}

module.exports = { createRateLimiter };
