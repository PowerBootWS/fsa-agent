#!/usr/bin/env node
/**
 * Portal accounts for active affiliates who have none.
 *
 * The referral dashboard now lives inside the portal (/affiliate), so an
 * active affiliate with no platform_users row has lost their dashboard. This
 * gives each one an account and a setup email that lands on Referrals.
 *
 * DRY RUN BY DEFAULT. Nothing is written or sent without --apply.
 *
 *   node scripts/provision-affiliate-accounts.js
 *   node scripts/provision-affiliate-accounts.js --only=a@x.com,b@y.com
 *   node scripts/provision-affiliate-accounts.js --skip=c@z.com
 *   node scripts/provision-affiliate-accounts.js --apply
 *
 * Host-run: POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_DB=<db>
 * POSTGRES_PASSWORD=... (POSTGRES_DB is required; there is no default).
 * --apply runs only against fsa_agent (production) or a scratch copy
 * (_scratch_meta present). Against scratch, set EMAIL_REDIRECT_TO.
 */
const crypto = require('crypto');
const { Pool } = require('pg');
const { grantSignupCredit } = require('../src/services/signupCredit');
const { sendAffiliateAccountSetup, affiliateAccountSetupMessage } = require('../src/services/email');
const { signText } = require('../src/services/emailTemplate');

function parseArgs(argv) {
  const opts = { apply: false, only: null, skip: [] };
  const list = (v) => v.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const arg of argv) {
    if (arg === '--apply') opts.apply = true;
    else if (arg.startsWith('--only=')) opts.only = list(arg.slice(7));
    else if (arg.startsWith('--skip=')) opts.skip = list(arg.slice(7));
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

// "Sam Lee Smith" -> { first: 'Sam', last: 'Lee Smith' }. platform_users has
// first_name and last_name NOT NULL, so a missing part is ''.
function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

async function selectAffiliates(pool, opts) {
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.email
       FROM affiliate.affiliates a
       LEFT JOIN public.platform_users pu ON lower(pu.email) = lower(a.email)
      WHERE a.status = 'active' AND pu.id IS NULL
      ORDER BY a.id`
  );
  return rows.filter((r) => {
    const e = String(r.email || '').toLowerCase();
    if (opts.only && !opts.only.includes(e)) return false;
    return !opts.skip.includes(e);
  });
}

// Mirrors the NEW-user branch of POST /provision-user in src/routes/platform.js
// (platform_users insert, signup credit, 48h magic_link token), minus
// everything subscription-related. That route interleaves these steps with
// subscription logic, so the SQL is duplicated here rather than extracted:
// keep the two in step. Returns the token, or null if an account now exists.
async function createAccount(pool, email, first, last) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query(
      `SELECT 1 FROM platform_users WHERE lower(email) = $1`, [email]);
    if (exists.rowCount > 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const ins = await client.query(
      `INSERT INTO platform_users (email, first_name, last_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [email, first, last]
    );
    if (ins.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const userId = ins.rows[0].id;
    // As in provision-user, a failed free credit must not stop the account.
    // A savepoint keeps the transaction usable if the grant errors.
    await client.query('SAVEPOINT credit');
    try {
      await grantSignupCredit(client, userId);
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT credit');
      console.error(`  signup credit grant failed for ${email}: ${err.message}`);
    }
    const token = crypto.randomUUID();
    await client.query(
      `INSERT INTO auth_tokens (user_id, token, type, expires_at)
       VALUES ($1, $2, 'magic_link', now() + interval '48 hours')`,
      [userId, token]
    );
    await client.query('COMMIT');
    return token;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const db = process.env.POSTGRES_DB;
  if (!db) throw new Error('POSTGRES_DB is not set. Pass it explicitly (fsa_agent or fsa_agent_scratch).');

  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: process.env.POSTGRES_PORT || 5434,
    database: db,
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD,
  });

  try {
    if (opts.apply && db !== 'fsa_agent') {
      try {
        await pool.query('SELECT 1 FROM _scratch_meta');
      } catch {
        throw new Error(`--apply refused: ${db} is neither fsa_agent nor a scratch copy (_scratch_meta missing)`);
      }
    }

    console.log(`database: ${db}  mode: ${opts.apply ? 'APPLY' : 'dry-run'}`);
    const people = await selectAffiliates(pool, opts);
    let done = 0, skipped = 0, failed = 0;

    for (const p of people) {
      const email = String(p.email).toLowerCase().trim();
      const { first, last } = splitName(p.name);
      if (!opts.apply) {
        console.log(`would create ${email} (${first || 'no name'})`);
        done++;
        continue;
      }
      try {
        const token = await createAccount(pool, email, first, last);
        if (!token) {
          console.log(`skipped ${email} (account exists)`);
          skipped++;
          continue;
        }
        // Mail only after commit. A send failure leaves the account in place;
        // "Forgot password" on the login page recovers it.
        await sendAffiliateAccountSetup(email, first, token);
        console.log(`created ${email}`);
        done++;
      } catch (err) {
        console.log(`failed ${email}: ${err.message}`);
        failed++;
      }
    }

    if (opts.apply) {
      console.log(`\ncreated ${done}, skipped ${skipped}, failed ${failed} (of ${people.length})`);
    } else {
      console.log(`\nwould create ${done} account(s). Nothing written or sent. Re-run with --apply to do it.`);
      if (people.length) {
        const p = people[0];
        const msg = affiliateAccountSetupMessage(String(p.email).toLowerCase().trim(),
          splitName(p.name).first, '<TOKEN>');
        console.log(`\n--- email for ${msg.to} (plain text, as sent) ---`);
        console.log(`Subject: ${msg.subject}\n`);
        console.log(signText(msg.text));
        console.log('--- end ---');
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
