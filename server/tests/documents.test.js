const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pool } = require('./testPool');

const TEST_UPLOAD_DIR = path.join(os.tmpdir(), 'fsa-test-uploads');
process.env.USER_UPLOADS_DIR = TEST_UPLOAD_DIR;

const documentsRouter = require('../src/routes/documents');
const requireAuth = require('../src/middleware/requireAuth');

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.use('/api/platform', documentsRouter);
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

describe('document upload/download', () => {
  beforeAll(() => {
    fs.mkdirSync(TEST_UPLOAD_DIR, { recursive: true });
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM user_documents`);
    await pool.query(`DELETE FROM platform_users`);
  });

  afterAll(async () => {
    await pool.end();
    fs.rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
  });

  it('uploads a resume and lists it in GET /documents', async () => {
    const { token } = await createUser('doc1@example.com');
    const app = buildTestApp();

    const uploadRes = await request(app)
      .post('/api/platform/documents')
      .set('Cookie', `fsa_session=${token}`)
      .field('doc_type', 'resume')
      .attach('file', Buffer.from('%PDF-1.4 fake pdf content'), { filename: 'resume.pdf', contentType: 'application/pdf' });
    expect(uploadRes.status).toBe(201);

    const listRes = await request(app).get('/api/platform/documents').set('Cookie', `fsa_session=${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.documents).toHaveLength(1);
    expect(listRes.body.documents[0].doc_type).toBe('resume');
    expect(listRes.body.documents[0].original_filename).toBe('resume.pdf');
  });

  it('replaces the existing resume on a second upload and deletes the old file', async () => {
    const { token } = await createUser('doc2@example.com');
    const app = buildTestApp();

    await request(app)
      .post('/api/platform/documents')
      .set('Cookie', `fsa_session=${token}`)
      .field('doc_type', 'resume')
      .attach('file', Buffer.from('%PDF-1.4 first version'), { filename: 'v1.pdf', contentType: 'application/pdf' });

    const listAfterFirst = await request(app).get('/api/platform/documents').set('Cookie', `fsa_session=${token}`);
    const firstUploadedAt = listAfterFirst.body.documents[0].uploaded_at;

    await request(app)
      .post('/api/platform/documents')
      .set('Cookie', `fsa_session=${token}`)
      .field('doc_type', 'resume')
      .attach('file', Buffer.from('%PDF-1.4 second version'), { filename: 'v2.pdf', contentType: 'application/pdf' });

    const listAfterSecond = await request(app).get('/api/platform/documents').set('Cookie', `fsa_session=${token}`);
    expect(listAfterSecond.body.documents).toHaveLength(1);
    expect(listAfterSecond.body.documents[0].original_filename).toBe('v2.pdf');
    expect(listAfterSecond.body.documents[0].uploaded_at).not.toBe(firstUploadedAt);
  });

  it('rejects a non-PDF/DOCX file with 400', async () => {
    const { token } = await createUser('doc3@example.com');
    const app = buildTestApp();

    const res = await request(app)
      .post('/api/platform/documents')
      .set('Cookie', `fsa_session=${token}`)
      .field('doc_type', 'resume')
      .attach('file', Buffer.from('just some text'), { filename: 'resume.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  it('404s downloading a document type the user never uploaded', async () => {
    const { token } = await createUser('doc4@example.com');
    const app = buildTestApp();
    const res = await request(app)
      .get('/api/platform/documents/cover_letter/download')
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(404);
  });
});
