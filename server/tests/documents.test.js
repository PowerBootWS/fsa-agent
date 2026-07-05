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
const { pool: routerPool } = require('../src/services/database');

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
    const { token, userId } = await createUser('doc2@example.com');
    const app = buildTestApp();

    await request(app)
      .post('/api/platform/documents')
      .set('Cookie', `fsa_session=${token}`)
      .field('doc_type', 'resume')
      .attach('file', Buffer.from('%PDF-1.4 first version'), { filename: 'v1.pdf', contentType: 'application/pdf' });

    const listAfterFirst = await request(app).get('/api/platform/documents').set('Cookie', `fsa_session=${token}`);
    const firstUploadedAt = listAfterFirst.body.documents[0].uploaded_at;

    const firstRow = await pool.query(
      `SELECT storage_path FROM user_documents WHERE user_id = $1 AND doc_type = 'resume'`,
      [userId]
    );
    const firstStoragePath = firstRow.rows[0].storage_path;
    expect(fs.existsSync(firstStoragePath)).toBe(true);

    await request(app)
      .post('/api/platform/documents')
      .set('Cookie', `fsa_session=${token}`)
      .field('doc_type', 'resume')
      .attach('file', Buffer.from('%PDF-1.4 second version'), { filename: 'v2.pdf', contentType: 'application/pdf' });

    const listAfterSecond = await request(app).get('/api/platform/documents').set('Cookie', `fsa_session=${token}`);
    expect(listAfterSecond.body.documents).toHaveLength(1);
    expect(listAfterSecond.body.documents[0].original_filename).toBe('v2.pdf');
    expect(listAfterSecond.body.documents[0].uploaded_at).not.toBe(firstUploadedAt);

    expect(fs.existsSync(firstStoragePath)).toBe(false);
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

  it('404s cleanly (not a 500 with mismatched headers) when the DB row outlives the file on disk', async () => {
    const { token, userId } = await createUser('doc5@example.com');
    const app = buildTestApp();

    await request(app)
      .post('/api/platform/documents')
      .set('Cookie', `fsa_session=${token}`)
      .field('doc_type', 'resume')
      .attach('file', Buffer.from('%PDF-1.4 will vanish'), { filename: 'ghost.pdf', contentType: 'application/pdf' });

    const row = await pool.query(
      `SELECT storage_path FROM user_documents WHERE user_id = $1 AND doc_type = 'resume'`,
      [userId]
    );
    const storagePath = row.rows[0].storage_path;
    fs.unlinkSync(storagePath); // remove the file directly, leaving the DB row intact

    const res = await request(app)
      .get('/api/platform/documents/resume/download')
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: 'File missing on disk' });
  });

  it('returns a clean 500 instead of crashing the process when pool.connect() rejects', async () => {
    const { token } = await createUser('doc6@example.com');
    const app = buildTestApp();

    const connectSpy = jest
      .spyOn(routerPool, 'connect')
      .mockRejectedValueOnce(new Error('connection refused'));

    try {
      const res = await request(app)
        .post('/api/platform/documents')
        .set('Cookie', `fsa_session=${token}`)
        .field('doc_type', 'resume')
        .attach('file', Buffer.from('%PDF-1.4 pool exhausted'), { filename: 'resume.pdf', contentType: 'application/pdf' });

      // The whole point of moving pool.connect() inside the try/catch is that a
      // rejection here is handled like any other error — a normal 500 JSON
      // response — rather than an unhandled promise rejection that would crash
      // the Node process (there's no express-async-errors / unhandledRejection
      // handler in this codebase).
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
    } finally {
      connectSpy.mockRestore();
    }
  });
});
