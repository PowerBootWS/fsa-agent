// One-off backfill (2026-10-22): record cancellations students already
// scheduled in the Stripe portal before fsa-webhook-listener started recording
// them. Same rule as the listener: monthly live subscriptions only, Stripe's
// cancel_at, else the period end when cancel_at_period_end is set.
// Writes subscriptions.cancel_scheduled_at only; access is untouched.
//
//   docker exec fsa-agent-api-1 node src/scripts/backfill_cancel_scheduled.js           (dry run)
//   docker exec fsa-agent-api-1 node src/scripts/backfill_cancel_scheduled.js --apply
const Stripe = require('stripe');
const { pool } = require('../services/database');

async function main() {
  const apply = process.argv.includes('--apply');
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const { rows } = await pool.query(
    `SELECT s.id, s.stripe_subscription_id, s.class_code, s.cancel_scheduled_at, pu.email
       FROM subscriptions s JOIN platform_users pu ON pu.id = s.user_id
      WHERE s.status = 'active' AND s.stripe_subscription_id IS NOT NULL AND s.stripe_subscription_id <> ''`);
  let changed = 0;
  for (const r of rows) {
    let sub;
    try { sub = await stripe.subscriptions.retrieve(r.stripe_subscription_id); } catch (err) {
      console.log(`skip ${r.id}: ${err.message}`);
      continue;
    }
    if (!['active', 'past_due'].includes(sub.status)) continue;
    // Monthly only, as in the listener: annual prepays and 4th Class papers are
    // set to end after their year by our own checkout, not by the student.
    if (sub.items?.data?.[0]?.price?.recurring?.interval !== 'month') continue;
    const periodEnd = sub.items?.data?.[0]?.current_period_end || sub.current_period_end || null;
    const at = sub.cancel_at || (sub.cancel_at_period_end ? periodEnd : null);
    const want = at ? new Date(at * 1000) : null;
    const have = r.cancel_scheduled_at ? new Date(r.cancel_scheduled_at) : null;
    if ((want && have && want.getTime() === have.getTime()) || (!want && !have)) continue;
    changed += 1;
    console.log(`${apply ? 'set' : 'would set'} sub ${r.id} (${r.class_code}, ${r.email}): ${want ? want.toISOString().slice(0, 10) : 'none'}`);
    if (apply) await pool.query(`UPDATE subscriptions SET cancel_scheduled_at = $1 WHERE id = $2`, [want, r.id]);
  }
  console.log(`${rows.length} live subscriptions checked, ${changed} ${apply ? 'updated' : 'to update'}.`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
