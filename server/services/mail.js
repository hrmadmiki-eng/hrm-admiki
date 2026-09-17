import nodemailer from 'nodemailer';
import { AppError } from '../utils/http.js';
import { configuredClientOrigin } from '../config/env.js';

export class MailConfigurationError extends AppError {
  constructor() {
    super(503, 'Password reset email is not configured. Please contact your administrator.');
    this.code = 'MAIL_NOT_CONFIGURED';
  }
}

export function smtpOptions() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465;
  if (
    !host ||
    !process.env.SMTP_FROM?.trim() ||
    host === 'smtp.example.com' ||
    process.env.SMTP_USER === 'your-smtp-username' ||
    process.env.SMTP_PASS === 'your-smtp-password' ||
    /(?:<|^)hr@example\.com(?:>|$)/i.test(process.env.SMTP_FROM || '') ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    (process.env.SMTP_SECURE && !['true', 'false'].includes(process.env.SMTP_SECURE)) ||
    Boolean(process.env.SMTP_USER) !== Boolean(process.env.SMTP_PASS)
  )
    throw new MailConfigurationError();
  const localDevelopment =
    process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '::1'].includes(host);
  return {
    host,
    port,
    secure,
    requireTLS: !secure && !localDevelopment,
    ...(process.env.SMTP_USER
      ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
      : {}),
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export function passwordEmailConfiguration() {
  smtpOptions();
  const origin = configuredClientOrigin();
  if (!origin) throw new MailConfigurationError();
  return origin;
}

export const mailer = {
  async send({ to, subject, text }) {
    let transport, deadline;
    try {
      console.log('Attempting password email delivery.', { subject });
      const options = smtpOptions();
      console.log('Password email SMTP connection.', {
        host: options.host,
        port: options.port,
        secure: options.secure,
      });
      transport = nodemailer.createTransport(options);
      deadline = setTimeout(() => transport.close(), 60000);
      deadline.unref();
      const info = await transport.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
      if (!info.accepted?.length || info.rejected?.length) throw new Error('Mail was not accepted');
      console.log('Password email accepted by SMTP server.', { messageId: info.messageId });
    } catch (error) {
      console.log('Password email sendMail failed:', error);
      throw error;
    } finally {
      clearTimeout(deadline);
      transport?.close();
    }
  },
};

export async function verifySmtp() {
  const transport = nodemailer.createTransport(smtpOptions());
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}
