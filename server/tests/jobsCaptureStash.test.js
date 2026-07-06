const request = require('supertest');
const express = require('express');
const jobsRouter = require('../src/routes/jobs');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/jobs', jobsRouter);
  return app;
}

describe('jobs capture-stash (unauthenticated save handoff)', () => {
  it('stashes a job payload and returns it via the token, without requiring auth', async () => {
    const app = buildTestApp();

    const stashRes = await request(app).post('/api/jobs/capture-stash').send({
      job_id: 'jb-42',
      title: 'Utility Operator',
      company: 'Acme Plant',
      url: 'https://example.com/job/42',
      posted_at: '2026-07-01',
      description: 'Full posting text.',
      ai_summary: 'AI summary text.',
      location: 'Calgary, AB',
      class_level: '3rd Class',
      employer_logo_url: 'https://example.com/logo.png',
    });
    expect(stashRes.status).toBe(201);
    expect(stashRes.body.token).toBeTruthy();

    const readRes = await request(app).get(`/api/jobs/capture-stash/${stashRes.body.token}`);
    expect(readRes.status).toBe(200);
    expect(readRes.body).toMatchObject({
      job_id: 'jb-42',
      title: 'Utility Operator',
      company: 'Acme Plant',
      url: 'https://example.com/job/42',
      posted_at: '2026-07-01',
      description: 'Full posting text.',
      ai_summary: 'AI summary text.',
      location: 'Calgary, AB',
      class_level: '3rd Class',
      employer_logo_url: 'https://example.com/logo.png',
    });
  });

  it('requires title and url', async () => {
    const app = buildTestApp();
    const res = await request(app).post('/api/jobs/capture-stash').send({ title: 'Missing URL' });
    expect(res.status).toBe(400);
  });

  it('404s reading an unknown or expired token', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/api/jobs/capture-stash/not-a-real-token');
    expect(res.status).toBe(404);
  });

  it('can be read more than once (survives a login round trip)', async () => {
    const app = buildTestApp();
    const stashRes = await request(app).post('/api/jobs/capture-stash').send({
      title: 'Re-readable Job', url: 'https://example.com/job/99',
    });
    const token = stashRes.body.token;

    const firstRead = await request(app).get(`/api/jobs/capture-stash/${token}`);
    expect(firstRead.status).toBe(200);
    const secondRead = await request(app).get(`/api/jobs/capture-stash/${token}`);
    expect(secondRead.status).toBe(200);
  });
});
