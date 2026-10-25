// Client for fsa-affiliate-program's /internal/* API. Reached over the shared
// fsa-agent_fsa-network (AFFILIATE_INTERNAL_URL=http://fsa-affiliate-program:3000),
// the same way fsa-webhook-listener reaches it. AFFILIATE_INTERNAL_SECRET comes
// from /home/debian/.env.shared.
//
// getSummary is for display and never throws: the Home page must load even
// when the affiliate service is down. join is an action and does throw, so the
// route can tell the student it didn't work.

const TIMEOUT_MS = 2000;

function config() {
  const url = process.env.AFFILIATE_INTERNAL_URL;
  const secret = process.env.AFFILIATE_INTERNAL_SECRET;
  return url && secret ? { url, secret } : null;
}

async function getSummary(email) {
  const c = config();
  if (!c) return null;
  try {
    const res = await fetch(
      `${c.url}/internal/affiliates/summary?email=${encodeURIComponent(email)}`,
      { headers: { 'x-affiliate-secret': c.secret }, signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('[affiliate-client] summary failed:', err.message);
    return null;
  }
}

async function join({ name, email }) {
  const c = config();
  if (!c) throw new Error('AFFILIATE_INTERNAL_URL or AFFILIATE_INTERNAL_SECRET not set');
  const res = await fetch(`${c.url}/internal/affiliates/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-affiliate-secret': c.secret },
    body: JSON.stringify({ name, email, source: 'in_app' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`affiliate create failed (${res.status}): ${body}`);
  }
  return res.json();
}

// Full dashboard payload for the portal's Referrals page. Display-only like
// getSummary: null on timeout, non-2xx or missing config.
async function getDashboard(email) {
  const c = config();
  if (!c) return null;
  try {
    const res = await fetch(
      `${c.url}/internal/affiliates/dashboard?email=${encodeURIComponent(email)}`,
      { headers: { 'x-affiliate-secret': c.secret }, signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('[affiliate-client] dashboard failed:', err.message);
    return null;
  }
}

// An action: resolves with the service's status and body as-is (403, 404 and
// 429 carry messages the student should see); throws only on network/timeout.
async function createDiscountCode(email) {
  const c = config();
  if (!c) throw new Error('AFFILIATE_INTERNAL_URL or AFFILIATE_INTERNAL_SECRET not set');
  const res = await fetch(`${c.url}/internal/affiliates/discount-codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-affiliate-secret': c.secret },
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let body = {};
  try { body = await res.json(); } catch (_) { /* non-JSON body */ }
  return { status: res.status, body };
}

module.exports = { getSummary, join, getDashboard, createDiscountCode };
