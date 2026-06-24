const GHL_API_BASE = 'https://services.leadconnectorhq.com';

async function upsertContact({ email, firstName, lastName, phone, address, tags }) {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    console.warn('GHL_API_KEY or GHL_LOCATION_ID not set — skipping GHL upsert');
    return;
  }

  // /contacts/upsert keys on locationId + email, so this updates the existing
  // contact in place (no duplicate). Only include fields that were provided so a
  // partial upsert never blanks out data already on the contact.
  const body = { locationId, email, firstName };
  if (lastName != null) body.lastName = lastName;
  if (phone != null) body.phone = phone;
  // The LMS stores a single free-text mailing address; GHL's address1 is a plain
  // string field, so map the whole value there.
  if (address != null) body.address1 = address;
  if (Array.isArray(tags) && tags.length > 0) {
    body.tags = tags;
  }

  const res = await fetch(`${GHL_API_BASE}/contacts/upsert`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GHL upsert failed (${res.status}): ${body}`);
  }

  return res.json();
}

async function lookupContactByEmail(email) {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) return null;

  // POST /contacts/search supports exact email matching via the filters body
  const res = await fetch(`${GHL_API_BASE}/contacts/search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      locationId,
      filters: [{ field: 'email', operator: 'eq', value: email }],
      pageLimit: 1,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.contacts?.[0] || null;
}

async function sendEmail({ contactId, subject, html, message }) {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey || !contactId) throw new Error('Missing apiKey or contactId');

  const res = await fetch(`${GHL_API_BASE}/conversations/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-04-15',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'Email', contactId, subject, html, message }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL sendEmail failed (${res.status}): ${text}`);
  }

  return res.json();
}

module.exports = { upsertContact, lookupContactByEmail, sendEmail };
