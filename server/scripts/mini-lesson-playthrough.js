#!/usr/bin/env node
// Plays a mini lesson the way a student on a phone would, before it goes live.
//
//   node mini-lesson-playthrough.js <url> [--expect-pitch <url>] [--expect-version <N>]
//
// <url> is https://learn.fullsteamahead.ca/explained/<slug>[?preview=<token>].
// Prints one JSON line {ok, failures[]} on stdout and exits 0 (ok) or 1.
//
// Checks:
//  - the raw HTML (no JS) carries the Open Graph tags, and og:image returns 200
//  - with --expect-version N: the page serves draft version N (not a newer
//    rebuild's draft, not the live version)
//  - every slide's image_url and audio_url returns 200 as image/png / audio/mpeg
//    (og:image as image/png), so an HTML page answering 200 doesn't pass
//  - in Chromium at 390x844 with a fresh, cookie-less context, every slide
//    renders (title, image, no KaTeX error), then every question step is
//    answered wrong on one pass and right on another, checking the marking,
//    the verdict and the explanation text
//  - the pitch button links to the expected enrol URL
// Called by fsa-lesson-creator's mini_lesson.py (env MINI_LESSON_PLAYTHROUGH).
const { chromium } = require('playwright');

const VIEWPORT = { width: 390, height: 844 };
const STEP_TIMEOUT_MS = 15000;
const SITE = 'https://fullsteamahead.ca';

function parseArgs(argv) {
  const out = { url: null, expectPitch: null, expectVersion: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--expect-pitch') out.expectPitch = argv[++i];
    else if (argv[i] === '--expect-version') out.expectVersion = parseInt(argv[++i], 10);
    else if (!out.url) out.url = argv[i];
  }
  return out;
}

function metaContent(html, prop) {
  const re = new RegExp(`<meta\\s+property="${prop}"\\s+content="([^"]*)"`, 'i');
  const m = html.match(re);
  return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null;
}

// Media and og:image are fetched from the page's own origin (the page under
// test), whatever host an absolute og:image names.
function sameOrigin(origin, u) {
  const p = new URL(u, origin);
  return origin + p.pathname + p.search;
}

async function fetchMedia(url) {
  try {
    const r = await fetch(url, { redirect: 'manual' });
    await r.arrayBuffer();
    return { status: r.status, type: (r.headers.get('content-type') || '').split(';')[0].trim() };
  } catch (e) {
    return { status: `error ${e.message}`, type: '' };
  }
}

// null when the media answered 200 with the expected type, else a failure.
async function mediaProblem(url, what, type) {
  const m = await fetchMedia(url);
  if (m.status !== 200) return `${what} returned ${m.status}`;
  if (m.type !== type) return `${what} is ${m.type || 'untyped'}, expected ${type}`;
  return null;
}

function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// The plain text an explanation starts with, before any math or bold.
function plainLead(text) {
  const lead = norm(String(text || '').split(/\$|\*\*/)[0]);
  return lead.length >= 8 ? lead.slice(0, 40) : null;
}

async function checkStatic(url, origin, failures) {
  let html = '';
  try {
    const r = await fetch(url);
    html = await r.text();
    if (r.status !== 200) failures.push(`page returned ${r.status}`);
  } catch (e) {
    failures.push(`page fetch failed: ${e.message}`);
    return;
  }
  for (const p of ['og:title', 'og:description', 'og:image', 'og:url']) {
    if (!norm(metaContent(html, p))) failures.push(`raw HTML has no ${p} tag`);
  }
  const img = metaContent(html, 'og:image');
  if (img) {
    const p = await mediaProblem(sameOrigin(origin, img), 'og:image', 'image/png');
    if (p) failures.push(p);
  }
}

