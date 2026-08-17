const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'tailor-%@example.com';

jest.mock('../src/services/aiServiceClient');
const { requestTailoredDocuments } = require('../src/services/aiServiceClient');

const tailoringRouter = require('../src/routes/tailoring');
const credits = require('../src/services/credits');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/platform', tailoringRouter);
  return app;
}

async function createUser(email, balance = 1) {
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

async function createSavedJob(userId) {
  const result = await pool.query(
    `INSERT INTO saved_jobs (user_id, title, company, description_snapshot, url)
     VALUES ($1, 'Boiler Operator', 'Acme Plant', 'Operate boilers.', 'https://example.com/job')
     RETURNING id`,
    [userId]
  );
  return result.rows[0].id;
}

async function uploadResumeRow(userId) {
  await pool.query(
    `INSERT INTO user_documents (user_id, doc_type, original_filename, storage_path, mime_type)
     VALUES ($1, 'resume', 'resume.pdf', '/tmp/fake-resume.pdf', 'application/pdf')`,
    [userId]
  );
}

describe('POST /api/platform/jobs/:savedJobId/tailor', () => {
  afterEach(async () => {
    jest.clearAllMocks();
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rejects with 400 when no resume is on file', async () => {
    const { token, userId } = await createUser('tailor-t1@example.com');
    const savedJobId = await createSavedJob(userId);
    const app = buildTestApp();

    const res = await request(app)
      .post(`/api/platform/jobs/${savedJobId}/tailor`)
      .set('Cookie', `fsa_session=${token}`)
      .send({ docTypes: ['resume'] });

    expect(res.status).toBe(400);
    expect(requestTailoredDocuments).not.toHaveBeenCalled();
  });

  it('rejects with 402 when balance is insufficient', async () => {
    const { token, userId } = await createUser('tailor-t2@example.com', 0);
    const savedJobId = await createSavedJob(userId);
    await uploadResumeRow(userId);
    const app = buildTestApp();

    const res = await request(app)
      .post(`/api/platform/jobs/${savedJobId}/tailor`)
      .set('Cookie', `fsa_session=${token}`)
      .send({ docTypes: ['resume'] });

    expect(res.status).toBe(402);
    expect(requestTailoredDocuments).not.toHaveBeenCalled();
  });

  it('generates a document, debits one credit, and records the generation', async () => {
    const { token, userId } = await createUser('tailor-t3@example.com', 1);
    const savedJobId = await createSavedJob(userId);
    await uploadResumeRow(userId);
    requestTailoredDocuments.mockResolvedValue({
      documents: [{ doc_type: 'resume', docx_path: '/srv/fsa-generated-documents/x/resume.docx', pdf_path: '/srv/fsa-generated-documents/x/resume.pdf' }],
      changes_summary: 'Moved certification to the top.',
      placeholder_count: 4,
      flagged_gaps: [],
      model_used: 'anthropic/claude-sonnet-5',
    });
    const app = buildTestApp();

    const res = await request(app)
      .post(`/api/platform/jobs/${savedJobId}/tailor`)
      .set('Cookie', `fsa_session=${token}`)
      .send({ docTypes: ['resume'] });

    expect(res.status).toBe(201);
    expect(res.body.balanceRemaining).toBe(0);
    expect(res.body.documents).toHaveLength(1);

    const balanceRow = await pool.query(`SELECT balance FROM credit_balances WHERE user_id = $1`, [userId]);
    expect(balanceRow.rows[0].balance).toBe(0);

    const generatedRow = await pool.query(`SELECT * FROM generated_documents WHERE user_id = $1`, [userId]);
    expect(generatedRow.rows).toHaveLength(1);
    expect(generatedRow.rows[0].placeholder_count).toBe(4);

    const txRow = await pool.query(
      `SELECT * FROM credit_transactions WHERE user_id = $1 AND reason = 'generation_debit'`,
      [userId]
    );
    expect(txRow.rows).toHaveLength(1);
  });

  it('does not debit credits when ai-service generation fails', async () => {
    const { token, userId } = await createUser('tailor-t4@example.com', 1);
    const savedJobId = await createSavedJob(userId);
    await uploadResumeRow(userId);
    requestTailoredDocuments.mockRejectedValue(new Error('ai-service unreachable'));
    const app = buildTestApp();

    const res = await request(app)
      .post(`/api/platform/jobs/${savedJobId}/tailor`)
      .set('Cookie', `fsa_session=${token}`)
      .send({ docTypes: ['resume'] });

    expect(res.status).toBe(500);
    const balanceRow = await pool.query(`SELECT balance FROM credit_balances WHERE user_id = $1`, [userId]);
    expect(balanceRow.rows[0].balance).toBe(1);
  });

  it('de-duplicates docTypes so a duplicate resume request only charges one credit', async () => {
    const { token, userId } = await createUser('tailor-t5@example.com', 1);
    const savedJobId = await createSavedJob(userId);
    await uploadResumeRow(userId);
    requestTailoredDocuments.mockResolvedValue({
      documents: [{ doc_type: 'resume', docx_path: '/srv/fsa-generated-documents/x/resume.docx', pdf_path: '/srv/fsa-generated-documents/x/resume.pdf' }],
      changes_summary: 'Moved certification to the top.',
      placeholder_count: 4,
      flagged_gaps: [],
      model_used: 'anthropic/claude-sonnet-5',
    });
    const app = buildTestApp();

    const res = await request(app)
      .post(`/api/platform/jobs/${savedJobId}/tailor`)
      .set('Cookie', `fsa_session=${token}`)
      .send({ docTypes: ['resume', 'resume'] });

    expect(res.status).toBe(201);
    expect(res.body.balanceRemaining).toBe(0);

    const balanceRow = await pool.query(`SELECT balance FROM credit_balances WHERE user_id = $1`, [userId]);
    expect(balanceRow.rows[0].balance).toBe(0);

    const generatedRow = await pool.query(`SELECT * FROM generated_documents WHERE user_id = $1`, [userId]);
    expect(generatedRow.rows).toHaveLength(1);

    const txRow = await pool.query(
      `SELECT * FROM credit_transactions WHERE user_id = $1 AND reason = 'generation_debit'`,
      [userId]
    );
    expect(txRow.rows).toHaveLength(1);
  });

  it('returns 402 (not 500) and rolls back the DB insert when a credit-race loses to debitCredits', async () => {
    const { token, userId } = await createUser('tailor-t6@example.com', 1);
    const savedJobId = await createSavedJob(userId);
    await uploadResumeRow(userId);
    requestTailoredDocuments.mockResolvedValue({
      documents: [{ doc_type: 'resume', docx_path: '/srv/fsa-generated-documents/x/resume.docx', pdf_path: '/srv/fsa-generated-documents/x/resume.pdf' }],
      changes_summary: 'Moved certification to the top.',
      placeholder_count: 4,
      flagged_gaps: [],
      model_used: 'anthropic/claude-sonnet-5',
    });
    const debitSpy = jest.spyOn(credits, 'debitCredits').mockRejectedValueOnce(new Error('INSUFFICIENT_CREDITS'));
    const app = buildTestApp();

    try {
      const res = await request(app)
        .post(`/api/platform/jobs/${savedJobId}/tailor`)
        .set('Cookie', `fsa_session=${token}`)
        .send({ docTypes: ['resume'] });

      expect(res.status).toBe(402);
      expect(res.body.error).toBe('Not enough credits');

      const generatedRow = await pool.query(`SELECT * FROM generated_documents WHERE user_id = $1`, [userId]);
      expect(generatedRow.rows).toHaveLength(0);

      const balanceRow = await pool.query(`SELECT balance FROM credit_balances WHERE user_id = $1`, [userId]);
      expect(balanceRow.rows[0].balance).toBe(1);
    } finally {
      debitSpy.mockRestore();
    }
  });

  it('404s tailoring a job that belongs to another user', async () => {
    const { userId: otherUserId } = await createUser('tailor-owner@example.com');
    const savedJobId = await createSavedJob(otherUserId);
    const { token } = await createUser('tailor-attacker@example.com');
    const app = buildTestApp();

    const res = await request(app)
      .post(`/api/platform/jobs/${savedJobId}/tailor`)
      .set('Cookie', `fsa_session=${token}`)
      .send({ docTypes: ['resume'] });

    expect(res.status).toBe(404);
  });
});
