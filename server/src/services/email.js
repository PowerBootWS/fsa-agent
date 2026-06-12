const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.GOOGLE_SMTP_USER,
    pass: process.env.GOOGLE_SMTP_PASS,
  },
});

const FROM = 'Full Steam Ahead <support@fullsteamahead.ca>';
const BASE_URL = process.env.PLATFORM_BASE_URL || 'https://learn.fullsteamahead.ca';

async function sendMagicLink(email, firstName, token) {
  const link = `${BASE_URL}/setup?token=${token}`;
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Set up your Full Steam Ahead account',
    html: `<p>Hi ${firstName},</p><p>Welcome to Full Steam Ahead! Click the button below to set up your account password.</p><p><a href="${link}" style="background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Set Up My Account</a></p><p>This link expires in 48 hours.</p><p>If you didn't sign up, ignore this email.</p>`,
    text: `Hi ${firstName},\n\nWelcome to Full Steam Ahead! Set up your account here:\n${link}\n\nThis link expires in 48 hours.`,
  });
}

async function sendPasswordReset(email, firstName, token) {
  const link = `${BASE_URL}/reset-password?token=${token}`;
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Reset your Full Steam Ahead password',
    html: `<p>Hi ${firstName},</p><p>Click below to reset your password. This link expires in 1 hour.</p><p><a href="${link}" style="background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Reset Password</a></p><p>If you didn't request this, ignore this email.</p>`,
    text: `Hi ${firstName},\n\nReset your password here:\n${link}\n\nThis link expires in 1 hour.`,
  });
}

// Notifies the operator that one or more customers are queued for deactivation and
// need manual confirmation before access is pulled. Used while the deactivation
// confirmation gate (DEACTIVATION_REQUIRES_CONFIRMATION) is enabled.
// `items`: array of { name, email, stripeSubscriptionId, reason }.
async function sendDeactivationReview(items) {
  const to = process.env.DEACTIVATION_REVIEW_EMAIL || 'sysadmin@powerboot.ca';
  const list = (Array.isArray(items) ? items : [items]).filter(Boolean);
  if (!list.length) return;

  const rows = list
    .map(
      (i) =>
        `<tr><td style="padding:4px 12px 4px 0">${i.name || '(no name)'}</td>` +
        `<td style="padding:4px 12px 4px 0">${i.email || ''}</td>` +
        `<td style="padding:4px 12px 4px 0">${i.stripeSubscriptionId || '—'}</td>` +
        `<td style="padding:4px 0">${i.reason || ''}</td></tr>`
    )
    .join('');
  const textRows = list
    .map((i) => `- ${i.name || '(no name)'} <${i.email || ''}> | sub ${i.stripeSubscriptionId || '—'} | ${i.reason || ''}`)
    .join('\n');

  const subject =
    list.length === 1
      ? `Confirm deactivation: ${list[0].email}`
      : `Confirm deactivation: ${list.length} customers pending`;

  await transporter.sendMail({
    from: FROM,
    to,
    subject,
    html:
      `<p>The deactivation confirmation gate is on. The following ${list.length === 1 ? 'customer is' : 'customers are'} ` +
      `queued for deactivation but <strong>still have active access</strong> pending your confirmation:</p>` +
      `<table style="border-collapse:collapse"><thead><tr style="text-align:left">` +
      `<th style="padding:4px 12px 4px 0">Name</th><th style="padding:4px 12px 4px 0">Email</th>` +
      `<th style="padding:4px 12px 4px 0">Stripe sub</th><th style="padding:4px 0">Reason</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>` +
      `<p>Reply to confirm, and the deactivation will be applied. No action keeps the customer active.</p>`,
    text:
      `The deactivation confirmation gate is on. Pending deactivations (still active until confirmed):\n\n` +
      `${textRows}\n\nReply to confirm. No action keeps the customer active.`,
  });
}

module.exports = { sendMagicLink, sendPasswordReset, sendDeactivationReview };
