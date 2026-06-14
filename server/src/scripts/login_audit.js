#!/usr/bin/env node
/**
 * login_audit.js — on-demand account-sharing review from login_events IPs.
 *
 * Usage (run inside the api container, WORKDIR /app):
 *   docker exec fsa-agent-api-1 node src/scripts/login_audit.js
 *   docker exec fsa-agent-api-1 node src/scripts/login_audit.js --user jordannickle@live.ca
 *   docker exec fsa-agent-api-1 node src/scripts/login_audit.js --days 14 --min-ips 3
 *
 * Default (no --user): scans logins in the last N days and flags any user whose
 * logins span >= MIN_IPS distinct IPs. With --user: full IP/device history for
 * one person (id or email).
 *
 * Geo/ISP enrichment is OPTIONAL: set IPINFO_TOKEN in the environment to turn
 * raw IPs into city / region / ISP(ASN) and surface a rapid-location-change
 * note. Without a token the report still works on raw IPs (distinct count +
 * timing) — just without place names.
 *
 * IP is a SOFT signal (mobile/CGNAT/VPN roam). This flags accounts for human
 * review only; it never penalises a customer automatically.
 */

const { pool } = require('../services/database');

function parseArgs(argv) {
  const args = { user: null, days: 30, minIps: 2 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user') args.user = argv[++i];
    else if (a === '--days') args.days = parseInt(argv[++i], 10);
    else if (a === '--min-ips') args.minIps = parseInt(argv[++i], 10);
  }
  return args;
}

const IPINFO_TOKEN = process.env.IPINFO_TOKEN || null;
const geoCache = new Map();

async function geo(ip) {
  if (!IPINFO_TOKEN || !ip) return null;
  if (geoCache.has(ip)) return geoCache.get(ip);
  try {
    const res = await fetch(`https://ipinfo.io/${ip}/json?token=${IPINFO_TOKEN}`);
    if (!res.ok) return null;
    const j = await res.json();
    const out = {
      label: [j.city, j.region, j.country].filter(Boolean).join(', ') || '?',
      org: j.org || '?',
    };
    geoCache.set(ip, out);
    return out;
  } catch {
    return null;
  }
}

function fmt(ts) {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

async function resolveUser(idOrEmail) {
  const byId = /^\d+$/.test(String(idOrEmail));
  const r = await pool.query(
    `SELECT id, email, first_name, last_name FROM platform_users WHERE ${byId ? 'id = $1' : 'lower(email) = lower($1)'}`,
    [idOrEmail]
  );
  return r.rows[0] || null;
}

async function auditOne(idOrEmail) {
  const u = await resolveUser(idOrEmail);
  if (!u) {
    console.log(`No platform_user found for "${idOrEmail}".`);
    return;
  }
  const ev = await pool.query(
    `SELECT logged_in_at, ip_address, user_agent
       FROM login_events WHERE user_id = $1 ORDER BY logged_in_at`,
    [u.id]
  );
  console.log(`\n=== ${u.first_name} ${u.last_name}  <${u.email}>  (id ${u.id}) ===`);
  console.log(`${ev.rows.length} login event(s):\n`);
  for (const e of ev.rows) {
    const ip = e.ip_address || '(no IP — pre-capture)';
    const g = await geo(e.ip_address);
    const geoStr = g ? `  ${g.label} · ${g.org}` : '';
    console.log(`  ${fmt(e.logged_in_at)}  ${ip}${geoStr}`);
    if (e.user_agent) console.log(`      ${e.user_agent}`);
  }
  const ips = new Set(ev.rows.map((r) => r.ip_address).filter(Boolean));
  console.log(`\n  distinct IPs (captured): ${ips.size}`);
}

async function scan(days, minIps) {
  const r = await pool.query(
    `SELECT le.user_id, u.email, u.first_name, u.last_name,
            COUNT(*) AS logins,
            COUNT(DISTINCT le.ip_address) FILTER (WHERE le.ip_address IS NOT NULL) AS distinct_ips,
            MIN(le.logged_in_at) AS first_at, MAX(le.logged_in_at) AS last_at
       FROM login_events le
       JOIN platform_users u ON u.id = le.user_id
      WHERE le.logged_in_at > now() - ($1 || ' days')::interval
      GROUP BY le.user_id, u.email, u.first_name, u.last_name
     HAVING COUNT(DISTINCT le.ip_address) FILTER (WHERE le.ip_address IS NOT NULL) >= $2
      ORDER BY distinct_ips DESC, logins DESC`,
    [days, minIps]
  );

  console.log(`\n=== Account-sharing review — last ${days} day(s), flagging >= ${minIps} distinct IPs ===`);
  if (!IPINFO_TOKEN) console.log('(no IPINFO_TOKEN set — showing raw IPs without geo/ISP)');
  if (r.rows.length === 0) {
    console.log('\nNo accounts flagged. (Reminder: IP capture is forward-only — logins before deploy have no IP.)');
    return;
  }
  for (const row of r.rows) {
    console.log(`\n• ${row.first_name} ${row.last_name}  <${row.email}>  (id ${row.user_id})`);
    console.log(`    ${row.logins} logins / ${row.distinct_ips} distinct IPs  ·  ${fmt(row.first_at)} → ${fmt(row.last_at)}`);
    const ipRows = await pool.query(
      `SELECT ip_address, COUNT(*) AS n, MIN(logged_in_at) AS first_at, MAX(logged_in_at) AS last_at
         FROM login_events
        WHERE user_id = $1 AND ip_address IS NOT NULL
          AND logged_in_at > now() - ($2 || ' days')::interval
        GROUP BY ip_address ORDER BY last_at DESC`,
      [row.user_id, days]
    );
    const labels = [];
    for (const ipr of ipRows.rows) {
      const g = await geo(ipr.ip_address);
      const geoStr = g ? `  ${g.label} · ${g.org}` : '';
      if (g) labels.push(g.label);
      console.log(`      ${ipr.ip_address}  ×${ipr.n}  (${fmt(ipr.first_at)} → ${fmt(ipr.last_at)})${geoStr}`);
    }
    const distinctPlaces = new Set(labels);
    if (distinctPlaces.size >= 2) {
      console.log(`      ⚠ logins from ${distinctPlaces.size} different locations — review for sharing.`);
    }
  }
}

(async () => {
  const args = parseArgs(process.argv);
  try {
    if (args.user) await auditOne(args.user);
    else await scan(args.days, args.minIps);
  } catch (err) {
    console.error('login_audit error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
