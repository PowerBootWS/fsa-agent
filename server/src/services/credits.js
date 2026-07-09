const { pool } = require('./database');

async function getBalance(userId) {
  const result = await pool.query(
    `SELECT balance FROM credit_balances WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0]?.balance ?? 0;
}

// Debits one credit per entry in generatedDocumentIds, atomically, using the caller's
// transaction client. Throws Error('INSUFFICIENT_CREDITS') and changes nothing if the
// balance would go negative — this guards against a race between an earlier balance
// check and this debit (e.g. two concurrent tailor requests from the same account).
async function debitCredits(client, userId, generatedDocumentIds) {
  const count = generatedDocumentIds.length;
  const result = await client.query(
    `UPDATE credit_balances SET balance = balance - $2, updated_at = now()
     WHERE user_id = $1 AND balance >= $2
     RETURNING balance`,
    [userId, count]
  );
  if (result.rows.length === 0) {
    throw new Error('INSUFFICIENT_CREDITS');
  }
  for (const generatedDocumentId of generatedDocumentIds) {
    await client.query(
      `INSERT INTO credit_transactions (user_id, delta, reason, generated_document_id)
       VALUES ($1, -1, 'generation_debit', $2)`,
      [userId, generatedDocumentId]
    );
  }
  return result.rows[0].balance;
}

module.exports = { getBalance, debitCredits };