async function loadLesson(origin, slug, token, failures) {
  const api = `${origin}/api/explained/${encodeURIComponent(slug)}` +
    (token ? `?preview=${encodeURIComponent(token)}` : '');
  try {
    const r = await fetch(api);
    if (r.status !== 200) {
      failures.push(`lesson API returned ${r.status}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    failures.push(`lesson API failed: ${e.message}`);
    return null;
  }
}

async function checkMedia(origin, lesson, failures) {
  for (const [i, s] of (lesson.sections || []).entries()) {
    for (const [f, what, type] of [['image_url', 'image', 'image/png'], ['audio_url', 'audio', 'audio/mpeg']]) {
      if (!s[f]) continue;
      const p = await mediaProblem(sameOrigin(origin, s[f]), `slide ${i + 1} ${what}`, type);
      if (p) failures.push(p);
    }
  }
}

async function playPass(browser, url, lesson, mode, expectPitch, failures) {
  const tag = `(${mode} answers)`;
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  page.on('pageerror', (e) => failures.push(`page error ${tag}: ${e.message}`));
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const h1 = norm(await page.locator('h1').first().textContent());
    if (h1 !== norm(lesson.title)) failures.push(`heading is "${h1}", expected "${norm(lesson.title)}" ${tag}`);

    const sections = lesson.sections || [];
    const questions = [...(lesson.questions || [])].sort((a, b) => a.position - b.position);
    for (const [i, s] of sections.entries()) {
      const where = `slide ${i + 1} ${tag}`;
      const title = page.locator('.section-title');
      try {
        await title.filter({ hasText: norm(s.title) }).first().waitFor();
      } catch (_) {
        failures.push(`${where}: title "${norm(s.title)}" never showed`);
        return;
      }
      if (s.body && !(await page.locator('.content-scroll .body-content').count())) {
        failures.push(`${where}: body didn't render`);
      }
      if (s.image_url) {
        const img = page.locator('.content-scroll img.slide-image, .content-scroll img.slide-image-latex').first();
        try {
          await img.waitFor();
          await page.waitForFunction((el) => el.complete, await img.elementHandle());
          const w = await img.evaluate((el) => el.naturalWidth);
          if (!w) failures.push(`${where}: image didn't load`);
        } catch (_) {
          failures.push(`${where}: image missing`);
        }
      }
      if (await page.locator('.content-scroll .katex-error').count()) {
        failures.push(`${where}: an equation failed to render`);
      }
      const isLast = i === sections.length - 1;
      const label = isLast ? (questions.length ? 'Practice questions →' : 'Finish') : 'Next →';
      await page.getByRole('button', { name: label, exact: true }).click();
    }

    for (const [qi, q] of questions.entries()) {
      const steps = (q.step_data && q.step_data.steps) || [];
      for (const [si, st] of steps.entries()) {
        const where = `question ${qi + 1} step ${si + 1} ${tag}`;
        const card = page.locator('.sq-card');
        try {
          await card.locator('.sq-step-label', { hasText: `Step ${si + 1} of ${steps.length}` }).waitFor();
        } catch (_) {
          failures.push(`${where}: never showed`);
          return;
        }
        const label = norm(await card.locator('.sq-label').textContent());
        if (label !== `Question ${qi + 1} of ${questions.length}`) failures.push(`${where}: label "${label}"`);
        const opts = card.locator('button.sq-option');
        const n = await opts.count();
        if (n !== st.options.length) failures.push(`${where}: ${n} options shown, expected ${st.options.length}`);
        const pick = mode === 'right' ? st.correct : st.options.findIndex((_, k) => k !== st.correct);
        await opts.nth(pick).click();
        await card.locator('.sq-feedback').waitFor();
        const verdict = norm(await card.locator('.sq-verdict').textContent());
        const want = mode === 'right' ? 'Correct' : 'Not quite';
        if (verdict !== want) failures.push(`${where}: verdict "${verdict}", expected "${want}"`);
        const correctText = norm(await opts.nth(st.correct).textContent());
        if (!correctText.includes('(correct answer)')) failures.push(`${where}: the right answer isn't marked`);
        if (mode === 'wrong' && !norm(await opts.nth(pick).textContent()).includes('(your answer)')) {
          failures.push(`${where}: the wrong pick isn't marked as your answer`);
        }
        const expl = card.locator('.sq-explanation');
        const explText = norm(await expl.textContent());
        if (!explText) failures.push(`${where}: no explanation shown`);
        const lead = plainLead(st.explanation);
        if (lead && !explText.includes(lead)) failures.push(`${where}: explanation text doesn't match`);
        if (await card.locator('.katex-error').count()) failures.push(`${where}: an equation failed to render`);
        const lastStep = si === steps.length - 1;
        const nextLabel = !lastStep ? 'Next step' : (qi === questions.length - 1 ? 'Finish' : 'Next question');
        const next = card.locator('button.sq-next');
        const got = norm(await next.textContent());
        if (got !== nextLabel) failures.push(`${where}: button says "${got}", expected "${nextLabel}"`);
        await next.click();
      }
    }

    const pitch = page.locator('a.ex-pitch-btn');
    try {
      await pitch.waitFor();
    } catch (_) {
      failures.push(`pitch never showed ${tag}`);
      return;
    }
    const href = await pitch.getAttribute('href');
    const want = expectPitch || `${SITE}/enroll?class=${encodeURIComponent(lesson.class_code)}` +
      `&utm_source=mini-lesson&utm_campaign=${encodeURIComponent(lesson.slug)}`;
    if (href !== want) failures.push(`pitch link is ${href}, expected ${want} ${tag}`);
    if (norm(await pitch.textContent()) !== 'See the full course') failures.push(`pitch button text wrong ${tag}`);
  } catch (e) {
    failures.push(`playthrough stopped ${tag}: ${e.message.split('\n')[0]}`);
  } finally {
    await context.close();
  }
}

