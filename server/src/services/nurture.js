async function enroll({ email, firstName, sequence, source }) {
  const nurtureUrl = process.env.NURTURE_URL;
  const intakeKey = process.env.NURTURE_INTAKE_KEY;

  if (!nurtureUrl || !intakeKey) {
    console.warn('NURTURE_URL or NURTURE_INTAKE_KEY not set - skipping nurture intake');
    return;
  }

  const res = await fetch(`${nurtureUrl}/intake`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-intake-key': intakeKey,
    },
    body: JSON.stringify({ email, firstName, sequence, source }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Nurture intake failed (${res.status}): ${body}`);
  }

  return res.json();
}

module.exports = { enroll };
