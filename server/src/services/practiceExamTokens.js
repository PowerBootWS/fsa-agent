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

// ttlMs defaults to 3 hours — enough for a 50-question timed exam plus
// some slack, short enough that a leaked token isn't a long-lived credential.
function sign({ email, classCode, paperCode }, ttlMs = 3 * 60 * 60 * 1000) {
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
