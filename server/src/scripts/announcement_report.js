#!/usr/bin/env node
/** node src/scripts/announcement_report.js <slug> — reach and feedback for one announcement. */
const { pool } = require('../services/database');
const { getReport } = require('../services/announcements');

async function main(slug) {
  if (!slug) throw new Error('usage: announcement_report.js <slug>');
  const r = await getReport(pool, slug);
  if (!r) { console.log(`No announcement with slug ${slug}.`); return; }
  console.log(`${r.title} (${r.slug})`);
  console.log(`Window: ${r.starts_at.toISOString()} to ${r.ends_at.toISOString()}`);
  console.log(`Eligible now: ${r.eligible}`);
  console.log(`Seen: ${r.seen.total} (dismissed ${r.seen.dismissed}, clicked ${r.seen.cta}, feedback ${r.seen.feedback})`);
  console.log(`\nFeedback (${r.feedback.length}):`);
  for (const f of r.feedback) {
    console.log(`\n[${f.created_at.toISOString()}] ${f.name} <${f.email}>\n${f.message}`);
  }
}

if (require.main === module) {
  main(process.argv[2])
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
