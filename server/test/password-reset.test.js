import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { User, Settings, AuditLog } from '../models/index.js';
import {
  PasswordEmail,
  drainPasswordEmails,
  hashResetToken,
  RESET_LIFETIME_MS,
} from '../services/password-reset.js';
import { smtpOptions } from '../services/mail.js';
import { startTestSmtp } from './helpers/smtp.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-password-reset-test-secret-2026';
process.env.CLIENT_URL = 'http://localhost:5173';
process.env.BCRYPT_SALT_ROUNDS = '10';
const originalPassword = 'Original-password-2026!';
const newPassword = 'Replacement-password-2026!';
let repl,
  smtp,
  app,
  users,
  testNumber = 0,
  passwordHash;
const origin = process.env.CLIENT_URL;
function call(method, url, user) {
  const req = request(app)
    [method](`/api${url}`)
    .set('Origin', origin)
    .set('X-Forwarded-For', `192.0.2.${testNumber}`);
  if (user)
    req.set(
      'Cookie',
      `admiki_session=${jwt.sign({ version: user.tokenVersion }, process.env.JWT_SECRET, { subject: String(user._id), issuer: 'admiki-hrms', audience: 'admiki-web', expiresIn: '1h' })}`,
    );
  return req;
}
const forgot = (email) => call('post', '/auth/forgot-password').send({ email });
const reset = (token, password = newPassword) =>
  call('post', '/auth/reset-password').send({ token, newPassword: password });
function deliveredToken(email) {
  const message = smtp.messages
    .filter((mail) => mail.to.includes(email) && mail.text.includes('/reset-password#'))
    .at(-1);
  assert.ok(message, 'SMTP received the reset email');
  const link = message.text.match(/http:\/\/localhost:5173\/reset-password#[a-f0-9]{64}/)?.[0];
  assert.ok(link, 'Reset URL uses configured CLIENT_URL');
  return new URL(link).hash.slice(1);
}
async function issue(user) {
  assert.equal((await forgot(user.email)).status, 200);
  await drainPasswordEmails();
  return deliveredToken(user.email);
}
before(
  async () => {
    smtp = await startTestSmtp();
    Object.assign(process.env, {
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtp.port),
      SMTP_SECURE: 'false',
      SMTP_FROM: 'admiki HRM <noreply@test.example>',
    });
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    repl = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: '7.0.24' },
    });
    await mongoose.connect(repl.getUri(), { dbName: 'admiki_password_reset_tests' });
    for (const Model of Object.values(mongoose.models)) await Model.init();
    passwordHash = await bcrypt.hash(originalPassword, 10);
    app = createApp();
    app.set('trust proxy', 1); // Isolated tests exercise per-IP limits using documentation-only addresses.
  },
  { timeout: 240000 },
);
beforeEach(async () => {
  testNumber++;
  smtp.messages.length = 0;
  smtp.rejectMessages = false;
  for (const Model of [User, Settings, AuditLog, PasswordEmail]) await Model.deleteMany({});
  await Settings.create({});
  users = {};
  for (const role of ['Employee', 'HR', 'Admin'])
    users[role] = await User.create({
      name: role,
      email: `${role.toLowerCase()}${testNumber}@test.example`,
      role,
      password: passwordHash,
      mustChangePassword: true,
    });
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
  await smtp?.close();
});

test('all roles receive real SMTP mail; only token hashes are stored; reset revokes sessions without auto-login', async () => {
  for (const user of Object.values(users)) {
    const response = await forgot(user.email);
    assert.equal(response.status, 200);
    assert.equal(response.body.data, null);
  }
  assert.equal(smtp.messages.length, 0, 'Account lookup/delivery is outside the response path');
  await drainPasswordEmails();
  assert.equal(smtp.messages.length, 3);
  for (const user of Object.values(users)) {
    const token = deliveredToken(user.email);
    const saved = await User.findById(user._id).select('+passwordReset');
    assert.equal(saved.passwordReset.hash, hashResetToken(token));
    assert.notEqual(saved.passwordReset.hash, token);
    assert.ok(saved.passwordReset.expiresAt > new Date(Date.now() + RESET_LIFETIME_MS - 10000));
    assert.equal(saved.toJSON().passwordReset, undefined);
    assert.equal((await User.findById(user._id)).passwordReset, undefined);
    assert.ok(!JSON.stringify(await PasswordEmail.find({}).lean()).includes(token));
    const done = await reset(token);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.data, null);
    assert.ok(done.headers['set-cookie'].every((cookie) => !/admiki_session=ey/.test(cookie)));
    const changed = await User.findById(user._id).select('+password +passwordReset');
    assert.ok(await bcrypt.compare(newPassword, changed.password));
    assert.equal(changed.passwordReset, undefined);
    assert.equal(changed.role, user.role);
    assert.equal(changed.mustChangePassword, false);
    assert.equal((await call('get', '/auth/me', user)).status, 401);
    assert.equal(
      (await call('post', '/auth/login').send({ email: user.email, password: newPassword })).status,
      200,
    );
    assert.equal((await reset(token)).status, 400);
  }
  await drainPasswordEmails();
  assert.equal(
    smtp.messages.filter((mail) => mail.headers.includes('password was changed')).length,
    3,
  );
  assert.ok(!smtp.messages.some((mail) => mail.text.includes(newPassword)));
  assert.equal(await AuditLog.countDocuments({ action: 'auth.password_reset' }), 3);
});

