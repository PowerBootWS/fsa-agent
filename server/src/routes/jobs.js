const express = require('express');
const { pool } = require('../services/database');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const VALID_STATUSES = ['saved', 'applied', 'interviewing', 'archived'];

// POST /save
router.post('/save', requireAuth, async (req, res) => {
  try {
    const { source_job_id, title, company, location, url, job_class_label, description_snapshot, posted_at } = req.body;

    if (!title || !url) {
      return res.status(400).json({ error: 'title and url are required' });
    }

    if (source_job_id) {
      const existing = await pool.query(
        `SELECT id FROM saved_jobs WHERE user_id = $1 AND source_job_id = $2`,
        [req.user.id, source_job_id]
      );
      if (existing.rows.length > 0) {
        return res.json({ ok: true, id: existing.rows[0].id, already_saved: true });
      }
    }

    const result = await pool.query(
      `INSERT INTO saved_jobs
         (user_id, source_job_id, title, company, location, job_class_label, url, description_snapshot, posted_at, status, saved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'saved', now())
       RETURNING id`,
      [req.user.id, source_job_id || null, title, company || null, location || null, job_class_label || null, url, description_snapshot || null, posted_at || null]
    );

    return res.status(201).json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error('POST /api/jobs/save error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, source_job_id, title, company, location, job_class_label, url,
              status, notes, posted_at, saved_at, applied_at, interview_flagged_at
       FROM saved_jobs
       WHERE user_id = $1
       ORDER BY saved_at DESC`,
      [req.user.id]
    );
    return res.json({ jobs: result.rows });
  } catch (err) {
    console.error('GET /api/jobs error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /:id
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { status, notes } = req.body;
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` });
    }

    const existing = await pool.query(
      `SELECT id FROM saved_jobs WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const fields = [];
    const values = [];
    let i = 1;
    if (status) {
      fields.push(`status = $${i++}`);
      values.push(status);
      if (status === 'applied') fields.push(`applied_at = now()`);
      if (status === 'interviewing') fields.push(`interview_flagged_at = now()`);
    }
    if (notes !== undefined) {
      fields.push(`notes = $${i++}`);
      values.push(notes);
    }
    if (fields.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    values.push(req.params.id);

    await pool.query(`UPDATE saved_jobs SET ${fields.join(', ')} WHERE id = $${i}`, values);

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/jobs/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM saved_jobs WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/jobs/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
