const fs = require('fs');
const path = require('path');
const { MAX_BATCH, clampOccurredAt, validateBatch } = require('../src/services/usageEvents');

const NOW = new Date('2026-09-04T12:00:00.000Z');

describe('clampOccurredAt', () => {
  it('keeps a sane timestamp', () => {
    const at = '2026-09-04T11:59:00.000Z';
    expect(clampOccurredAt(at, NOW).toISOString()).toBe(at);
  });

  it('clamps a timestamp from the future', () => {
    expect(clampOccurredAt('2026-09-04T12:30:00.000Z', NOW)).toEqual(NOW);
  });

  it('clamps a timestamp older than 24 hours', () => {
    expect(clampOccurredAt('2026-09-01T12:00:00.000Z', NOW)).toEqual(NOW);
  });

  it('falls back to received_at on garbage', () => {
    expect(clampOccurredAt('not a date', NOW)).toEqual(NOW);
    expect(clampOccurredAt(undefined, NOW)).toEqual(NOW);
  });
});

describe('validateBatch', () => {
  it('accepts an allowlisted screen_view and normalises it', () => {
    const { rows, dropped } = validateBatch(
      [{ type: 'screen_view', screen: '/lobby', props: { a: 1 }, session_id: 'sess-1', at: NOW.toISOString() }],
      NOW
    );
    expect(dropped).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_type: 'screen_view',
      screen: '/lobby',
      action: null,
      props: { a: 1 },
      client_session_id: 'sess-1',
    });
  });

  it('accepts an allowlisted feature_use', () => {
    const { rows } = validateBatch([{ type: 'feature_use', action: 'paper_switched', at: NOW.toISOString() }], NOW);
    expect(rows[0]).toMatchObject({ event_type: 'feature_use', action: 'paper_switched', screen: null });
  });

  it('drops an off-allowlist screen but keeps the rest of the batch', () => {
    const { rows, dropped } = validateBatch(
      [
        { type: 'screen_view', screen: '/login', at: NOW.toISOString() },
        { type: 'screen_view', screen: '/lobby', at: NOW.toISOString() },
      ],
      NOW
    );
    expect(dropped).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].screen).toBe('/lobby');
  });

  it('drops an unknown event type and an off-allowlist action', () => {
    const { rows, dropped } = validateBatch(
      [
        { type: 'rage_click', at: NOW.toISOString() },
        { type: 'feature_use', action: 'not_a_real_action', at: NOW.toISOString() },
      ],
      NOW
    );
    expect(rows).toHaveLength(0);
    expect(dropped).toBe(2);
  });

  it('drops non-objects and nulls without throwing', () => {
    const { rows, dropped } = validateBatch([null, 'nope', 42], NOW);
    expect(rows).toHaveLength(0);
    expect(dropped).toBe(3);
  });

  it('replaces a non-object or oversized props with an empty object', () => {
    const huge = { blob: 'x'.repeat(3000) };
    const { rows } = validateBatch(
      [
        { type: 'screen_view', screen: '/lobby', props: 'not-an-object', at: NOW.toISOString() },
        { type: 'screen_view', screen: '/lobby', props: huge, at: NOW.toISOString() },
      ],
      NOW
    );
    expect(rows[0].props).toEqual({});
    expect(rows[1].props).toEqual({});
  });

  it('rejects an over-long session id rather than storing it', () => {
    const { rows } = validateBatch(
      [{ type: 'screen_view', screen: '/lobby', session_id: 'x'.repeat(100), at: NOW.toISOString() }],
      NOW
    );
    expect(rows[0].client_session_id).toBeNull();
  });

  it('ignores an action sent alongside a screen_view', () => {
    const { rows } = validateBatch(
      [{ type: 'screen_view', screen: '/lobby', action: 'paper_switched', at: NOW.toISOString() }],
      NOW
    );
    expect(rows[0].action).toBeNull();
  });
});

describe('taxonomy parity', () => {
  it('server and client taxonomies are identical', () => {
    const server = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/config/usageTaxonomy.json'), 'utf8'));
    const client = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../client-v2/src/utils/usageTaxonomy.json'), 'utf8')
    );
    expect(client).toEqual(server);
  });
});

describe('MAX_BATCH', () => {
  it('is 50', () => {
    expect(MAX_BATCH).toBe(50);
  });
});
