const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const jobsRouter = require('../src/routes/jobs');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/jobs', jobsRouter);
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

describe('saved jobs', () => {
  afterEach(async () => {
    await pool.query(`DELETE FROM saved_jobs`);
    await pool.query(`DELETE FROM platform_users`);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('saves a job from fsa-jobs-bot and lists it', async () => {
    const { token } = await createUser('jobs1@example.com');
    const app = buildTestApp();

    const saveRes = await request(app).post('/api/jobs/save').set('Cookie', `fsa_session=${token}`).send({
      source_job_id: 'jb-123',
      title: '4th Class Power Engineer',
      company: 'Acme Plant',
      location: 'Sudbury, ON',
      job_class_label: '4th Class',
      url: 'https://example.com/job/123',
      description_snapshot: 'Full description text.',
      posted_at: '2026-06-28',
    });
    expect(saveRes.status).toBe(201);

    const listRes = await request(app).get('/api/jobs').set('Cookie', `fsa_session=${token}`);
    expect(listRes.body.jobs).toHaveLength(1);
    expect(listRes.body.jobs[0].status).toBe('saved');
    expect(listRes.body.jobs[0].posted_at).toBe('2026-06-28');
  });

  it('is idempotent when saving the same source_job_id twice', async () => {
    const { token } = await createUser('jobs2@example.com');
    const app = buildTestApp();
    const payload = { source_job_id: 'jb-999', title: 'Boiler Operator', url: 'https://example.com/job/999' };

    await request(app).post('/api/jobs/save').set('Cookie', `fsa_session=${token}`).send(payload);
    const secondRes = await request(app).post('/api/jobs/save').set('Cookie', `fsa_session=${token}`).send(payload);
    expect(secondRes.body.already_saved).toBe(true);

    const listRes = await request(app).get('/api/jobs').set('Cookie', `fsa_session=${token}`);
    expect(listRes.body.jobs).toHaveLength(1);
  });

  it('allows a manually-pasted job with no source_job_id', async () => {
    const { token } = await createUser('jobs3@example.com');
    const app = buildTestApp();
    const res = await request(app).post('/api/jobs/save').set('Cookie', `fsa_session=${token}`).send({
      title: 'Plant Operator', url: 'https://otherboard.example.com/job/1',
    });
    expect(res.status).toBe(201);
  });

  it('updates status to applied and stamps applied_at', async () => {
    const { token } = await createUser('jobs4@example.com');
    const app = buildTestApp();
    const saveRes = await request(app).post('/api/jobs/save').set('Cookie', `fsa_session=${token}`).send({
      title: 'Utility Operator', url: 'https://example.com/job/4',
    });
    const jobId = saveRes.body.id;

    const patchRes = await request(app).patch(`/api/jobs/${jobId}`).set('Cookie', `fsa_session=${token}`).send({ status: 'applied' });
    expect(patchRes.status).toBe(200);

    const listRes = await request(app).get('/api/jobs').set('Cookie', `fsa_session=${token}`);
    expect(listRes.body.jobs[0].status).toBe('applied');
    expect(listRes.body.jobs[0].applied_at).not.toBeNull();
  });

  it('404s updating a job that belongs to a different user', async () => {
    const userA = await createUser('jobs5a@example.com');
    const userB = await createUser('jobs5b@example.com');
    const app = buildTestApp();
    const saveRes = await request(app).post('/api/jobs/save').set('Cookie', `fsa_session=${userA.token}`).send({
      title: 'Steam Engineer', url: 'https://example.com/job/5',
    });
    const jobId = saveRes.body.id;

    const patchRes = await request(app).patch(`/api/jobs/${jobId}`).set('Cookie', `fsa_session=${userB.token}`).send({ status: 'applied' });
    expect(patchRes.status).toBe(404);
  });

  it('deletes a job', async () => {
    const { token } = await createUser('jobs6@example.com');
    const app = buildTestApp();
    const saveRes = await request(app).post('/api/jobs/save').set('Cookie', `fsa_session=${token}`).send({
      title: 'Deletable Job', url: 'https://example.com/job/6',
    });
    const jobId = saveRes.body.id;

    const deleteRes = await request(app).delete(`/api/jobs/${jobId}`).set('Cookie', `fsa_session=${token}`);
    expect(deleteRes.status).toBe(200);

    const listRes = await request(app).get('/api/jobs').set('Cookie', `fsa_session=${token}`);
    expect(listRes.body.jobs).toHaveLength(0);
  });
});
