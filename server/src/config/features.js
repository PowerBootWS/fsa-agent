// Per-user feature switches, read from env allow-lists (no flags table yet).
//
// TUTOR_V2_EMAILS — lesson tutor redesign, slice 4 (check-in cards + tutor
// drawer). Comma-separated emails, or `*` for everyone. Fails closed: unset
// or empty turns it on for nobody.
// docs/superpowers/specs/2026-10-13-lesson-tutor-redesign.md
function allowList(name) {
  return (process.env[name] || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function enabledFor(name, email) {
  const list = allowList(name);
  if (list.includes('*')) return true;
  const e = (email || '').trim().toLowerCase();
  return Boolean(e) && list.includes(e);
}

function featuresFor(email) {
  return { tutor_v2: enabledFor('TUTOR_V2_EMAILS', email) };
}

module.exports = { featuresFor };
