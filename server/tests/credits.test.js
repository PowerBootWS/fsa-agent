const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');

const credits = require('../src/services/credits');
const tailoringRouter = require('../src/routes/tailoring');

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.use('/api/platform', tailoringRouter);
  return app;
}

async function createUser(email, balance) {
  const token = `test-token-${email}`;
  const result = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token)
     VALUES ($1, 'Test', 'User', $2) RETURNING id`,
    [email, token]
  );
  const userId = result.rows[0].id;
  await pool.query(`INSERT INTO credit_balances (user_id, balance) VALUES ($1, $2)`, [userId, balance]);
  return { userId, token };
}

async function createDummyDocument(userId, documentId) {
  const savedJobResult = await pool.query(
    `INSERT INTO saved_jobs (user_id, title, url) VALUES ($1, $2, $3) RETURNING id`,
    [userId, `Test Job ${documentId}`, `https://example.com/job/${documentId}`]
  );
  const savedJobId = savedJobResult.rows[0].id;
  await pool.query(
    `INSERT INTO generated_documents (user_id, saved_job_id, doc_type, docx_path, pdf_path, changes_summary, model_used)
     VALUES ($1, $2, 'resume', '/tmp/test.docx', '/tmp/test.pdf', 'test', 'test-model')`,
    [userId, savedJobId]
  );
}

describe('credits service + GET /credits', () => {
  afterEach(async () => {
    await pool.query(`DELETE FROM credit_transactions`);
    await pool.query(`DELETE FROM generated_documents`);
    await pool.query(`DELETE FROM saved_jobs`);
    await pool.query(`DELETE FROM credit_balances`);
    await pool.query(`DELETE FROM platform_users`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('getBalance returns 0 for a user with no row', async () => {
    const { userId } = await createUser('nobal@example.com', 0);
    await pool.query(`DELETE FROM credit_balances WHERE user_id = $1`, [userId]);
    const balance = await credits.getBalance(userId);
    expect(balance).toBe(0);
  });

  it('GET /api/platform/credits returns the balance for the logged-in user', async () => {
    const { token } = await createUser('bal1@example.com', 3);
    const app = buildTestApp();
    const res = await request(app).get('/api/platform/credits').set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ balance: 3 });
  });

  it('debitCredits decrements balance and records one transaction per document', async () => {
    const { userId } = await createUser('bal2@example.com', 2);
    await createDummyDocument(userId, 101);
    await createDummyDocument(userId, 102);
    const generatedDocs = await pool.query(
      `SELECT id FROM generated_documents WHERE user_id = $1 ORDER BY id LIMIT 2`,
      [userId]
    );
    const docIds = generatedDocs.rows.map((r) => r.id);
    const client = await pool.connect();
    try {
      const newBalance = await credits.debitCredits(client, userId, docIds);
      expect(newBalance).toBe(0);
    } finally {
      client.release();
    }
    const txRows = await pool.query(
      `SELECT generated_document_id FROM credit_transactions WHERE user_id = $1 ORDER BY generated_document_id`,
      [userId]
    );
    expect(txRows.rows.map((r) => r.generated_document_id)).toEqual(docIds);
  });

  it('debitCredits throws INSUFFICIENT_CREDITS and changes nothing when balance is too low', async () => {
    const { userId } = await createUser('bal3@example.com', 1);
    await createDummyDocument(userId, 201);
    await createDummyDocument(userId, 202);
    const generatedDocs = await pool.query(
      `SELECT id FROM generated_documents WHERE user_id = $1 ORDER BY id LIMIT 2`,
      [userId]
    );
    const docIds = generatedDocs.rows.map((r) => r.id);
    const client = await pool.connect();
    try {
      await expect(credits.debitCredits(client, userId, docIds)).rejects.toThrow('INSUFFICIENT_CREDITS');
    } finally {
      client.release();
    }
    const balanceRow = await pool.query(`SELECT balance FROM credit_balances WHERE user_id = $1`, [userId]);
    expect(balanceRow.rows[0].balance).toBe(1);
  });
});