async function playthrough(url, { expectPitch = null, expectVersion = null } = {}) {
  const failures = [];
  let u;
  try {
    u = new URL(url);
  } catch (_) {
    return { ok: false, failures: [`not a URL: ${url}`] };
  }
  const m = u.pathname.match(/^\/explained\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
  if (!m) return { ok: false, failures: [`not a mini lesson URL: ${url}`] };
  const slug = m[1];
  const token = u.searchParams.get('preview');

  await checkStatic(url, u.origin, failures);
  const lesson = await loadLesson(u.origin, slug, token, failures);
  if (!lesson) return { ok: false, failures };
  if (expectVersion != null && !(lesson.version === expectVersion && lesson.is_draft === true)) {
    failures.push(`page serves v${lesson.version} (${lesson.is_draft ? 'draft' : 'live'}), expected draft v${expectVersion}`);
    return { ok: false, failures };
  }
  if (!(lesson.sections || []).length) failures.push('lesson has no slides');
  if (!(lesson.questions || []).length) failures.push('lesson has no questions');
  await checkMedia(u.origin, lesson, failures);

  const browser = await chromium.launch({ args: ['--mute-audio'] });
  try {
    await playPass(browser, url, lesson, 'wrong', expectPitch, failures);
    await playPass(browser, url, lesson, 'right', expectPitch, failures);
  } finally {
    await browser.close();
  }
  return { ok: failures.length === 0, failures };
}

module.exports = { playthrough, parseArgs, metaContent, plainLead };

if (require.main === module) {
  const { url, expectPitch, expectVersion } = parseArgs(process.argv.slice(2));
  if (!url) {
    console.log(JSON.stringify({ ok: false, failures: ['usage: mini-lesson-playthrough.js <url> [--expect-pitch <url>] [--expect-version <N>]'] }));
    process.exit(1);
  }
  playthrough(url, { expectPitch, expectVersion })
    .then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1); })
    .catch((e) => { console.log(JSON.stringify({ ok: false, failures: [`playthrough crashed: ${e.message}`] })); process.exit(1); });
}
