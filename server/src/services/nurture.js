// Retry schedule for /intake. Every caller is fire-and-forget, so a single
// attempt meant any nurture restart (each deploy takes it down for a few
// seconds) silently dropped the enrolment: 4 of 62 verified practice-exam
// leads in Aug-Oct 2026 never reached nurture at all (audit 2026-10-21).
// Intake is idempotent, so retrying is safe. 4xx is not retried: the request
// itself is wrong and will stay wrong.
const DEFAULT_RETRY_DELAYS_MS = [5000, 20000, 60000];

function retryDelays() {
  const raw = process.env.NURTURE_RETRY_DELAYS_MS;
  if (raw === undefined) return DEFAULT_RETRY_DELAYS_MS;
  return raw.split(',').filter(Boolean).map(Number);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function enroll({ email, firstName, sequence, source, attrs, delayMinutes }) {
  const nurtureUrl = process.env.NURTURE_URL;
  const intakeKey = process.env.NURTURE_INTAKE_KEY;

  if (!nurtureUrl || !intakeKey) {
    // Thrown, not warned: every caller logs the rejection, and a skipped
    // enrolment is a lost lead.
    throw new Error('NURTURE_URL or NURTURE_INTAKE_KEY not set - nurture intake skipped');
  }

  const delays = retryDelays();
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    let res;
    try {
      res = await fetch(`${nurtureUrl}/intake`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-intake-key': intakeKey,
        },
        body: JSON.stringify({ email, firstName, sequence, source, attrs, delayMinutes }),
      });
    } catch (err) {
      lastErr = err;
      console.warn(`nurture intake attempt ${attempt + 1} failed for ${email} (${sequence}): ${err.message}`);
      continue;
    }

    if (res.ok) return res.json();

    const body = await res.text();
    lastErr = new Error(`Nurture intake failed (${res.status}): ${body}`);
    if (res.status < 500) throw lastErr;
    console.warn(`nurture intake attempt ${attempt + 1} failed for ${email} (${sequence}): HTTP ${res.status}`);
  }
  throw lastErr;
}

module.exports = { enroll };
