const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
  }
  return transporter;
}

async function sendEmail({ to, subject, html }) {
  try {
    await getTransporter().sendMail({ from: process.env.EMAIL_FROM, to, subject, html });
  } catch (err) {
    // Email failures should never crash the request that triggered them.
    logger.error(`Failed to send email to ${to}: ${err.message}`);
  }
}

async function sendPasswordResetEmail(user, resetToken) {
  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
  await sendEmail({
    to: user.email,
    subject: 'Reset your password',
    html: `<p>Hi ${user.name},</p><p>Click the link below to reset your password. This link expires in ${process.env.JWT_RESET_EXPIRES_IN || '15 minutes'}.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });
}

async function sendBookingReceiptEmail(user, booking, payment) {
  await sendEmail({
    to: user.email,
    subject: 'Your booking receipt',
    html: `<p>Hi ${user.name},</p><p>Your payment of ${payment.amount} ${payment.currency.toUpperCase()} for booking #${booking.id} was received.</p><p>Status: ${payment.status}</p>`,
  });
}

module.exports = { sendEmail, sendPasswordResetEmail, sendBookingReceiptEmail };
