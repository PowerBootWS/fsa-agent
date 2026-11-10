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

function withPreview(url, token) {
  if (typeof url !== 'string' || !url) return url;
  return url + (url.includes('?') ? '&' : '?') + 'preview=' + encodeURIComponent(token);
}

const VER_RE = /^v[1-9]\d*$/;

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

const mediaRouter = express.Router();
mediaRouter.get('/:slug/:ver/:file', async (req, res) => {
  const { slug, ver, file } = req.params;
  if (!SLUG_RE.test(slug) || !VER_RE.test(ver) || !FILE_RE.test(file)) {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const token = previewParam(req);
    const version = parseInt(ver.slice(1), 10);
    if (!(await miniLessons.mediaAccess(slug, version, token))) {
      return res.status(404).json({ error: 'Not found' });
    }
    // Live media is shareable; anything reached via a preview token must never
    // sit in a shared cache (Cloudflare), so it is private + no-store.
    const live = await miniLessons.mediaAccess(slug, version, null);
    res.set('Cache-Control', live ? 'public, max-age=3600' : 'private, no-store');
    res.sendFile(file, { root: path.join(MINI_MEDIA_DIR, slug, ver), dotfiles: 'deny' }, (err) => {
      if (!err || res.headersSent) return;
      res.removeHeader('Cache-Control');
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return res.status(404).json({ error: 'Not found' });
      console.error('explained media send failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    });
  } catch (err) {
    console.error('explained media failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = { apiRouter, mediaRouter, SLUG_RE, withPreview, previewParam };