test('unknown and inactive accounts receive the same response; origin, validation and missing SMTP are handled safely', async () => {
  await User.updateOne({ _id: users.HR._id }, { $set: { active: false } });
  const known = await forgot(`  ${users.Employee.email.toUpperCase()}  `);
  for (const email of [users.HR.email, 'unknown@test.example'])
    assert.deepEqual((await forgot(email)).body, known.body);
  await drainPasswordEmails();
  assert.equal(smtp.messages.length, 1);
  assert.equal((await reset('not-a-token')).status, 400);
  assert.equal((await forgot({ $ne: null })).status, 400);
  assert.equal(
    (await request(app).post('/api/auth/forgot-password').send({ email: users.Admin.email }))
      .status,
    403,
  );
  const host = process.env.SMTP_HOST;
  try {
    delete process.env.SMTP_HOST;
    const unavailable = await forgot(users.Admin.email);
    assert.equal(unavailable.status, 503);
    assert.deepEqual((await forgot('another-unknown@test.example')).body, unavailable.body);
  } finally {
    process.env.SMTP_HOST = host;
  }
});

test('expired, superseded and forged tokens fail; simultaneous consumption succeeds only once', async () => {
  const old = await issue(users.Employee);
  const newest = await issue(users.Employee);
  assert.notEqual(newest, old);
  assert.equal((await reset(old)).status, 400);
  assert.equal((await reset('0'.repeat(64))).status, 400);
  assert.equal((await reset(newest, '123')).status, 400);
  const responses = await Promise.all([reset(newest), reset(newest)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
  assert.equal(await AuditLog.countDocuments({ action: 'auth.password_reset' }), 1);
  const expired = await issue(users.HR);
  await User.updateOne({ _id: users.HR._id }, { $set: { 'passwordReset.expiresAt': new Date(0) } });
  assert.equal((await reset(expired)).status, 400);
});

test('password changes, role changes, disabled accounts and email changes invalidate pending reset links', async () => {
  const passwordToken = await issue(users.Employee);
  assert.equal(
    (
      await call('put', '/auth/password', users.Employee).send({
        currentPassword: originalPassword,
        newPassword,
      })
    ).status,
    200,
  );
  assert.equal((await reset(passwordToken)).status, 400);
  const roleToken = await issue(users.HR);
  await User.updateOne(
    { _id: users.HR._id },
    { $set: { role: 'Employee' }, $inc: { tokenVersion: 1 } },
  );
  assert.equal((await reset(roleToken)).status, 400);
  const emailToken = await issue(users.Admin);
  await User.updateOne({ _id: users.Admin._id }, { $set: { email: 'replacement@test.example' } });
  assert.equal((await reset(emailToken)).status, 400);
  const disabledToken = await issue(users.Employee);
  await User.updateOne({ _id: users.Employee._id }, { $set: { active: false } });
  assert.equal((await reset(disabledToken)).status, 400);
});

test('SMTP failure keeps a retryable job, invalidates undelivered tokens, and logs no secrets', async (t) => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const logs = t.mock.method(console, 'log', () => {});
  smtp.rejectMessages = true;
  const response = await forgot(users.Employee.email);
  assert.equal(response.status, 200);
  assert.equal(
    response.body.message,
    'If an active account exists for that email, a password reset link will be sent shortly.',
  );
  await drainPasswordEmails();
  const attemptIndex = logs.mock.calls.findIndex(
    ({ arguments: args }) => args[0] === 'Attempting password email delivery.',
  );
  const errorIndex = logs.mock.calls.findIndex(
    ({ arguments: args }) => args[0] === 'Password email sendMail failed:',
  );
  assert.ok(attemptIndex >= 0 && errorIndex > attemptIndex);
  const error = logs.mock.calls[errorIndex].arguments[1];
  assert.ok(error instanceof Error, 'The full SMTP error object is logged');
  assert.ok(error.stack);
  assert.equal(error.responseCode, 451);
  assert.match(error.response, /Temporary test failure/);
  assert.equal(error.command, 'DATA');
  assert.equal(smtp.messages.length, 0);
  assert.equal(await PasswordEmail.countDocuments(), 1);
  assert.equal(
    (await User.findById(users.Employee._id).select('+passwordReset')).passwordReset,
    undefined,
  );
  smtp.rejectMessages = false;
  await PasswordEmail.updateMany({}, { $set: { nextAttemptAt: new Date(0) } });
  await Promise.all([drainPasswordEmails(), drainPasswordEmails()]);
  assert.equal(smtp.messages.length, 1, 'Only one worker claims the delivery');
  const token = deliveredToken(users.Employee.email);
  assert.equal((await reset(token)).status, 200);
  const output = JSON.stringify([...warnings.mock.calls, ...logs.mock.calls]);
  assert.ok(!output.includes(token));
  assert.ok(!output.includes(users.Employee.email));
});

test('reset and audit changes roll back together if confirmation queueing fails', async (t) => {
  const token = await issue(users.Employee);
  t.mock.method(PasswordEmail, 'updateOne', async () => {
    throw new Error('Simulated database failure');
  });
  t.mock.method(console, 'error', () => {});
  assert.equal((await reset(token)).status, 500);
  const unchanged = await User.findById(users.Employee._id).select('+password +passwordReset');
  assert.ok(await bcrypt.compare(originalPassword, unchanged.password));
  assert.equal(unchanged.passwordReset.hash, hashResetToken(token));
  assert.equal(await AuditLog.countDocuments({ action: 'auth.password_reset' }), 0);
});

test('per-email and per-IP recovery limits apply to unknown addresses as well', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await forgot('rate-test@test.example')).status, 200);
  assert.equal((await forgot('RATE-TEST@test.example')).status, 429);
  for (let i = 0; i < 16; i++) assert.equal((await forgot(`rate${i}@test.example`)).status, 200);
  assert.equal((await forgot('final@test.example')).status, 429);
  for (let i = 0; i < 20; i++) assert.equal((await reset('0'.repeat(64))).status, 400);
  assert.equal((await reset('0'.repeat(64))).status, 429);
});

