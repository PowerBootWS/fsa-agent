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

const apiRouter = express.Router();
apiRouter.get('/:slug', async (req, res) => {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug)) return res.status(404).json({ error: 'Not found' });
  try {
    const token = previewParam(req);
    const lesson = await miniLessons.getPublic(slug, token);
    if (!lesson) return res.status(404).json({ error: 'Not found' });
    // Draft served via preview token: media URLs need the token too. Detect by
    // asking for the public (tokenless) view; if that differs, this is a draft.
    if (token) {
      const pub = await miniLessons.getPublic(slug, null);
      const isDraft = !pub || pub.title !== lesson.title
        || JSON.stringify(pub.sections) !== JSON.stringify(lesson.sections);
      if (isDraft) {
        lesson.og_image_url = withPreview(lesson.og_image_url, token);
        lesson.sections = lesson.sections.map((s) => ({
          ...s, audio_url: withPreview(s.audio_url, token), image_url: withPreview(s.image_url, token),
        }));
      }
    }
    res.json(lesson);
  } catch (err) {
    console.error('explained read failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

const mediaRouter = express.Router();
mediaRouter.get('/:slug/:file', async (req, res) => {
  const { slug, file } = req.params;
  if (!SLUG_RE.test(slug) || !FILE_RE.test(file)) return res.status(404).json({ error: 'Not found' });
  try {
    if (!(await miniLessons.getPublic(slug, previewParam(req)))) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.set('Cache-Control', 'public, max-age=3600');
    res.sendFile(file, { root: path.join(MINI_MEDIA_DIR, slug), dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) {
        res.removeHeader('Cache-Control');
        res.status(404).json({ error: 'Not found' });
      }
    });
  } catch (err) {
    console.error('explained media failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = { apiRouter, mediaRouter };
