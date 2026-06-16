#!/usr/bin/env node
/**
 * device_switch_report.js — how often students switch between mobile and
 * desktop. Under single-session enforcement, switching devices signs the other
 * one out; this report quantifies that friction so we can later decide whether
 * to allow more than one concurrent session.
 *
 * Usage (run inside the api container, WORKDIR /app):
 *   docker exec fsa-agent-api-1 node src/scripts/device_switch_report.js
 *   docker exec fsa-agent-api-1 node src/scripts/device_switch_report.js --days 14
 *   docker exec fsa-agent-api-1 node src/scripts/device_switch_report.js --days 31 --email sysadmin@powerboot.ca
 *
 * With --email <addr> the report is emailed (via the app's SMTP transport)
 * instead of printed — used by the monthly cron. A cron entry on the host runs
 * this on the 1st of each month.
 *
 * Definitions:
 *   - device_type: coarse class of each login (mobile / tablet / desktop).
 *   - displacement: a login that bumped a still-active session on another device
 *     (displaced_active_session = true).
 *   - cross-device switch: two consecutive logins by the same user on different
 *     device types — the mobile↔desktop hop we care about.
 *
 * Forward-only: only logins after migration 007 carry device_type. Rows before
 * it are NULL and excluded from the switch math.
 */

const { pool } = require('../services/database');

function parseArgs(argv) {
  const args = { days: 30, email: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--days') args.days = parseInt(argv[++i], 10);
    else if (argv[i] === '--email') args.email = argv[++i];
  }
  return args;
}

async function main() {
  const { days, email } = parseArgs(process.argv);
  const since = `${days} days`;
  const lines = [];
  const out = (s = '') => lines.push(s);

  // Logins by device type (only classified rows).
  const byDevice = await pool.query(
    `SELECT COALESCE(device_type, 'unclassified') AS device, count(*)::int AS n
       FROM login_events
      WHERE logged_in_at > now() - $1::interval
      GROUP BY 1 ORDER BY n DESC`,
    [since]
  );

  // Displacement rate: logins that bumped an active session.
  const displaced = await pool.query(
    `SELECT count(*) FILTER (WHERE displaced_active_session)::int AS displaced,
            count(*) FILTER (WHERE displaced_active_session IS NOT NULL)::int AS measured
       FROM login_events
      WHERE logged_in_at > now() - $1::interval`,
    [since]
  );

  // Cross-device switches: consecutive logins per user with a different device type.
  const switches = await pool.query(
    `WITH ordered AS (
       SELECT user_id, logged_in_at, device_type, displaced_active_session,
              lag(device_type) OVER (PARTITION BY user_id ORDER BY logged_in_at) AS prev_device
         FROM login_events
        WHERE logged_in_at > now() - $1::interval
          AND device_type IS NOT NULL AND device_type <> 'unknown'
     )
     SELECT user_id, device_type, prev_device, displaced_active_session
       FROM ordered
      WHERE prev_device IS NOT NULL AND device_type <> prev_device`,
    [since]
  );

  // Per-user switch counts (top switchers) with email.
  const perUser = await pool.query(
    `WITH ordered AS (
       SELECT user_id, device_type,
              lag(device_type) OVER (PARTITION BY user_id ORDER BY logged_in_at) AS prev_device
         FROM login_events
        WHERE logged_in_at > now() - $1::interval
          AND device_type IS NOT NULL AND device_type <> 'unknown'
     )
     SELECT u.email, count(*)::int AS switches
       FROM ordered o JOIN platform_users u ON u.id = o.user_id
      WHERE o.prev_device IS NOT NULL AND o.device_type <> o.prev_device
      GROUP BY u.email ORDER BY switches DESC LIMIT 15`,
    [since]
  );

  const totalLogins = byDevice.rows.reduce((s, r) => s + r.n, 0);
  const switchRows = switches.rows;
  const switchUsers = new Set(switchRows.map((r) => r.user_id)).size;
  const switchDisplaced = switchRows.filter((r) => r.displaced_active_session).length;
  const d = displaced.rows[0];

  out(`=== Device-switch report — last ${days} days ===`);
  out('');
  out(`Total logins: ${totalLogins}`);
  for (const r of byDevice.rows) out(`  ${r.device.padEnd(12)} ${r.n}`);
  out('');
  out(`Session displacements (a login that bumped another device): ${d.displaced} of ${d.measured} measured logins`);
  out(`Cross-device switches (mobile<->desktop/tablet): ${switchRows.length} across ${switchUsers} user(s)`);
  out(`  ...of which forced a sign-out on the other device: ${switchDisplaced}`);
  out('');
  if (perUser.rows.length) {
    out('Top switchers:');
    for (const r of perUser.rows) out(`  ${String(r.switches).padStart(3)}  ${r.email}`);
  } else {
    out('No cross-device switches recorded yet (data is forward-only from migration 007).');
  }
  out('');
  out('Note: "unclassified" logins predate device-switch instrumentation (migration 007) and are excluded from the switch math.');

  const report = lines.join('\n');
  await pool.end();

  if (email) {
    const { sendOpsEmail } = require('../services/email');
    await sendOpsEmail(email, `FSA device-switch report (last ${days} days)`, report);
    console.log(`Report emailed to ${email}.`);
  } else {
    console.log('\n' + report + '\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
