import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { User } from '../models/index.js';
import { root } from '../config/env.js';
import { startTestSmtp } from './helpers/smtp.js';

const optionalKeys = [
  'CLIENT_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
];
const email = 'startup@tests.example';
const password = 'Startup-password-2026!';
let repl, smtp, temp, envFile;
const children = new Set();
before(
  async () => {
    repl = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: '7.0.24' },
    });
    await mongoose.connect(repl.getUri(), { dbName: 'admiki_startup_tests' });
    await User.create({
      name: 'Startup admin',
      email,
      password: await bcrypt.hash(password, 10),
      role: 'Admin',
      mustChangePassword: false,
    });
    smtp = await startTestSmtp();
    smtp.auth = { user: 'local-smtp-user', pass: 'local-smtp-password' };
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'admiki-startup-'));
    envFile = path.join(temp, '.env');
  },
  { timeout: 240000 },
);
async function stop(child) {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  }
  children.delete(child);
}
after(async () => {
  for (const child of children) await stop(child);
  await mongoose.disconnect();
  await repl?.stop();
  await smtp?.close();
  // Remove only the two files/directory created by this test, without recursive deletion.
  if (envFile) await fs.unlink(envFile).catch(() => {});
  if (temp) await fs.rmdir(temp);
});
async function start(environment = 'test') {
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const env = {
    ...process.env,
    NODE_ENV: environment,
    PORT: String(port),
    STARTUP_TEST_ENV: envFile,
    MONGO_URI: repl.getUri('admiki_startup_tests'),
    JWT_SECRET: 'isolated-startup-test-secret-at-least-32-characters',
    CLOUDINARY_CLOUD_NAME: 'startup-test',
    CLOUDINARY_API_KEY: 'startup-test',
    CLOUDINARY_API_SECRET: 'startup-test',
    BCRYPT_SALT_ROUNDS: '10',
    TRUST_PROXY: '',
  };
  for (const key of optionalKeys) delete env[key];
  const child = spawn(process.execPath, ['server/test/helpers/start-server.js'], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 30000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited ${code}: ${output}`));
    });
    const collect = (chunk) => {
      output += chunk.toString();
      if (output.includes('API listening on port')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
  });
  return { child, url: `http://127.0.0.1:${port}` };
}
async function post(server, endpoint, body, origin = server.url) {
  return fetch(`${server.url}/api${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
}
async function assertNormalFeatures(server, origin = server.url) {
  assert.equal((await fetch(`${server.url}/api/health`)).status, 200);
  const login = await post(server, '/auth/login', { email, password }, origin);
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('access-control-allow-origin'), origin);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal(
    (await fetch(`${server.url}/api/dashboard`, { headers: { Cookie: cookie } })).status,
    200,
  );
  const denied = await post(
    server,
    '/auth/login',
    { email, password },
    'https://untrusted.example',
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
}
async function assertDisabled(server, origin = server.url) {
  const response = await post(server, '/auth/forgot-password', { email }, origin);
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /not configured/i);
  assert.equal((await fetch(`${server.url}/api/health`)).status, 200);
}

test(
  'real server starts without optional CLIENT_URL/SMTP settings in development and production',
  { timeout: 90000 },
  async () => {
    await fs.writeFile(envFile, optionalKeys.map((key) => `${key}=`).join('\n'));
    for (const environment of ['test', 'production']) {
      const server = await start(environment);
      try {
        await assertNormalFeatures(server);
        await assertDisabled(server);
        if (environment === 'test') await assertNormalFeatures(server, 'http://localhost:5173');
        else
          assert.equal(
            (await post(server, '/auth/login', { email, password }, 'http://localhost:5173'))
              .status,
            403,
          );
      } finally {
        await stop(server.child);
      }
    }
  },
);

test('malformed optional client URL disables recovery without breaking startup or normal writes', async () => {
  await fs.writeFile(
    envFile,
    `CLIENT_URL=not-a-url\nSMTP_HOST=127.0.0.1\nSMTP_PORT=${smtp.port}\nSMTP_SECURE=false\nSMTP_USER=local-smtp-user\nSMTP_PASS=local-smtp-password\nSMTP_FROM="admiki HRM <hr@tests.example>"`,
  );
  const server = await start();
  try {
    await assertNormalFeatures(server);
    await assertDisabled(server);
  } finally {
    await stop(server.child);
  }
});

test(
  'replacing the exact .env placeholders and restarting automatically enables authenticated SMTP recovery',
  { timeout: 90000 },
  async () => {
    const clientOrigin = 'http://localhost:5173';
    const placeholder = `CLIENT_URL=${clientOrigin}\nSMTP_HOST=smtp.example.com\nSMTP_PORT=587\nSMTP_SECURE=false\nSMTP_USER=your-smtp-username\nSMTP_PASS=your-smtp-password\nSMTP_FROM="admiki HRM <hr@example.com>"`;
    await fs.writeFile(envFile, placeholder);
    const unconfigured = await start();
    try {
      await assertNormalFeatures(unconfigured, clientOrigin);
      await assertDisabled(unconfigured, clientOrigin);
    } finally {
      await stop(unconfigured.child);
    }
    await fs.writeFile(
      envFile,
      placeholder
        .replace('smtp.example.com', '127.0.0.1')
        .replace('SMTP_PORT=587', `SMTP_PORT=${smtp.port}`)
        .replace('your-smtp-username', smtp.auth.user)
        .replace('your-smtp-password', smtp.auth.pass)
        .replace('hr@example.com', 'hr@tests.example'),
    );
    const configured = await start();
    try {
      assert.equal(
        (await post(configured, '/auth/forgot-password', { email }, clientOrigin)).status,
        200,
      );
      const deadline = Date.now() + 20000;
      while (!smtp.messages.length && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(smtp.messages.length, 1, 'Startup worker sent the queued email automatically');
      assert.match(smtp.messages[0].headers, /From: admiki HRM <hr@tests.example>/);
      assert.match(smtp.messages[0].text, /http:\/\/localhost:5173\/reset-password#/);
      const token = smtp.messages[0].text.match(/reset-password#([a-f\d]{64})/)[1];
      const newPassword = 'Updated-startup-password-2026!';
      assert.equal(
        (await post(configured, '/auth/reset-password', { token, newPassword }, clientOrigin))
          .status,
        200,
      );
      assert.equal(
        (await post(configured, '/auth/login', { email, password: newPassword }, clientOrigin))
          .status,
        200,
      );
    } finally {
      await stop(configured.child);
    }
  },
);
