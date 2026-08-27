/**
 * The one way to call the FSA API from client-v2 — backlog #68.
 *
 * Every fetch site in this app used to do `await res.json()` with no `res.ok`
 * check. That does not fail loudly: an authenticated route answering 401 with
 * `{"error":"Not authenticated"}` parses fine, so the caller set its state from
 * `undefined` and rendered a blank panel while the error message it already had
 * written sat unused. Cloudflare replacing a 502/504 body with HTML was worse
 * still — `res.json()` threw a SyntaxError from inside a parse nobody expected
 * to fail (the shape of #79).
 *
 * These helpers check the status before parsing and throw `ApiError`. They
 * deliberately do NOT swallow anything or render anything: each call site keeps
 * its own catch and its own user-facing message. All that changes is that a
 * non-2xx now reaches that catch instead of quietly producing undefined.
 */

export class ApiError extends Error {
  constructor(message, { status = 0, url = '', body = null, cause = undefined } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.body = body;
    if (cause !== undefined) this.cause = cause;
  }
}

// A server error body may be JSON with `error` or `message`, or it may be a
// Cloudflare HTML page. Never put a raw body in the message: an HTML error page
// as an error string is unreadable in a log and unusable in the UI.
function messageFromBody(text, status) {
  try {
    const parsed = JSON.parse(text);
    const message = parsed?.error || parsed?.message;
    if (typeof message === 'string' && message.trim()) return { message, body: parsed };
    return { message: `Request failed (${status})`, body: parsed };
  } catch {
    return { message: `Request failed (${status})`, body: null };
  }
}

async function request(url, options = {}) {
  let res;
  try {
    res = await fetch(url, { credentials: 'include', ...options });
  } catch (cause) {
    // Offline, DNS, connection reset. Wrapped so every caller has one type to
    // reason about; status 0 distinguishes it from any HTTP answer.
    throw new ApiError('Could not reach the server', { status: 0, url, cause });
  }

  const text = await res.text();

  if (!res.ok) {
    const { message, body } = messageFromBody(text, res.status);
    throw new ApiError(message, { status: res.status, url, body });
  }

  // A 204, or a 200 with no body, is a success with nothing to parse.
  if (text.trim() === '') return null;

  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ApiError('The server sent a response we could not read', {
      status: res.status, url, cause,
    });
  }
}

export function getJson(url, options = {}) {
  return request(url, { ...options, method: 'GET' });
}

export function sendJson(method, url, body, options = {}) {
  return request(url, {
    ...options,
    method,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function postJson(url, body, options = {}) {
  return sendJson('POST', url, body, options);
}

export default { getJson, postJson, sendJson, ApiError };
