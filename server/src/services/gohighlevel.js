const GHL_API_BASE = 'https://services.leadconnectorhq.com';

async function upsertContact({ email, firstName, tags }) {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    console.warn('GHL_API_KEY or GHL_LOCATION_ID not set — skipping GHL upsert');
    return;
  }

  const body = { locationId, email, firstName };
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

module.exports = { upsertContact };
