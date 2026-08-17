const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');

const tailoringRouter = require('../src/routes/tailoring');

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'taildl-%@example.com';

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.use('/api/platform', tailoringRouter);
  return app;
}

async function createUser(email) {
  const token = `test-token-${email}`;
  const result = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token)
     VALUES ($1, 'Test', 'User', $2) RETURNING id`,
    [email, token]
  );
  return { userId: result.rows[0].id, token };
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

describe('generated-documents history + download', () => {
  const tmpDir = path.join(os.tmpdir(), 'fsa-test-generated-docs');

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  afterAll(async () => {
    await pool.end();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists generated documents for a saved job, newest first', async () => {
    const { userId, token } = await createUser('taildl-hist1@example.com');
    const savedJobId = await createSavedJob(userId);
    await pool.query(
      `INSERT INTO generated_documents (user_id, saved_job_id, doc_type, docx_path, pdf_path, changes_summary, placeholder_count, model_used, generated_at)
       VALUES ($1, $2, 'resume', '/tmp/a.docx', '/tmp/a.pdf', 'first pass', 3, 'anthropic/claude-sonnet-5', now() - interval '1 hour'),
              ($1, $2, 'resume', '/tmp/b.docx', '/tmp/b.pdf', 'second pass', 2, 'anthropic/claude-sonnet-5', now())`,
      [userId, savedJobId]
    );
    const app = buildTestApp();

    const res = await request(app)
      .get(`/api/platform/jobs/${savedJobId}/generated-documents`)
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(2);
    expect(res.body.documents[0].changesSummary).toBe('second pass'); // newest first
  });

  it('404s listing history for a job that belongs to another user', async () => {
    const { userId: ownerId } = await createUser('taildl-owner2@example.com');
    const savedJobId = await createSavedJob(ownerId);
    const { token } = await createUser('taildl-attacker2@example.com');
    const app = buildTestApp();

    const res = await request(app)
      .get(`/api/platform/jobs/${savedJobId}/generated-documents`)
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(404);
  });

  it('downloads the docx and pdf for a generated document', async () => {
    const { userId, token } = await createUser('taildl-dl1@example.com');
    const savedJobId = await createSavedJob(userId);
    const docxPath = path.join(tmpDir, 'resume.docx');
    const pdfPath = path.join(tmpDir, 'resume.pdf');
    fs.writeFileSync(docxPath, 'fake docx bytes');
    fs.writeFileSync(pdfPath, 'fake pdf bytes');
    const insertResult = await pool.query(
      `INSERT INTO generated_documents (user_id, saved_job_id, doc_type, docx_path, pdf_path, changes_summary, placeholder_count, model_used)
       VALUES ($1, $2, 'resume', $3, $4, 'x', 1, 'anthropic/claude-sonnet-5') RETURNING id`,
      [userId, savedJobId, docxPath, pdfPath]
    );
    const docId = insertResult.rows[0].id;
    const app = buildTestApp();

    const docxRes = await request(app)
      .get(`/api/platform/generated-documents/${docId}/download?format=docx`)
      .set('Cookie', `fsa_session=${token}`);
    expect(docxRes.status).toBe(200);
    expect(docxRes.text).toBe('fake docx bytes');

    const pdfRes = await request(app)
      .get(`/api/platform/generated-documents/${docId}/download?format=pdf`)
      .set('Cookie', `fsa_session=${token}`);
    expect(pdfRes.status).toBe(200);
    // supertest/superagent treats application/pdf as binary and buffers it into
    // .body (a Buffer), not .text (unlike the docx mime type above, which it treats
    // as text) — compare the buffer instead.
    expect(Buffer.isBuffer(pdfRes.body) ? pdfRes.body.toString() : pdfRes.text).toBe('fake pdf bytes');
  });

  it('404s downloading a document that belongs to another user', async () => {
    const { userId: ownerId } = await createUser('taildl-owner3@example.com');
    const savedJobId = await createSavedJob(ownerId);
    const docxPath = path.join(tmpDir, 'other.docx');
    fs.writeFileSync(docxPath, 'x');
    const insertResult = await pool.query(
      `INSERT INTO generated_documents (user_id, saved_job_id, doc_type, docx_path, pdf_path, changes_summary, placeholder_count, model_used)
       VALUES ($1, $2, 'resume', $3, $3, 'x', 1, 'anthropic/claude-sonnet-5') RETURNING id`,
      [ownerId, savedJobId, docxPath]
    );
    const docId = insertResult.rows[0].id;
    const { token } = await createUser('taildl-attacker3@example.com');
    const app = buildTestApp();

    const res = await request(app)
      .get(`/api/platform/generated-documents/${docId}/download?format=docx`)
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(404);
  });

  it('400s an invalid format query param', async () => {
    const { userId, token } = await createUser('taildl-fmt1@example.com');
    const savedJobId = await createSavedJob(userId);
    const insertResult = await pool.query(
      `INSERT INTO generated_documents (user_id, saved_job_id, doc_type, docx_path, pdf_path, changes_summary, placeholder_count, model_used)
       VALUES ($1, $2, 'resume', '/tmp/a.docx', '/tmp/a.pdf', 'x', 1, 'anthropic/claude-sonnet-5') RETURNING id`,
      [userId, savedJobId]
    );
    const docId = insertResult.rows[0].id;
    const app = buildTestApp();

    const res = await request(app)
      .get(`/api/platform/generated-documents/${docId}/download?format=txt`)
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(400);
  });
});
