import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { track, flush, startUsageFlushing, __resetForTests } from './usage';

beforeEach(() => {
  __resetForTests();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('fsa_user', JSON.stringify({ email: 'a@test.example' }));
  global.fetch = vi.fn(() => Promise.resolve(new Response('', { status: 204 })));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('track', () => {
  it('queues nothing when the user is not logged in', async () => {
    localStorage.removeItem('fsa_user');
    track('screen_view', { screen: '/lobby' });
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('queues nothing for an off-allowlist screen', async () => {
    track('screen_view', { screen: '/login' });
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('queues nothing for an off-allowlist action', async () => {
    track('feature_use', { action: 'not_real' });
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends a queued screen_view on flush', async () => {
    track('screen_view', { screen: '/lobby', props: { x: 1 } });
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ type: 'screen_view', screen: '/lobby', props: { x: 1 } });
    expect(body.events[0].at).toBeTruthy();
  });

  it('reuses one session id across events and persists it in sessionStorage', async () => {
    track('screen_view', { screen: '/lobby' });
    track('screen_view', { screen: '/jobs' });
    await flush();
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.events[0].session_id).toBe(body.events[1].session_id);
    expect(sessionStorage.getItem('fsa_usage_session')).toBe(body.events[0].session_id);
  });

  it('never sends more than 50 events in one request', async () => {
    for (let i = 0; i < 60; i += 1) track('screen_view', { screen: '/lobby' });
    await flush();
    await flush();
    const first = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(first.events.length).toBeLessThanOrEqual(50);
  });
});

describe('flush', () => {
  it('does nothing on an empty queue', async () => {
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('never throws when the request fails', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('offline')));
    track('screen_view', { screen: '/lobby' });
    await expect(flush()).resolves.toBeUndefined();
  });

  it('uses sendBeacon when asked for one', async () => {
    const sendBeacon = vi.fn(() => true);
    navigator.sendBeacon = sendBeacon;
    track('screen_view', { screen: '/lobby' });
    await flush({ beacon: true });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe('/api/events');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to fetch when sendBeacon is unavailable', async () => {
    navigator.sendBeacon = undefined;
    track('screen_view', { screen: '/lobby' });
    await flush({ beacon: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('startUsageFlushing', () => {
  it('flushes on the timer and stops after teardown', async () => {
    vi.useFakeTimers();
    const stop = startUsageFlushing();
    track('screen_view', { screen: '/lobby' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    stop();
    track('screen_view', { screen: '/jobs' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('flushes with a beacon when the page is hidden', async () => {
    const sendBeacon = vi.fn(() => true);
    navigator.sendBeacon = sendBeacon;
    const stop = startUsageFlushing();
    track('screen_view', { screen: '/lobby' });

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    stop();
  });
});
