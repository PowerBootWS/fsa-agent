jest.mock('../src/services/email');

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const platformRouter = require('../src/routes/platform');

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'provann-%@example.com';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/platform', platformRouter);
  return app;
}

function provision(app, body) {
  return request(app)
    .post('/api/platform/provision-user')
    .set('x-internal-secret', 'test-internal-secret')
    .send(body);
}

async function activeRows(email) {
  const rows = await pool.query(
    `SELECT s.class_code, s.active_paper, s.stripe_subscription_id, s.status
       FROM subscriptions s JOIN platform_users u ON u.id = s.user_id
      WHERE u.email = $1 AND s.status = 'active'
      ORDER BY s.class_code`,
    [email]
  );
  return rows.rows;
}

describe('provision-user — monthly to annual upgrade', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, INTERNAL_SECRET: 'test-internal-secret' };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('replaces the monthly row, carries the active paper across, and reports the subscription to stop billing', async () => {
    const app = buildTestApp();
    const email = 'provann-upgrade@example.com';

    await provision(app, {
      email, first_name: 'Up', last_name: 'Grader',
      class_code: 'second', stripe_subscription_id: 'sub_monthly_1', billing_interval: 'month',
    });
    // The student has been studying a paper — the upgrade must not lose it.
    await pool.query(
      `UPDATE subscriptions SET active_paper = '2B1'
        WHERE stripe_subscription_id = 'sub_monthly_1'`
    );

    const res = await provision(app, {
      email, first_name: 'Up', last_name: 'Grader',
      class_code: 'second', stripe_subscription_id: 'sub_annual_1', billing_interval: 'year',
    });

    expect(res.status).toBe(200);
    expect(res.body.replaced_subscription_id).toBe('sub_monthly_1');

    const active = await activeRows(email);
    expect(active).toHaveLength(1);
    expect(active[0].class_code).toBe('second');
    expect(active[0].stripe_subscription_id).toBe('sub_annual_1');
    expect(active[0].active_paper).toBe('2B1');

    const old = await pool.query(
      `SELECT status, deactivated_at FROM subscriptions WHERE stripe_subscription_id = 'sub_monthly_1'`
    );
    expect(old.rows[0].status).toBe('inactive');
    expect(old.rows[0].deactivated_at).not.toBeNull();
  });

  it('still blocks an annual purchase of a DIFFERENT class than the one already held (cross-tier rule unchanged)', async () => {
    const app = buildTestApp();
    const email = 'provann-crosstier@example.com';

    await provision(app, {
      email, first_name: 'Cross', last_name: 'Tier',
      class_code: 'second', stripe_subscription_id: 'sub_monthly_2', billing_interval: 'month',
    });
    const res = await provision(app, {
      email, first_name: 'Cross', last_name: 'Tier',
      class_code: 'third', stripe_subscription_id: 'sub_annual_2', billing_interval: 'year',
    });

    expect(res.status).toBe(200);
    expect(res.body.replaced_subscription_id).toBeNull();
    const active = await activeRows(email);
    expect(active).toHaveLength(1);
    expect(active[0].class_code).toBe('second');
    expect(active[0].stripe_subscription_id).toBe('sub_monthly_2');
  });

  // Owner decision 2026-10-21: stepping UP a class ends the lower class automatically
  // and hands back its Stripe subscription(s) so the listener stops the billing.
  it('step-up 3rd -> 2nd ends the 3rd Class row and reports its subscription to stop', async () => {
    const app = buildTestApp();
    const email = 'provann-stepup-32@example.com';
    await provision(app, { email, first_name: 'Step', last_name: 'Up', class_code: 'third', stripe_subscription_id: 'sub_third_m', billing_interval: 'month' });
    const res = await provision(app, { email, first_name: 'Step', last_name: 'Up', class_code: 'second', stripe_subscription_id: 'sub_second_m', billing_interval: 'month' });

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
    expect(res.body.replaced_subscription_ids).toEqual(['sub_third_m']);
    const active = await activeRows(email);
    expect(active.map(r => r.class_code)).toEqual(['second']);
    expect(active[0].stripe_subscription_id).toBe('sub_second_m');
  });

  it('stepping up from 4th Class to 3rd KEEPS both 4th papers (study aids for jurisdictional rewrites)', async () => {
    const app = buildTestApp();
    const email = 'provann-stepup-43@example.com';
    await provision(app, { email, first_name: 'Step', last_name: 'Up', class_code: 'fourth_a', stripe_subscription_id: 'sub_4a', billing_interval: 'year' });
    await provision(app, { email, first_name: 'Step', last_name: 'Up', class_code: 'fourth_b', stripe_subscription_id: 'sub_4b', billing_interval: 'year' });
    const res = await provision(app, { email, first_name: 'Step', last_name: 'Up', class_code: 'third', stripe_subscription_id: 'sub_third_y', billing_interval: 'year' });

    expect(res.body.blocked).toBe(false);
    expect(res.body.replaced_subscription_ids).toEqual([]);
    expect((await activeRows(email)).map(r => r.class_code)).toEqual(['fourth_a', 'fourth_b', 'third']);
  });

  it('stepping DOWN (2nd -> 3rd) is still refused and reported as blocked', async () => {
    const app = buildTestApp();
    const email = 'provann-stepdown@example.com';
    await provision(app, { email, first_name: 'Step', last_name: 'Down', class_code: 'second', stripe_subscription_id: 'sub_2', billing_interval: 'month' });
    const res = await provision(app, { email, first_name: 'Step', last_name: 'Down', class_code: 'third', stripe_subscription_id: 'sub_3', billing_interval: 'month' });

    expect(res.body.blocked).toBe(true);
    expect(res.body.replaced_subscription_ids).toEqual([]);
    expect((await activeRows(email)).map(r => r.class_code)).toEqual(['second']);
  });

  it('does not treat a repeat 4th Class purchase as an upgrade even though 4th Class is annual', async () => {
    const app = buildTestApp();
    const email = 'provann-fourth@example.com';

    await provision(app, {
      email, first_name: 'Fourth', last_name: 'Again',
      class_code: 'fourth_a', stripe_subscription_id: 'sub_4a_first', billing_interval: 'year',
    });
    const res = await provision(app, {
      email, first_name: 'Fourth', last_name: 'Again',
      class_code: 'fourth_a', stripe_subscription_id: 'sub_4a_second', billing_interval: 'year',
    });

    expect(res.body.replaced_subscription_id).toBeNull();
    const active = await activeRows(email);
    expect(active).toHaveLength(1);
    expect(active[0].stripe_subscription_id).toBe('sub_4a_first');
  });

  it('a second monthly purchase is still blocked — only an annual replaces', async () => {
    const app = buildTestApp();
    const email = 'provann-monthly-dupe@example.com';

    await provision(app, {
      email, first_name: 'Dupe', last_name: 'Monthly',
      class_code: 'second', stripe_subscription_id: 'sub_monthly_3', billing_interval: 'month',
    });
    const res = await provision(app, {
      email, first_name: 'Dupe', last_name: 'Monthly',
      class_code: 'second', stripe_subscription_id: 'sub_monthly_4', billing_interval: 'month',
    });

    expect(res.body.replaced_subscription_id).toBeNull();
    const active = await activeRows(email);
    expect(active).toHaveLength(1);
    expect(active[0].stripe_subscription_id).toBe('sub_monthly_3');
  });
});
