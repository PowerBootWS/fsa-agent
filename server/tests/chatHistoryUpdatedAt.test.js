// Migration 023 (backlog #116): chat_history.updated_at moves whenever messages
// change, so "conversations active this week" can be counted, while created_at
// keeps recording when the conversation began. Kept by a trigger because two
// writers upsert this table (services/database.js and ai-service researcher.py).
const { pool } = require('./testPool');

const EMAIL = 'chat-updated-at@test.example';

afterAll(async () => {
  await pool.query('DELETE FROM chat_history WHERE user_email = $1', [EMAIL]);
});

async function ages() {
  const { rows } = await pool.query(
    `SELECT created_at < now() - interval '29 days' AS old_start,
            updated_at > now() - interval '1 minute' AS fresh_turn
       FROM chat_history WHERE user_email = $1`,
    [EMAIL]
  );
  return rows[0];
}

it('a new turn bumps updated_at and leaves created_at alone; a no-op update does not', async () => {
  await pool.query(
    `INSERT INTO chat_history (user_email, lesson_id, messages, created_at, updated_at)
     VALUES ($1, NULL, '[{"role":"user","content":"first"}]', now() - interval '30 days', now() - interval '30 days')`,
    [EMAIL]
  );

  await pool.query(`UPDATE chat_history SET messages = messages WHERE user_email = $1`, [EMAIL]);
  expect(await ages()).toEqual({ old_start: true, fresh_turn: false });

  await pool.query(
    `UPDATE chat_history SET messages = messages || '[{"role":"user","content":"second"}]'::jsonb WHERE user_email = $1`,
    [EMAIL]
  );
  expect(await ages()).toEqual({ old_start: true, fresh_turn: true });
});
