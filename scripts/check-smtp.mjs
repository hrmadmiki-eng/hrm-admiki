import '../server/config/env.js';
import { verifySmtp, MailConfigurationError } from '../server/services/mail.js';

// Verify connectivity/authentication only. This command never sends a message.
try {
  await verifySmtp();
  console.log('SMTP connection and authentication succeeded. No email was sent.');
} catch (error) {
  console.log('SMTP verification failed:', error);
  console.error(
    error instanceof MailConfigurationError
      ? error.message
      : error.code === 'EAUTH'
        ? 'SMTP authentication failed. Check SMTP_USER and SMTP_PASS in the backend .env.'
        : 'SMTP verification failed. Check the host, port, TLS settings, and network access.',
  );
  process.exitCode = 1;
}
