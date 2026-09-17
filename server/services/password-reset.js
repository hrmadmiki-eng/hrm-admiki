import { createHash, randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { User } from '../models/index.js';
import { mailer, passwordEmailConfiguration } from './mail.js';

export const RESET_LIFETIME_MS = 15 * 60 * 1000;
export const hashResetToken = (token) => createHash('sha256').update(token).digest('hex');
const jobSchema = new mongoose.Schema({
  _id: String,
  kind: { type: String, enum: ['reset', 'changed'], required: true },
  email: { type: String, required: true, select: false },
  nextAttemptAt: { type: Date, default: Date.now },
  leaseUntil: { type: Date, default: () => new Date(0) },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});
jobSchema.index({ nextAttemptAt: 1, leaseUntil: 1 });
jobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const PasswordEmail = mongoose.model('PasswordEmail', jobSchema, 'admiki_password_emails');

// Queue every valid email identically; no account lookup or SMTP work happens in the response path.
// Jobs contain an address, never a reset token. A worker creates the token just before delivery.
export async function queuePasswordEmail(email, kind = 'reset', session) {
  const id = kind === 'reset' ? `reset:${hashResetToken(email)}` : `changed:${randomUUID()}`;
  await PasswordEmail.updateOne(
    { _id: id },
    {
      $setOnInsert: {
        email,
        kind,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    },
    { upsert: true, session },
  );
}

export async function drainPasswordEmails() {
  const origin = passwordEmailConfiguration();
  for (let processed = 0; processed < 50; processed++) {
    const now = new Date();
    const job = await PasswordEmail.findOneAndUpdate(
      {
        nextAttemptAt: { $lte: now },
        leaseUntil: { $lte: now },
        expiresAt: { $gt: now },
      },
      { $set: { leaseUntil: new Date(Date.now() + 90000) }, $inc: { attempts: 1 } },
      { new: true },
    )
      .sort({ nextAttemptAt: 1 })
      .select('+email');
    if (!job) break;
    console.log('Processing queued password email.', { kind: job.kind, attempt: job.attempts });
    const lease = { _id: job._id, leaseUntil: job.leaseUntil };
    let hash;
    try {
      if (job.kind === 'changed') {
        await mailer.send({
          to: job.email,
          subject: 'Your admiki HRM password was changed',
          text: 'Your admiki HRM password has been reset and previous sessions have been signed out. If you did not make this change, contact your administrator immediately. Your password is never included in email.',
        });
      } else {
        const user = await User.findOne({ email: job.email, active: true }).select('+tokenVersion');
        if (!user) {
          console.log('Password reset email skipped: no active account matches the address.');
          await PasswordEmail.deleteOne(lease);
          continue;
        }
        const token = randomBytes(32).toString('hex');
        hash = hashResetToken(token);
        const saved = await User.updateOne(
          { _id: user._id, active: true, email: job.email, tokenVersion: user.tokenVersion },
          {
            $set: {
              passwordReset: {
                hash,
                expiresAt: new Date(Date.now() + RESET_LIFETIME_MS),
                version: user.tokenVersion,
                email: job.email,
              },
            },
          },
        );
        if (!saved.matchedCount) {
          console.log('Password reset email skipped: account changed before token creation.');
          await PasswordEmail.deleteOne(lease);
          continue;
        }
        const link = new URL('/reset-password', origin);
        // Fragments are not sent to web servers or included in HTTP referrers.
        link.hash = token;
        await mailer.send({
          to: job.email,
          subject: 'Reset your admiki HRM password',
          text: `A password reset was requested for your admiki HRM account.\n\nOpen this link to choose a new password:\n${link.href}\n\nThis link expires in 15 minutes and can only be used once. If you request another link, use the newest email.\n\nIf you did not request this, you can ignore this email. Your password has not changed.`,
        });
      }
      await PasswordEmail.deleteOne(lease);
    } catch (error) {
      console.log('Password email job failed:', error);
      if (hash)
        await User.updateOne({ 'passwordReset.hash': hash }, { $unset: { passwordReset: 1 } });
      if (job.attempts >= 3) {
        await PasswordEmail.deleteOne(lease);
        console.warn(
          'Password email delivery failed after three attempts. Check SMTP configuration.',
        );
      } else {
        await PasswordEmail.updateOne(lease, {
          $set: {
            leaseUntil: new Date(0),
            nextAttemptAt: new Date(Date.now() + 30000 * job.attempts),
          },
        });
        console.warn('Password email delivery deferred; the queued job will be retried.');
      }
    }
  }
}

export function startPasswordEmails() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await drainPasswordEmails();
    } catch (error) {
      console.log('Password email worker failed:', error);
      console.warn('Password email worker unavailable. Check SMTP and database configuration.');
    } finally {
      running = false;
    }
  };
  // Missing SMTP must not prevent the rest of the HRM app from starting.
  try {
    passwordEmailConfiguration();
  } catch (error) {
    console.log('Password email worker configuration failed:', error);
    console.warn(
      'Password reset email is not configured. Set CLIENT_URL and SMTP settings in .env, then restart to enable it.',
    );
    return () => {};
  }
  console.log('Password email worker started; checking queued emails every 10 seconds.');
  void run();
  const timer = setInterval(run, 10000);
  timer.unref();
  return () => clearInterval(timer);
}
