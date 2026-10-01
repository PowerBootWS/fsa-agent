#!/usr/bin/env node
/**
 * Publish an announcement from its JSON file (upsert by slug), or pull one early.
 *
 *   node src/scripts/publish_announcement.js src/announcements/<slug>.json
 *   node src/scripts/publish_announcement.js --end-now <slug>
 *
 * Process rule: Russ approves the title, body, button and audience list in
 * chat before this runs. See wiki/projects/fsa-agent.md "Announcements".
 */
const fs = require('fs');
const { pool } = require('../services/database');
const {
  validateAnnouncement, upsertAnnouncement, endAnnouncementNow, countEligible,
} = require('../services/announcements');

async function publishFromFile(db, filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const result = validateAnnouncement(parsed);
  if (!result.ok) throw new Error(`Invalid announcement:\n  - ${result.errors.join('\n  - ')}`);
  const { id, inserted, starts_at } = await upsertAnnouncement(db, result.value);
  // Use the stored start: a re-publish without dates keeps the original window.
  const eligible = await countEligible(db, { ...result.value, starts_at });
  return { id, inserted, eligible };
}

async function main(argv) {
  if (argv[0] === '--end-now') {
    if (!argv[1]) throw new Error('usage: publish_announcement.js --end-now <slug>');
    const id = await endAnnouncementNow(pool, argv[1]);
    console.log(id ? `Ended announcement ${argv[1]} (id ${id}).` : `No announcement with slug ${argv[1]}.`);
    return;
  }
  if (!argv[0]) throw new Error('usage: publish_announcement.js <file.json> | --end-now <slug>');
  const r = await publishFromFile(pool, argv[0]);
  console.log(`${r.inserted ? 'Published' : 'Updated'} announcement id ${r.id}. Eligible accounts right now: ${r.eligible}.`);
}

if (require.main === module) {
  main(process.argv.slice(2))
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
}

module.exports = { publishFromFile };
