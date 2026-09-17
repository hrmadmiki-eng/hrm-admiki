import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { AppError, ok } from '../utils/http.js';
import { audit, transaction } from '../services/core.js';
import { passwordEmailConfiguration } from '../services/mail.js';
import { hashResetToken, queuePasswordEmail } from '../services/password-reset.js';
import { validatePassword } from '../utils/password.js';
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
});
function sessionCookie(res, user) {
  const token = jwt.sign({ version: user.tokenVersion }, process.env.JWT_SECRET, {
    subject: String(user._id),
    expiresIn: process.env.JWT_EXPIRE || '7d',
    algorithm: 'HS256',
    issuer: 'admiki-hrms',
    audience: 'admiki-web',
  });
  const claims = jwt.decode(token);
  res.cookie('admiki_session', token, {
    ...cookieOptions(),
    maxAge: (claims.exp - claims.iat) * 1000,
  });
}
export async function login(req, res) {
  const user = await User.findOne({
    email: req.body.email.toLowerCase().trim(),
  }).select('+password +tokenVersion');
  // Constant-cost password comparison also covers unknown accounts.
  const hash = user?.password || '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
  const matches = await bcrypt.compare(req.body.password, hash);
  if (!user || !matches || !user.active) throw new AppError(401, 'Invalid email or password');
  req.user = user;
  await audit(req, 'auth.login', 'User', user._id);
  sessionCookie(res, user);
  ok(res, user, 'Signed in');
}
export async function me(req, res) {
  ok(res, req.user);
}
export async function logout(req, res) {
  await transaction(async (session) => {
    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } }, { session });
    await audit(req, 'auth.logout', 'User', req.user._id, {}, session);
  });
  res.clearCookie('admiki_session', cookieOptions());
  ok(res, null, 'Signed out');
}
export async function changePassword(req, res) {
  const user = await User.findById(req.user._id).select('+password +tokenVersion');
  if (!(await bcrypt.compare(req.body.currentPassword, user.password)))
    throw new AppError(400, 'Current password is incorrect');
  if (await bcrypt.compare(req.body.newPassword, user.password))
    throw new AppError(400, 'Choose a different password');
  const password = await bcrypt.hash(
    req.body.newPassword,
    Number(process.env.BCRYPT_SALT_ROUNDS || 10),
  );
  const updated = await transaction(async (session) => {
    const result = await User.findOneAndUpdate(
      { _id: user._id, password: user.password },
      {
        $set: { password, mustChangePassword: false },
        $inc: { tokenVersion: 1 },
        $unset: { passwordReset: 1 },
      },
      { new: true, session },
    ).select('+tokenVersion');
    if (!result) throw new AppError(409, 'Account changed; please sign in again');
    await audit(req, 'auth.password_changed', 'User', user._id, {}, session);
    return result;
  });
  sessionCookie(res, updated);
  ok(res, updated, 'Password updated');
}

export async function forgotPassword(req, res) {
  console.log('Password reset requested; attempting to queue email.');
  passwordEmailConfiguration();
  await queuePasswordEmail(req.body.email);
  console.log('Password reset email queued for background delivery.');
  ok(
    res,
    null,
    'If an active account exists for that email, a password reset link will be sent shortly.',
  );
}

export async function resetPassword(req, res) {
  const hash = hashResetToken(req.body.token);
  const password = await bcrypt.hash(
    req.body.newPassword,
    Number(process.env.BCRYPT_SALT_ROUNDS || 10),
  );
  await transaction(async (session) => {
    const user = await User.findOneAndUpdate(
      {
        active: true,
        'passwordReset.hash': hash,
        'passwordReset.expiresAt': { $gt: new Date() },
        $expr: {
          $and: [
            { $eq: ['$tokenVersion', '$passwordReset.version'] },
            { $eq: ['$email', '$passwordReset.email'] },
          ],
        },
      },
      {
        $set: { password, mustChangePassword: false },
        $unset: { passwordReset: 1 },
        $inc: { tokenVersion: 1 },
      },
      { new: true, session },
    );
    if (!user)
      throw new AppError(
        400,
        'This reset link is invalid or has expired. Please request a new one.',
      );
    // A validation failure rolls back the reset and preserves the token for retry.
    validatePassword(req.body.newPassword, user.role, 'newPassword');
    req.user = user;
    await audit(req, 'auth.password_reset', 'User', user._id, {}, session);
    await queuePasswordEmail(user.email, 'changed', session);
  });
  res.clearCookie('admiki_session', cookieOptions());
  ok(res, null, 'Password reset successfully. Please sign in with your new password.');
}
