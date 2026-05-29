const express = require('express');
const router = express.Router();
const { pool } = require('../services/database');
const { upsertContact, lookupContactByEmail, sendEmail } = require('../services/gohighlevel');

// POST /api/preview/signup
// Body: { email: string, first_name: string }
// 1. Validates input
// 2. Upserts into users table (so the AI agent can greet them by name)
// 3. Creates GHL contact tagged practice-preview (fire-and-forget)
// Returns: { success: true }
router.post('/signup', async (req, res) => {
  const { email, first_name } = req.body;

  if (!email || !first_name) {
    return res.status(400).json({ error: 'email and first_name are required' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  const cleanName = String(first_name).trim().slice(0, 100);
  if (!cleanName) {
    return res.status(400).json({ error: 'first_name cannot be blank' });
  }

  const cleanEmail = String(email).toLowerCase().trim();

  try {
    // Block repeat attempts: if this email already has exam responses, they've used their free preview.
    const used = await pool.query(
      'SELECT 1 FROM question_responses WHERE user_email = $1 LIMIT 1',
      [cleanEmail]
    );
    if (used.rows.length > 0) {
      return res.status(200).json({ success: false, already_used: true });
    }
  } catch (err) {
    console.error('preview/signup duplicate check error:', err.message);
    // On check failure, allow through rather than blocking a legitimate new user
  }

  try {
    await pool.query(
      `INSERT INTO users (email, first_name)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET first_name = EXCLUDED.first_name, updated_at = NOW()`,
      [cleanEmail, cleanName]
    );
  } catch (err) {
    console.error('preview/signup DB error:', err.message);
    return res.status(500).json({ error: 'Failed to save signup' });
  }

  // Fire-and-forget GHL contact creation (uses the v2 service that's already validated)
  upsertContact({ email: cleanEmail, firstName: cleanName, tags: ['practice-preview'] })
    .catch(err => console.error('preview/signup GHL error:', err.message));

  res.json({ success: true });
});

// POST /api/preview/send-results
// Body: { email, first_name, course_id, score, total, score_pct, chapter_stats }
// Looks up the GHL contact and sends a personalized results email.
// Fire-and-forget from the client — always returns 200.
router.post('/send-results', async (req, res) => {
  const { email, first_name, course_id, score, total, score_pct, chapter_stats = [] } = req.body;

  if (!email || !first_name || !course_id) {
    return res.status(400).json({ error: 'email, first_name, and course_id are required' });
  }

  // Respond immediately so the client isn't waiting
  res.json({ success: true });

  try {
    const contact = await lookupContactByEmail(String(email).toLowerCase().trim());
    if (!contact?.id) {
      console.error('preview/send-results: GHL contact not found for', email);
      return;
    }

    const strong = chapter_stats.filter(c => c.status === 'Strong').map(c => c.chapter);
    const weak   = chapter_stats.filter(c => c.status !== 'Strong').map(c => c.chapter);

    const strongLine = strong.length
      ? `<p>Your strongest chapters: <strong>${strong.join(', ')}</strong></p>`
      : '';
    const weakLine = weak.length
      ? `<p>Chapters to focus on: <strong>${weak.join(', ')}</strong></p>`
      : '';

    const chapterRows = chapter_stats.map(c => {
      const colour = c.status === 'Strong' ? '#16a34a' : c.status === 'Developing' ? '#d97706' : '#dc2626';
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${c.chapter}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${c.correct}/${c.total} (${c.pct}%)</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:${colour};font-weight:600;">${c.status}</td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr><td style="background:#1a2e42;padding:28px 36px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.3px;">Full Steam Ahead</h1>
          <p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">Power Engineering Exam Prep</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px;">
          <h2 style="margin:0 0 8px;color:#1a2e42;font-size:20px;">Hi ${first_name},</h2>
          <p style="margin:0 0 24px;color:#5a6c7d;font-size:15px;line-height:1.6;">
            Here are your results from your <strong>${course_id} Practice Exam</strong>.
          </p>

          <!-- Score -->
          <div style="text-align:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:24px;margin-bottom:28px;">
            <div style="font-size:42px;font-weight:800;color:#1a2e42;line-height:1;">${score}/${total}</div>
            <div style="font-size:18px;color:#64748b;margin-top:4px;">${score_pct}%</div>
          </div>

          ${strongLine}
          ${weakLine}

          ${chapterRows ? `
          <!-- Chapter table -->
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin:20px 0;">
            <thead>
              <tr style="background:#f8fafc;">
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Chapter</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Score</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Status</th>
              </tr>
            </thead>
            <tbody>${chapterRows}</tbody>
          </table>` : ''}

          <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">

          <!-- CTA -->
          <p style="margin:0 0 16px;color:#1a2e42;font-size:15px;line-height:1.6;">
            Ready to close the gaps? A Full Steam Ahead subscription gives you unlimited adaptive
            practice exams for all six papers, full course content with step-by-step lessons, and
            AI tutoring — all for <strong>$149/month</strong>.
          </p>
          <div style="text-align:center;margin:24px 0;">
            <a href="https://enrollment.fullsteamahead.ca"
               style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:8px;">
              Start Your Subscription →
            </a>
          </div>
          <p style="text-align:center;color:#94a3b8;font-size:12px;margin:0;">$149/month · all 6 papers · cancel anytime</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:20px 36px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">
            Full Steam Ahead · Power Engineering Exam Prep<br>
            <a href="https://fullsteamahead.ca" style="color:#2563eb;">fullsteamahead.ca</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const plainText = `Hi ${first_name},\n\nYour ${course_id} Practice Exam results: ${score}/${total} (${score_pct}%).\n\n`
      + (strong.length ? `Strong: ${strong.join(', ')}\n` : '')
      + (weak.length ? `Needs focus: ${weak.join(', ')}\n` : '')
      + `\nReady for unlimited practice? Start your subscription at https://enrollment.fullsteamahead.ca\n\n$149/month · all 6 papers · cancel anytime`;

    await sendEmail({
      contactId: contact.id,
      subject: `Your ${course_id} Practice Exam Results — Full Steam Ahead`,
      html,
      message: plainText,
    });
  } catch (err) {
    console.error('preview/send-results error:', err.message);
  }
});

module.exports = router;
