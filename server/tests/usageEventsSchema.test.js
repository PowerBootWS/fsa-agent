const { pool } = require('./testPool');

async function columnsOf(table) {
  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return Object.fromEntries(rows.map((r) => [r.column_name, r]));
}

afterAll(async () => {
  await pool.end();
});

describe('018_usage_events schema', () => {
  it('creates usage_events with the expected columns', async () => {
    const cols = await columnsOf('usage_events');
    expect(Object.keys(cols).sort()).toEqual([
      'action', 'client_session_id', 'event_type', 'id', 'occurred_at',
      'props', 'received_at', 'screen', 'user_id',
    ]);
    expect(cols.user_id.is_nullable).toBe('NO');
    expect(cols.event_type.is_nullable).toBe('NO');
    expect(cols.occurred_at.data_type).toBe('timestamp with time zone');
    expect(cols.props.data_type).toBe('jsonb');
  });

  it('stores no IP or user agent — that is login_events’ job', async () => {
    const cols = await columnsOf('usage_events');
    expect(cols.ip_address).toBeUndefined();
    expect(cols.user_agent).toBeUndefined();
  });

  it('creates the rollup table with a usable primary key', async () => {
    const cols = await columnsOf('usage_events_daily');
    expect(Object.keys(cols).sort()).toEqual([
      'action', 'day', 'event_count', 'event_type', 'screen', 'user_count',
    ]);
    expect(cols.screen.is_nullable).toBe('NO');
    expect(cols.action.is_nullable).toBe('NO');
  });
});
