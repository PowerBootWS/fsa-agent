// Public (unauthenticated) mini lessons. Sits beside paid course content, so
// every request is validated against strict patterns BEFORE touching the
// database or disk, and media is served only from MINI_MEDIA_DIR/<slug>/ for
// slugs getPublic would serve. Course media (/media) is a separate tree.
const express = require('express');
const path = require('path');
const miniLessons = require('../services/miniLessons');

const MINI_MEDIA_DIR = process.env.MINI_MEDIA_DIR || '/srv/fsa-mini-media';
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FILE_RE = /^slide-\d{3}\.(mp3|png)$|^og\.png$/;

function previewParam(req) {
  const p = req.query.preview;
  return typeof p === 'string' && p ? p : null;
}

// Draft media carries the preview token in the PATH, not the query string:
// Cloudflare strips the query string from .png/.mp3 requests before they
// reach the origin (verified 2026-11-11: origin 200 with ?preview=, the same
// URL through Cloudflare 404 MISS) and caches by path alone. A path token gives
// every draft file its own cache key and actually reaches the server.
//   /explained-media/<slug>/v<N>/<file>  ->  /explained-media/<slug>/v<N>/p/<token>/<file>
function withPreview(url, token) {
  if (typeof url !== 'string' || !url || typeof token !== 'string' || !token) return url;
  const i = url.lastIndexOf('/');
  return `${url.slice(0, i)}/p/${encodeURIComponent(token)}${url.slice(i)}`;
}

const VER_RE = /^v[1-9]\d*$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

const apiRouter = express.Router();
apiRouter.get('/:slug', async (req, res) => {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug)) return res.status(404).json({ error: 'Not found' });
  try {
    const token = previewParam(req);
    const lesson = await miniLessons.getPublic(slug, token);
    if (!lesson) return res.status(404).json({ error: 'Not found' });
    // Draft served via preview token: its media URLs need the token too.
    if (lesson.is_draft) {
      lesson.og_image_url = withPreview(lesson.og_image_url, token);
      lesson.sections = lesson.sections.map((s) => ({
        ...s, audio_url: withPreview(s.audio_url, token), image_url: withPreview(s.image_url, token),
      }));
    }
    res.json(lesson);
  } catch (err) {
    console.error('explained read failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Errors are never cached: Cloudflare otherwise keeps a 404 for hours, which
// would hide a file that appears moments later (a new version being installed).
function fail(res, status) {
  res.set('Cache-Control', 'no-store');
  return res.status(status).json({ error: status === 404 ? 'Not found' : 'Server error' });
}

async function serveMedia(req, res, token) {
  const { slug, ver, file } = req.params;
  if (!SLUG_RE.test(slug) || !VER_RE.test(ver) || !FILE_RE.test(file)
      || (token !== null && !TOKEN_RE.test(token))) {
    return fail(res, 404);
  }
  try {
    const version = parseInt(ver.slice(1), 10);
    if (!(await miniLessons.mediaAccess(slug, version, token))) return fail(res, 404);
    // Live media is shareable; anything reached via a preview token must never
    // sit in a shared cache (Cloudflare), so it is private + no-store.
    const live = token === null || await miniLessons.mediaAccess(slug, version, null);
    res.set('Cache-Control', live ? 'public, max-age=3600' : 'private, no-store');
    res.sendFile(file, { root: path.join(MINI_MEDIA_DIR, slug, ver), dotfiles: 'deny' }, (err) => {
      if (!err || res.headersSent) return;
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return fail(res, 404);
      console.error('explained media send failed:', err.message);
      fail(res, 500);
    });
  } catch (err) {
    console.error('explained media failed:', err.message);
    fail(res, 500);
  }
}

const mediaRouter = express.Router();
// Live media: no token (a ?preview= query is ignored; Cloudflare strips it anyway).
mediaRouter.get('/:slug/:ver/:file', (req, res) => serveMedia(req, res, null));
// Draft media: token in the path (see withPreview).
mediaRouter.get('/:slug/:ver/p/:token/:file', (req, res) => serveMedia(req, res, req.params.token));

module.exports = { apiRouter, mediaRouter, SLUG_RE, withPreview, previewParam };
