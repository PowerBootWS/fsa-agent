const express = require('express');
const path = require('path');
const { pool } = require('../services/database');
const requireAuth = require('../middleware/requireAuth');
const credits = require('../services/credits');
const { requestTailoredDocuments } = require('../services/aiServiceClient');

const router = express.Router();

router.get('/credits', requireAuth, async (req, res) => {
  try {
    const balance = await credits.getBalance(req.user.id);
    return res.json({ balance });
  } catch (err) {
    console.error('GET /api/platform/credits error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

const VALID_DOC_TYPES = ['resume', 'cover_letter'];

router.post('/jobs/:savedJobId/tailor', requireAuth, async (req, res) => {
  const { savedJobId } = req.params;
  const docTypes = [...new Set(Array.isArray(req.body.docTypes) ? req.body.docTypes : [])];

  if (docTypes.length === 0 || !docTypes.every((t) => VALID_DOC_TYPES.includes(t))) {
    return res.status(400).json({ error: 'docTypes must be a non-empty array of resume/cover_letter' });
  }

  try {
    const jobResult = await pool.query(
      `SELECT id, title, company, description_snapshot FROM saved_jobs WHERE id = $1 AND user_id = $2`,
      [savedJobId, req.user.id]
    );
    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const job = jobResult.rows[0];

    const docsResult = await pool.query(
      `SELECT doc_type, storage_path, mime_type FROM user_documents WHERE user_id = $1`,
      [req.user.id]
    );
    const resumeDoc = docsResult.rows.find((d) => d.doc_type === 'resume');
    const coverLetterDoc = docsResult.rows.find((d) => d.doc_type === 'cover_letter');
    if (!resumeDoc) {
      return res.status(400).json({ error: 'Upload a resume before generating tailored documents' });
    }

    const balance = await credits.getBalance(req.user.id);
    if (balance < docTypes.length) {
      return res.status(402).json({ error: 'Not enough credits', balance });
    }

    let generationResult;
    try {
      generationResult = await requestTailoredDocuments({
        job: { title: job.title, company: job.company, description_snapshot: job.description_snapshot },
        user_id: req.user.id,
        saved_job_id: job.id,
        resume: { path: resumeDoc.storage_path, mime_type: resumeDoc.mime_type },
        cover_letter: coverLetterDoc ? { path: coverLetterDoc.storage_path, mime_type: coverLetterDoc.mime_type } : null,
        doc_types: docTypes,
      });
    } catch (err) {
      const status = err.response?.status;
      const errorCode = err.response?.data?.error;
      if (status === 422 && errorCode === 'UNREADABLE_SOURCE_DOCUMENT') {
        return res.status(422).json({ error: "We couldn't read your resume — try re-uploading a text-based PDF or DOCX." });
      }
      console.error('POST /api/platform/jobs/:savedJobId/tailor ai-service error:', err.message);
      return res.status(502).json({ error: 'Document generation failed — no credits were charged. Please try again.' });
    }

    const client = await pool.connect();
    let insertedDocs;
    try {
      await client.query('BEGIN');
      insertedDocs = [];
      for (const doc of generationResult.documents) {
        const insertResult = await client.query(
          `INSERT INTO generated_documents
             (user_id, saved_job_id, doc_type, docx_path, pdf_path, changes_summary, placeholder_count, model_used)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, doc_type, generated_at`,
          [
            req.user.id, job.id, doc.doc_type, doc.docx_path, doc.pdf_path,
            generationResult.changes_summary, generationResult.placeholder_count, generationResult.model_used,
          ]
        );
        insertedDocs.push(insertResult.rows[0]);
      }
      await credits.debitCredits(client, req.user.id, insertedDocs.map((d) => d.id));
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.message === 'INSUFFICIENT_CREDITS') {
        // Rare race: two concurrent tailor requests exhausted the balance between the
        // earlier balance pre-check above and this debit. The DB insert is rolled back, but
        // the already-rendered DOCX/PDF files on disk for this request are orphaned and
        // the OpenRouter spend for it is lost — an accepted v1 trade-off, not fixed here.
        return res.status(402).json({ error: 'Not enough credits', balance: await credits.getBalance(req.user.id) });
      }
      throw err;
    } finally {
      client.release();
    }

    const balanceAfter = await credits.getBalance(req.user.id);
    return res.status(201).json({
      documents: insertedDocs.map((d) => ({
        id: d.id,
        docType: d.doc_type,
        downloadUrls: {
          docx: `/api/platform/generated-documents/${d.id}/download?format=docx`,
          pdf: `/api/platform/generated-documents/${d.id}/download?format=pdf`,
        },
      })),
      changesSummary: generationResult.changes_summary,
      placeholderCount: generationResult.placeholder_count,
      flaggedGaps: generationResult.flagged_gaps,
      balanceRemaining: balanceAfter,
    });
  } catch (err) {
    console.error('POST /api/platform/jobs/:savedJobId/tailor error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/jobs/:savedJobId/generated-documents', requireAuth, async (req, res) => {
  try {
    const jobResult = await pool.query(
      `SELECT id FROM saved_jobs WHERE id = $1 AND user_id = $2`,
      [req.params.savedJobId, req.user.id]
    );
    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const result = await pool.query(
      `SELECT id, doc_type, changes_summary, placeholder_count, generated_at
       FROM generated_documents WHERE saved_job_id = $1 AND user_id = $2
       ORDER BY generated_at DESC`,
      [req.params.savedJobId, req.user.id]
    );
    return res.json({
      documents: result.rows.map((d) => ({
        id: d.id,
        docType: d.doc_type,
        changesSummary: d.changes_summary,
        placeholderCount: d.placeholder_count,
        generatedAt: d.generated_at,
        downloadUrls: {
          docx: `/api/platform/generated-documents/${d.id}/download?format=docx`,
          pdf: `/api/platform/generated-documents/${d.id}/download?format=pdf`,
        },
      })),
    });
  } catch (err) {
    console.error('GET /api/platform/jobs/:savedJobId/generated-documents error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/generated-documents/:id/download', requireAuth, async (req, res) => {
  const format = req.query.format === 'pdf' ? 'pdf' : req.query.format === 'docx' ? 'docx' : null;
  if (!format) {
    return res.status(400).json({ error: 'format must be docx or pdf' });
  }
  try {
    const result = await pool.query(
      `SELECT doc_type, docx_path, pdf_path FROM generated_documents WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const row = result.rows[0];
    const storagePath = format === 'pdf' ? row.pdf_path : row.docx_path;
    const mimeType = format === 'pdf' ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const absolutePath = path.resolve(storagePath);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${row.doc_type}.${format}"`);
    return res.sendFile(absolutePath, (err) => {
      if (err && !res.headersSent) {
        console.error('GET /api/platform/generated-documents/:id/download error:', err);
        res.removeHeader('Content-Type');
        res.removeHeader('Content-Disposition');
        res.status(404).json({ error: 'File missing on disk' });
      }
    });
  } catch (err) {
    console.error('GET /api/platform/generated-documents/:id/download error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
