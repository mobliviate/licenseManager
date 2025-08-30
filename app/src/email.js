import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false') === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
});

export async function sendEmail({ subject, html }) {
  const from = process.env.FROM_EMAIL || 'Licenses <no-reply@localhost>';
  const to = process.env.ALERT_TO || '';
  if (!to) return { skipped: true, reason: 'ALERT_TO empty' };
  const info = await transporter.sendMail({ from, to, subject, html });
  return info;
}