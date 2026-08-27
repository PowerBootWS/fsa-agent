/**
 * Backlog #68 — 21 fetch sites called `res.json()` without ever checking
 * `res.ok`.
 *
 * The symptom is a blank or stuck UI rather than an error message: on a 401,
 * `CreditsPage` set `balance` to `undefined` and rendered nothing, while the
 * "Could not load credits" string it already had sat unused. Worse, Cloudflare
 * replaces 502/504 bodies with HTML, so `res.json()` threw a SyntaxError from
 * inside a parse the caller never expected to fail (same class as #79).
 *
 * These call sites are error paths in the app students are using right now, so
 * the fix is one helper tested hard rather than 21 hand-rolled checks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getJson, postJson, sendJson, ApiError } from './api';

const jsonResponse = (body, { status = 200, ok = status < 400 } = {}) => ({
  ok, status,
  text: async () => JSON.stringify(body),
});
const textResponse = (text, { status = 200, ok = status < 400 } = {}) => ({
  ok, status,
  text: async () => text,
});

beforeEach(() => { globalThis.fetch = vi.fn(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('getJson', () => {
  it('returns the parsed body on success', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ balance: 12 }));
    await expect(getJson('/api/platform/credits')).resolves.toEqual({ balance: 12 });
  });

  it('sends cookies, because every one of these routes is authenticated', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({}));
    await getJson('/api/platform/credits');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/platform/credits',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('throws instead of returning undefined fields on a 401', async () => {
    // The whole bug: this used to resolve, and the caller set state from
    // `undefined` and rendered a blank panel.
    globalThis.fetch.mockResolvedValue(jsonResponse({ error: 'Not authenticated' }, { status: 401 }));
    await expect(getJson('/api/platform/credits')).rejects.toBeInstanceOf(ApiError);
  });

  it('surfaces the server\'s own error message when it sends one', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ error: 'Not authenticated' }, { status: 401 }));
    await expect(getJson('/api/x')).rejects.toThrow('Not authenticated');
  });

  it('accepts `message` as well as `error`', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ message: 'Session expired' }, { status: 403 }));
    await expect(getJson('/api/x')).rejects.toThrow('Session expired');
  });

  it('does not choke on an HTML error body', async () => {
    // Cloudflare replaces 502/504 bodies with an HTML error page, which is how
    // a dead practice-exam UI happened in #79.
    globalThis.fetch.mockResolvedValue(textResponse('<!DOCTYPE html><title>502</title>', { status: 502 }));
    const error = await getJson('/api/x').catch(e => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.message).not.toContain('<!DOCTYPE');
  });

  it('throws ApiError when a 200 body is not JSON', async () => {
    globalThis.fetch.mockResolvedValue(textResponse('not json at all'));
    const error = await getJson('/api/x').catch(e => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(200);
  });

  it('treats an empty 200 body as null rather than an error', async () => {
    // 204-style responses are legitimate on the PATCH/DELETE routes.
    globalThis.fetch.mockResolvedValue(textResponse('', { status: 200 }));
    await expect(getJson('/api/x')).resolves.toBeNull();
  });

  it('wraps a network failure so callers have one error type', async () => {
    globalThis.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await getJson('/api/x').catch(e => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it('carries status and url for logging', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ error: 'nope' }, { status: 500 }));
    const error = await getJson('/api/platform/credits').catch(e => e);
    expect(error.status).toBe(500);
    expect(error.url).toBe('/api/platform/credits');
  });
});

describe('postJson', () => {
  it('sends a JSON body with the right content type', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ ok: true }));
    await postJson('/api/v2/checkpoint', { session_id: 7 });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/v2/checkpoint', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ session_id: 7 }),
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }));
  });

  it('applies the same status checking as getJson', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ error: 'Bad request' }, { status: 400 }));
    await expect(postJson('/api/x', {})).rejects.toThrow('Bad request');
  });

  it('allows extra headers without losing the content type', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({}));
    await postJson('/api/x', {}, { headers: { 'X-Thing': '1' } });
    const headers = globalThis.fetch.mock.calls[0][1].headers;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Thing']).toBe('1');
  });
});

describe('sendJson', () => {
  it('supports the other verbs the app uses', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({}));
    await sendJson('PATCH', '/api/v2/session/7', { last_section: 5 });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/v2/session/7',
      expect.objectContaining({ method: 'PATCH' }));
  });
});

describe('ApiError', () => {
  it('is an Error with a useful name', () => {
    const error = new ApiError('boom', { status: 500, url: '/api/x' });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
  });
});
