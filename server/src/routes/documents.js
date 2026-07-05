const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('../services/database');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const UPLOAD_DIR = process.env.USER_UPLOADS_DIR || '/srv/fsa-user-uploads';
const ALLOWED_MIME = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
const VALID_DOC_TYPES = ['resume', 'cover_letter'];

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    // Random filename, independent of doc_type/original name — avoids collisions and
    // avoids depending on multipart field order (doc_type is only needed in the route
    // handler below, which always sees the fully-parsed req.body).
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED_MIME[file.mimetype] || ''}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME[file.mimetype]) {
      return cb(new Error('Only PDF and DOCX files are accepted.'));
    }
    cb(null, true);
  },
});

// POST /documents
router.post('/documents', requireAuth, upload.single('file'), async (req, res) => {
  const { doc_type } = req.body;
  if (!VALID_DOC_TYPES.includes(doc_type)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'doc_type must be resume or cover_letter' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Advisory lock keyed on (user_id, doc_type) — serializes concurrent uploads for the
      // same slot even when no row exists yet (SELECT ... FOR UPDATE only locks existing rows,
      // which left the user's very-first upload of a doc_type unprotected).
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1::text || ':' || $2)::bigint)`,
        [req.user.id, doc_type]
      );
      const existing = await client.query(
        `SELECT storage_path FROM user_documents WHERE user_id = $1 AND doc_type = $2`,
        [req.user.id, doc_type]
      );
      await client.query(
        `INSERT INTO user_documents (user_id, doc_type, original_filename, storage_path, mime_type, uploaded_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (user_id, doc_type)
         DO UPDATE SET original_filename = $3, storage_path = $4, mime_type = $5, uploaded_at = now()`,
        [req.user.id, doc_type, req.file.originalname, req.file.path, req.file.mimetype]
      );
      await client.query('COMMIT');

      if (existing.rows[0]?.storage_path && existing.rows[0].storage_path !== req.file.path) {
        fs.unlink(existing.rows[0].storage_path, () => {});
      }

      return res.status(201).json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error('POST /api/platform/documents error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Multer/file-filter errors land here as JSON 400s instead of the generic 500 handler.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message === 'Only PDF and DOCX files are accepted.') {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// GET /documents — metadata only, not the binary
router.get('/documents', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT doc_type, original_filename, uploaded_at FROM user_documents WHERE user_id = $1`,
      [req.user.id]
    );
    return res.json({ documents: result.rows });
  } catch (err) {
    console.error('GET /api/platform/documents error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /documents/:type/download
router.get('/documents/:type/download', requireAuth, async (req, res) => {
  try {
    const { type } = req.params;
    const result = await pool.query(
      `SELECT storage_path, original_filename, mime_type FROM user_documents WHERE user_id = $1 AND doc_type = $2`,
      [req.user.id, type]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No document on file' });
    }
    const { storage_path, original_filename, mime_type } = result.rows[0];
    const absolutePath = path.resolve(storage_path);
    res.setHeader('Content-Type', mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${original_filename.replace(/"/g, '')}"`);
    return res.sendFile(absolutePath, (err) => {
      if (err && !res.headersSent) {
        console.error('GET /api/platform/documents/:type/download error:', err);
        res.removeHeader('Content-Type');
        res.removeHeader('Content-Disposition');
        res.status(404).json({ error: 'File missing on disk' });
      }
    });
  } catch (err) {
    console.error('GET /api/platform/documents/:type/download error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
