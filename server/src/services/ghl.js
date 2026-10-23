// GHL client for text-message coaching only (backlog #139 phase 4).
//
// The one deliberate exception to "no FSA system writes a contact to GHL"
// (2026-09-16, #121): a student who opts in to text check-ins becomes a GHL
// contact, tagged fsa-texting, because GHL is the platform already set up to
// send texts from FSA's Canadian number. Nothing else is synced. Our own
// coaching_texts table is the official record of every message.
//
// Auth is the location's private integration token (GHL_API_KEY). It can't
// subscribe to webhooks, so new texts are found by polling (scripts/coaching_texts.js).

const BASE = 'https://services.leadconnectorhq.com';
const TEXTING_TAG = 'fsa-texting';

function creds() {
  const key = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!key || !locationId) throw new Error('GHL_API_KEY / GHL_LOCATION_ID not set');
  return { key, locationId };
}

async function call(method, path, { body, version = '2021-07-28', fetchFn = fetch } = {}) {
  const { key } = creds();
  const res = await fetchFn(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Version: version,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || text;
    throw new Error(`GHL ${method} ${path.split('?')[0]} -> ${res.status}: ${String(msg).slice(0, 200)}`);
  }
  return data;
}

/** Create or update the student's GHL contact. Returns its id. */
async function upsertTextingContact({ firstName, lastName, email, phone }, opts = {}) {
  const { locationId } = creds();
  const data = await call('POST', '/contacts/upsert', {
    ...opts,
    body: { locationId, firstName, lastName, email, phone, tags: [TEXTING_TAG], source: 'FSA text check-ins (opt-in)' },
  });
  const id = data?.contact?.id;
  if (!id) throw new Error('GHL upsert returned no contact id');
  return id;
}

/** Send one text. Returns { messageId, conversationId }. */
async function sendText(contactId, message, opts = {}) {
  const data = await call('POST', '/conversations/messages', {
    ...opts, version: '2021-04-15', body: { type: 'SMS', contactId, message },
  });
  return { messageId: data?.messageId || data?.id || null, conversationId: data?.conversationId || null };
}

/** Conversations with recent activity, newest first. */
async function recentConversations({ limit = 50 } = {}, opts = {}) {
  const { locationId } = creds();
  const q = new URLSearchParams({ locationId, limit: String(limit), sort: 'desc', sortBy: 'last_message_date' });
  const data = await call('GET', `/conversations/search?${q}`, { ...opts, version: '2021-04-15' });
  return data?.conversations || [];
}

/** Latest messages in one conversation, newest first. */
async function conversationMessages(conversationId, { limit = 20 } = {}, opts = {}) {
  const data = await call('GET', `/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`, { ...opts, version: '2021-04-15' });
  return data?.messages?.messages || [];
}

module.exports = { upsertTextingContact, sendText, recentConversations, conversationMessages, TEXTING_TAG };
