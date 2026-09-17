import '../server/config/env.js';
import dns from 'node:dns';
import mongoose from '../server/node_modules/mongoose/index.js';
import { User } from '../server/models/index.js';
import { PasswordEmail } from '../server/services/password-reset.js';
import { passwordEmailConfiguration, smtpOptions } from '../server/services/mail.js';

// Read-only diagnostics. Never print credentials, password hashes, or reset tokens.
if (process.env.DIAGNOSTIC_DNS_SERVERS)
  dns.setServers(process.env.DIAGNOSTIC_DNS_SERVERS.split(','));
const timeout = setTimeout(() => {
  console.error('Password email diagnostic timed out connecting to the database.');
  process.exit(1);
}, 25000);
const mask = (email) => email?.replace(/^(.).*(@.*)$/, '$1***$2');
try {
  const smtp = smtpOptions();
  console.log('Email configuration:', {
    clientOrigin: passwordEmailConfiguration(),
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    authenticated: Boolean(smtp.auth),
  });
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    autoIndex: false,
  });
  const email = process.argv[2]?.trim().toLowerCase();
  const users = await User.find(email ? { email } : {})
    .select('email active role')
    .lean();
  console.log(
    'Matching accounts:',
    users.map((user) => ({
      email: mask(user.email),
      active: user.active,
      role: user.role,
      matchesSmtpLogin: user.email === process.env.SMTP_USER,
    })),
  );
  const jobs = await PasswordEmail.find(email ? { email } : {})
    .select('+email')
    .lean();
  console.log(
    'Pending emails:',
    jobs.map((job) => ({
      email: mask(job.email),
      kind: job.kind,
      attempts: job.attempts,
      nextAttemptAt: job.nextAttemptAt,
      leaseUntil: job.leaseUntil,
      expiresAt: job.expiresAt,
      activeAccountExists: users.some((user) => user.email === job.email && user.active),
    })),
  );
  console.log(
    'Accounts with unexpired reset tokens:',
    await User.countDocuments({
      ...(email ? { email } : {}),
      'passwordReset.expiresAt': { $gt: new Date() },
    }),
  );
} catch (error) {
  console.error(
    'Password email diagnostic failed:',
    error.name,
    error.code || '',
    error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[database URI redacted]'),
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
  clearTimeout(timeout);
}
