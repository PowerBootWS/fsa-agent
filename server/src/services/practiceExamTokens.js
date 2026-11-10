const crypto = require('crypto');

const SECRET = process.env.PRACTICE_EXAM_TOKEN_SECRET;
if (!SECRET) {
  throw new Error('PRACTICE_EXAM_TOKEN_SECRET is not set');
}

function toBase64Url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + padding, 'base64');
}

// ttlMs defaults to 8 hours. It was 3, sized for a 50-question exam, but the
// 100-question option has a 3-hour clock of its own and the timer keeps
// counting past zero, so a full-length sitting outlived the token: on
// 2026-11-09 a lead answered 98 of 100 questions, the token expired 19s
// after question 99 appeared, and every later answer was rejected with a
// 401 the page never showed — no results, no error. 8h clears the longest
// realistic sitting; a leaked token still only reaches one free exam.
function sign({ email, classCode, paperCode }, ttlMs = 8 * 60 * 60 * 1000) {
  const payload = JSON.stringify({ email, classCode, paperCode, exp: Date.now() + ttlMs });
  const payloadBuf = Buffer.from(payload, 'utf8');
  const sig = crypto.createHmac('sha256', SECRET).update(payloadBuf).digest();
  return `${toBase64Url(payloadBuf)}.${toBase64Url(sig)}`;
}

function verify(token) {
  try {
    const [payloadPart, sigPart] = String(token).split('.');
    if (!payloadPart || !sigPart) return null;
    const payloadBuf = fromBase64Url(payloadPart);
    const providedSig = fromBase64Url(sigPart);
    const expectedSig = crypto.createHmac('sha256', SECRET).update(payloadBuf).digest();
    if (providedSig.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(expectedSig, providedSig)) return null;
    const parsed = JSON.parse(payloadBuf.toString('utf8'));
    if (!parsed.email || !parsed.classCode || !parsed.paperCode || !parsed.exp) return null;
    if (Date.now() > parsed.exp) return null;
    return parsed; // { email, classCode, paperCode, exp }
  } catch {
    return null;
  }
}

module.exports = { sign, verify };
