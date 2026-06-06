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

module.exports = { sendMagicLink, sendPasswordReset };