test('password changes enforce the stored role and accept simple passwords at each minimum', async () => {
  for (const user of Object.values(users)) {
    const minimum = user.role === 'Employee' ? 4 : 6;
    const rejected = await call('put', '/auth/password', user).send({
      currentPassword: originalPassword,
      newPassword: '1'.repeat(minimum - 1),
      role: 'Employee',
    });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error.details[0].message, new RegExp(`at least ${minimum}`));
    const value = user.role === 'Employee' ? '1234' : user.role === 'HR' ? 'abcdef' : '12!abc';
    const accepted = await call('put', '/auth/password', user).send({
      currentPassword: originalPassword,
      newPassword: value,
    });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.data.mustChangePassword, false);
    assert.equal(
      (await call('post', '/auth/login').send({ email: user.email, password: value })).status,
      200,
    );
  }
});

test('email resets use the stored role and rejected passwords preserve the account and token', async () => {
  for (const user of Object.values(users)) {
    const token = await issue(user);
    const minimum = user.role === 'Employee' ? 4 : 6;
    const rejected = await call('post', '/auth/reset-password').send({
      token,
      newPassword: '1'.repeat(minimum - 1),
      role: 'Employee',
    });
    assert.equal(rejected.status, 400);
    const unchanged = await User.findById(user._id).select(
      '+password +passwordReset +tokenVersion',
    );
    assert.ok(await bcrypt.compare(originalPassword, unchanged.password));
    assert.equal(unchanged.passwordReset.hash, hashResetToken(token));
    assert.equal(unchanged.tokenVersion, user.tokenVersion);
    assert.equal(unchanged.mustChangePassword, true);
    assert.equal((await reset(token, '1'.repeat(minimum))).status, 200);
  }
});

test('Admin resets use the target role, including simultaneous role changes and omitted roles', async () => {
  await User.updateOne({ _id: users.Admin._id }, { $set: { mustChangePassword: false } });
  const target = users.Employee;
  const update = (body) => call('patch', `/users/${target._id}`, users.Admin).send(body);
  assert.equal((await update({ password: '123' })).status, 400);
  assert.equal((await update({ password: '1234' })).status, 200);
  assert.equal((await update({ role: 'HR', password: '12345' })).status, 400);
  assert.equal((await User.findById(target._id)).role, 'Employee');
  assert.equal((await update({ role: 'HR', password: 'abcdef' })).status, 200);
  assert.equal((await update({ password: '1234' })).status, 400);
  assert.equal((await update({ password: '123456' })).status, 200);
  assert.equal((await update({ role: 'Admin', password: '12345' })).status, 400);
  assert.equal((await update({ role: 'Admin', password: '!@#$%^' })).status, 200);
  assert.equal((await update({ role: 'Employee', password: 'text' })).status, 200);
  assert.equal((await update({ active: true })).status, 200);
});

test('production SMTP enforces TLS; plaintext is allowed only for local development capture', () => {
  assert.equal(smtpOptions().requireTLS, false);
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(smtpOptions().requireTLS, true);
    assert.equal(smtpOptions().tls.rejectUnauthorized, true);
  } finally {
    process.env.NODE_ENV = 'test';
  }
});
