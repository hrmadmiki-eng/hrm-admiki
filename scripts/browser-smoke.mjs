import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import { preview } from '../client/node_modules/vite/dist/node/index.js';
import mongoose from '../server/node_modules/mongoose/index.js';
import bcrypt from '../server/node_modules/bcryptjs/index.js';
import memory from '../server/node_modules/mongodb-memory-server/index.js';
import { createApp } from '../server/app.js';
import {
  User,
  Employee,
  Settings,
  Counter,
  Department,
  Designation,
  Attendance,
} from '../server/models/index.js';
import { dayjs } from '../server/utils/dates.js';
import { startTestSmtp } from '../server/test/helpers/smtp.js';
import { drainPasswordEmails } from '../server/services/password-reset.js';
import { verifyHrmWorkflows } from './hrm-browser-workflows.mjs';
import { verifyDashboardCards } from './dashboard-browser-checks.mjs';
import { verifySearchStability } from './search-browser-checks.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'browser-test-only-secret-never-used-in-production';
process.env.CLIENT_URL = 'http://127.0.0.1:5188';
process.env.JWT_EXPIRE = '7d';
process.env.BCRYPT_SALT_ROUNDS = '10';
let repl, apiServer, web, browser, smtp;
const password = 'Browser-test-password-2026!';
const errors = [];
const shots = path.join(root, 'artifacts');
const require = createRequire(new URL('../server/package.json', import.meta.url));
const { v2: cloudinary } = require('cloudinary');
const sharp = require('sharp');
const originalUpload = cloudinary.uploader.upload_stream;
const originalDestroy = cloudinary.uploader.destroy;
const originalFetch = globalThis.fetch;
const assets = new Map();
process.env.CLOUDINARY_CLOUD_NAME = 'browser-test-cloud';
process.env.CLOUDINARY_API_KEY = 'browser-test-key';
process.env.CLOUDINARY_API_SECRET = 'browser-test-secret';
cloudinary.uploader.upload_stream = (options, done) => {
  const chunks = [];
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
    final(callback) {
      const url = `https://res.cloudinary.com/browser-test-cloud/image/upload/${options.public_id}.webp`;
      assets.set(options.public_id, { url, buffer: Buffer.concat(chunks) });
      done(null, { secure_url: url, public_id: options.public_id });
      callback();
    },
  });
};
cloudinary.uploader.destroy = async (id, options) => {
  assert.equal(options.invalidate, true);
  return { result: assets.delete(id) ? 'ok' : 'not found' };
};
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith('https://res.cloudinary.com/browser-test-cloud/')) {
    const asset = [...assets.values()].find((asset) => asset.url === url);
    return new Response(asset?.buffer, {
      status: asset ? 200 : 404,
      headers: { 'content-type': 'image/webp' },
    });
  }
  return originalFetch(url, options);
};
try {
  smtp = await startTestSmtp();
  Object.assign(process.env, {
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(smtp.port),
    SMTP_SECURE: 'false',
    SMTP_FROM: 'admiki HRM <noreply@browser.test>',
  });
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  repl = await memory.MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: '7.0.24' },
  });
  await mongoose.connect(repl.getUri(), { dbName: 'admiki_browser_tests' });
  for (const Model of Object.values(mongoose.models)) await Model.init();
  await Settings.create({ _id: 'company', weekends: [] });
  await Counter.create({ _id: 'employee', value: 1003 });
  const department = await Department.create({ name: 'Engineering' });
  const designation = await Designation.create({
    name: 'Software Engineer',
    department: department._id,
  });
  const names = { Admin: 'Alex Morgan', HR: 'Sarah Ahmed', Employee: 'Jamie Wilson' };
  let employeeId;
  for (const [index, role] of ['Admin', 'HR', 'Employee'].entries()) {
    const user = await User.create({
      name: names[role],
      email: `${role.toLowerCase()}@browser.test`,
      password: await bcrypt.hash(password, 10),
      role,
      mustChangePassword: false,
    });
    const person = await Employee.create({
      user: user._id,
      name: user.name,
      email: user.email,
      employeeId: String(1001 + index),
      joiningDate: '2024-01-01',
      salary: 30000,
      department: department._id,
      designation: designation._id,
    });
    user.employee = person._id;
    await user.save();
    if (role === 'Employee') employeeId = String(person._id);
  }
  await Attendance.create({
    employee: employeeId,
    date: `${dayjs().subtract(1, 'month').format('YYYY-MM')}-01`,
    checkIn: dayjs().subtract(1, 'month').startOf('month').hour(9).toDate(),
    status: 'Present',
  });
  apiServer = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => apiServer.once('listening', resolve));
  web = await preview({
    root: path.join(root, 'client'),
    preview: {
      host: '127.0.0.1',
      port: 5188,
      strictPort: true,
      proxy: {
        '/api': { target: `http://127.0.0.1:${apiServer.address().port}`, changeOrigin: true },
      },
    },
  });
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  } catch {
    browser = await chromium.launch({ headless: true });
  }
  await fs.mkdir(shots, { recursive: true });
  async function login(role, viewport = { width: 1440, height: 1000 }) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${process.env.CLIENT_URL}/login`);
    await page.getByLabel('Email address').fill(`${role.toLowerCase()}@browser.test`);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/dashboard');
    await page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ }).waitFor();
    return { context, page };
  }
  const admin = await login('Admin');
  await verifySearchStability(admin.page);
  await verifyDashboardCards(admin.page);
  assert.equal(await admin.page.locator('aside nav a').count(), 9);
  await admin.page.screenshot({ path: path.join(shots, 'admin-dashboard.png'), fullPage: true });
  await admin.page.getByRole('link', { name: 'Employees', exact: true }).click();
  await admin.page.getByRole('heading', { name: 'Your people' }).waitFor();
  await admin.page.getByRole('button', { name: 'Add employee', exact: true }).click();
  await admin.page.getByLabel('Full name', { exact: false }).fill('Taylor New');
  await admin.page.getByLabel('Email address', { exact: false }).fill('taylor@browser.test');
  await admin.page.getByLabel('Full-month salary', { exact: false }).fill('25000');
  await admin.page.getByLabel('Temporary login password', { exact: false }).fill('1234');
  await admin.page.getByRole('button', { name: 'Create employee', exact: true }).click();
  await admin.page.getByRole('dialog').waitFor({ state: 'hidden' });
  await admin.page.getByText('Taylor New', { exact: true }).waitFor();
  await admin.page.getByRole('button', { name: 'Edit Taylor New', exact: true }).click();
  const phone = admin.page.getByLabel('Phone number');
  await phone.click();
  await phone.pressSequentially('01712345678');
  assert.equal(await phone.inputValue(), '01712345678');
  await admin.page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await admin.page.getByRole('dialog').waitFor({ state: 'hidden' });
  await verifyHrmWorkflows(admin.page, shots);
  for (const [link, heading] of [
    ['Attendance', 'Attendance'],
    ['Leave', 'Leave'],
    ['Payroll', 'Pay'],
    ['Reports', 'Reports'],
    ['User Management', 'Accounts'],
    ['Settings', 'Company settings'],
    ['Activity History', 'Activity history'],
  ]) {
    await admin.page.getByRole('link', { name: link, exact: true }).click();
    await admin.page.getByRole('heading', { name: heading, exact: true }).waitFor();
    assert.equal(await admin.page.getByRole('alert').count(), 0, link);
    if (link === 'User Management') {
      await admin.page.getByRole('button', { name: 'Manage Taylor New', exact: true }).click();
      const resetInput = admin.page.getByLabel('Reset password (optional)');
      for (const role of ['Employee', 'HR', 'Admin', 'Employee']) {
        await admin.page.getByLabel('Account type', { exact: true }).selectOption(role);
        const minimum = role === 'Employee' ? 4 : 6;
        await expect(resetInput).toHaveAttribute('minlength', String(minimum));
        await resetInput.fill('1'.repeat(minimum - 1));
        await resetInput.press('End');
        await resetInput.press('1');
        assert.equal(await resetInput.evaluate((input) => input.checkValidity()), true);
        await resetInput.press('Backspace');
        assert.equal(await resetInput.evaluate((input) => input.validity.tooShort), true);
      }
      await resetInput.fill('1234');
      await admin.page.getByRole('button', { name: 'Save account', exact: true }).click();
      await admin.page.getByRole('dialog').waitFor({ state: 'hidden' });
    }
  }
  await admin.page.getByRole('link', { name: 'Settings', exact: true }).click();
  await admin.page.getByRole('heading', { name: 'Company settings' }).waitFor();
  await admin.page.getByRole('button', { name: 'Save changes' }).first().click();
  await admin.page.getByText('Company settings saved', { exact: true }).waitFor();
  await admin.page.getByRole('link', { name: 'Payroll', exact: true }).click();
  await admin.page.getByRole('button', { name: 'Prepare pay' }).click();
  await admin.page.getByRole('button', { name: 'Save monthly pay' }).click();
  await admin.page.getByRole('dialog').waitFor({ state: 'hidden' });
  await admin.page.getByRole('link', { name: 'Reports', exact: true }).click();
  const downloadPromise = admin.page.waitForEvent('download');
  await admin.page.getByRole('button', { name: 'Download Excel' }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /employees-report.*\.xlsx$/);
  assert.equal(await download.failure(), null);
  await admin.page.getByRole('link', { name: /^Notifications,/ }).click();
  await admin.page.getByRole('button', { name: 'New announcement' }).click();
  await admin.page.getByLabel('Announcement title').fill('Team gathering');
  await admin.page.getByLabel('Message', { exact: false }).fill('Please join us on Monday.');
  await admin.page.getByRole('button', { name: 'Send announcement', exact: true }).click();
  await admin.page.getByText('Announcement sent to 2 employees', { exact: true }).waitFor();
  await admin.context.close();
  console.log(
    'PASS Admin: 9 sidebar items, every page, employee create/edit, settings save, payroll and Excel download',
  );
  const hr = await login('HR');
  await verifyDashboardCards(hr.page);
  assert.equal(await hr.page.locator('aside nav a').count(), 6);
  await hr.page.goto(`${process.env.CLIENT_URL}/settings`);
  await hr.page.waitForURL('**/dashboard');
  assert.equal(
    await hr.page.getByRole('link', { name: 'User Management', exact: true }).count(),
    0,
  );
  await hr.context.close();
  console.log('PASS HR: 6 sidebar items and protected Admin routes');
  const employee = await login('Employee');
  await expect(employee.page.locator('a.card')).toHaveCount(0);
  assert.equal(await employee.page.locator('aside nav a').count(), 5);
  assert.equal(await employee.page.getByText('Total employees', { exact: true }).count(), 0);
  await employee.page.getByRole('link', { name: /^Notifications,/ }).click();
  await employee.page.getByRole('heading', { name: /^Team gathering/ }).waitFor();
  assert.equal(await employee.page.getByRole('button', { name: 'New announcement' }).count(), 0);
  await employee.page.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await expect(
    employee.page.getByRole('link', { name: 'Notifications, 0 unread', exact: true }),
  ).toBeVisible();
  await employee.page.getByRole('button', { name: 'Unread', exact: true }).click();
  await employee.page.getByText('You’re all caught up.', { exact: true }).waitFor();
  await employee.page.getByRole('button', { name: 'All', exact: true }).click();
  await employee.page.goto(`${process.env.CLIENT_URL}/profile`);
  await employee.page.getByRole('button', { name: 'Add picture', exact: true }).waitFor();
  const picture = {
    name: 'profile.png',
    mimeType: 'image/png',
    buffer: await sharp({ create: { width: 12, height: 12, channels: 3, background: '#176b51' } })
      .png()
      .toBuffer(),
  };
  await employee.page.getByLabel('Choose profile picture').setInputFiles(picture);
  await employee.page.getByRole('button', { name: 'Change picture', exact: true }).waitFor();
  const avatar = employee.page.getByRole('img', { name: "Jamie Wilson's profile" });
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveJSProperty('naturalWidth', 400);
  assert.equal(assets.size, 1);
  const originalPhoto = (await Employee.findById(employeeId)).photo;
  const accountTab = await employee.context.newPage();
  await accountTab.goto(`${process.env.CLIENT_URL}/account`);
  await accountTab.getByRole('button', { name: 'Change picture', exact: true }).waitFor();
  await accountTab.getByLabel('Current password', { exact: false }).fill('discard-this-password');
  await accountTab.screenshot({
    path: path.join(shots, 'account-back-button.png'),
    fullPage: true,
  });
  await accountTab.getByRole('button', { name: 'Back to home', exact: true }).click();
  await accountTab.waitForURL('**/dashboard');
  await accountTab.getByRole('heading', { name: /Good (morning|afternoon|evening)/ }).waitFor();
  await accountTab.goto(`${process.env.CLIENT_URL}/account`);
  assert.equal(await accountTab.getByLabel('Current password', { exact: false }).inputValue(), '');
  await employee.page.getByLabel('Choose profile picture').setInputFiles(picture);
  await expect(avatar).not.toHaveAttribute(
    'src',
    new RegExp(encodeURIComponent(originalPhoto.public_id)),
  );
  await employee.page.getByRole('button', { name: 'Change picture', exact: true }).waitFor();
  const replacement = (await Employee.findById(employeeId)).photo;
  assert.notEqual(replacement.public_id, originalPhoto.public_id);
  assert.equal(assets.has(originalPhoto.public_id), false);
  await expect(accountTab.getByRole('img', { name: "Jamie Wilson's profile" })).toHaveAttribute(
    'src',
    new RegExp(encodeURIComponent(replacement.public_id)),
  );
  await employee.page.getByRole('button', { name: 'Delete picture', exact: true }).click();
  await employee.page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  assert.equal(assets.size, 1);
  await employee.page.getByRole('button', { name: 'Delete picture', exact: true }).click();
  await employee.page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete picture', exact: true })
    .click();
  await employee.page.getByRole('button', { name: 'Add picture', exact: true }).waitFor();
  await accountTab.getByRole('button', { name: 'Add picture', exact: true }).waitFor();
  await expect(avatar).toHaveCount(0);
  await expect(accountTab.getByRole('img', { name: "Jamie Wilson's profile" })).toHaveCount(0);
  assert.equal(assets.size, 0);
  assert.equal((await Employee.findById(employeeId)).photo, null);
  await accountTab.close();
  console.log(
    'PASS Profile photos: add, replace, cancel deletion, delete, stored asset cleanup and account tab refresh',
  );
  await employee.page.getByRole('link', { name: 'Attendance', exact: true }).click();
  await employee.page.getByRole('button', { name: 'Check in', exact: true }).click();
  await employee.page.getByRole('button', { name: 'Check out', exact: true }).waitFor();
  await employee.page.getByRole('button', { name: 'Check out', exact: true }).click();
  await employee.page.getByText('Workday complete', { exact: true }).waitFor();
  await employee.page.getByRole('link', { name: 'Leave', exact: true }).click();
  await employee.page.getByRole('button', { name: 'Request leave', exact: true }).click();
  const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
  await employee.page.getByLabel('Start date').fill(tomorrow);
  await employee.page.getByLabel('End date').fill(tomorrow);
  await employee.page.getByLabel('Reason').fill('A personal appointment');
  await employee.page.getByRole('button', { name: 'Submit request' }).click();
  await employee.page.getByRole('dialog').waitFor({ state: 'hidden' });
  await employee.page
    .getByRole('table')
    .getByText('Waiting for approval', { exact: true })
    .waitFor();
  const reviewer = await login('HR');
  await reviewer.page.getByRole('link', { name: /^Notifications,/ }).click();
  await reviewer.page.getByRole('heading', { name: /^New leave request/ }).waitFor();
  const requestLink = reviewer.page.getByRole('link', { name: /^New leave request:/ });
  const requestPath = await requestLink.getAttribute('href');
  assert.match(requestPath, /^\/leave\/[a-f\d]{24}$/);
  await requestLink.click({ position: { x: 10, y: 10 } });
  await reviewer.page.waitForURL(`**${requestPath}`);
  await reviewer.page.getByRole('heading', { name: 'Leave request', exact: true }).waitFor();
  await reviewer.page.getByText('A personal appointment', { exact: true }).waitFor();
  await reviewer.page.getByRole('button', { name: 'Approve leave', exact: true }).click();
  await reviewer.page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm approval', exact: true })
    .click();
  await reviewer.page.getByRole('dialog').waitFor({ state: 'hidden' });
  await reviewer.context.close();
  await employee.page.getByRole('link', { name: /^Notifications,/ }).click();
  await employee.page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await employee.page.getByRole('heading', { name: /^Leave request approved/ }).waitFor();
  assert.equal(await employee.page.getByRole('heading', { name: /^New leave request/ }).count(), 0);
  const decisionLink = employee.page.getByRole('link', { name: /^Leave request approved:/ });
  assert.equal(await decisionLink.getAttribute('href'), requestPath);
  await decisionLink.focus();
  await employee.page.keyboard.press('Enter');
  await employee.page.waitForURL(`**${requestPath}`);
  await employee.page.getByRole('heading', { name: 'Leave request', exact: true }).waitFor();
  await employee.page.getByText('Approved', { exact: true }).waitFor();
  assert.equal(
    await employee.page.getByRole('button', { name: 'Approve leave', exact: true }).count(),
    0,
  );
  await expect(
    employee.page.getByRole('link', { name: 'Notifications, 0 unread', exact: true }),
  ).toBeVisible();
  await employee.page.screenshot({
    path: path.join(shots, 'employee-leave-request.png'),
    fullPage: true,
  });
  console.log(
    'PASS Notifications: entire item links to its exact leave request, keyboard navigation, automatic read state, review from detail page; account Back returns to dashboard',
  );
  await employee.page.getByRole('link', { name: 'Payslip', exact: true }).click();
  await employee.page.getByRole('heading', { name: 'Your pay details' }).waitFor();
  const pdfPromise = employee.page.waitForEvent('download');
  await employee.page
    .getByRole('button', { name: /Download pay details PDF/ })
    .first()
    .click();
  assert.equal(await (await pdfPromise).failure(), null);
  await employee.page.goto(`${process.env.CLIENT_URL}/employees/${employeeId}`);
  await employee.page.waitForURL('**/dashboard');
  await employee.context.close();
  console.log(
    'PASS Employee: 5 sidebar items, own dashboard, check-in/out, leave apply and PDF payslip',
  );
  const mobile = await login('Employee', { width: 390, height: 844 });
  await mobile.page.getByRole('link', { name: /^Notifications,/ }).click();
  await mobile.page.getByRole('heading', { name: 'Notifications', exact: true }).waitFor();
  assert.equal(
    await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await mobile.page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await mobile.page.getByRole('link', { name: 'Profile', exact: true }).click();
  await mobile.page.getByRole('heading', { name: 'Your profile' }).waitFor();
  await mobile.page.screenshot({ path: path.join(shots, 'employee-mobile.png'), fullPage: true });
  await mobile.context.close();
  console.log('PASS Mobile: drawer navigation and no horizontal page overflow');
  const unconfigured = await browser.newContext();
  const unconfiguredPage = await unconfigured.newPage();
  const configuredSmtpHost = process.env.SMTP_HOST;
  try {
    delete process.env.SMTP_HOST;
    await unconfiguredPage.goto(`${process.env.CLIENT_URL}/forgot-password`);
    await unconfiguredPage.getByLabel('Email address').fill('employee@browser.test');
    await unconfiguredPage.getByRole('button', { name: 'Send reset link', exact: true }).click();
    await expect(unconfiguredPage.getByRole('alert')).toContainText(
      'Password reset email is not configured',
    );
  } finally {
    process.env.SMTP_HOST = configuredSmtpHost;
    await unconfigured.close();
  }
  console.log(
    'PASS Unconfigured recovery: clear not-configured message without disrupting the app',
  );
  for (const role of ['Employee', 'HR', 'Admin']) {
    const recovery = await browser.newContext({
      viewport: role === 'Employee' ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    });
    const page = await recovery.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${process.env.CLIENT_URL}/login`);
    await page.getByRole('link', { name: 'Forgot password?', exact: true }).click();
    await page.getByLabel('Email address').fill(`${role.toLowerCase()}@browser.test`);
    await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
    await page
      .getByText(
        'If an active account exists for that email, a password reset link will be sent shortly.',
        { exact: true },
      )
      .waitFor();
    await drainPasswordEmails();
    const email = smtp.messages
      .filter(
        (mail) =>
          mail.to.includes(`${role.toLowerCase()}@browser.test`) &&
          mail.text.includes('/reset-password#'),
      )
      .at(-1);
    assert.ok(email, 'Reset email was delivered over local SMTP');
    const token = email.text.match(/\/reset-password#([a-f0-9]{64})/)[1];
    await page.goto(`${process.env.CLIENT_URL}/reset-password#${token}`);
    await page.getByLabel('Confirm new password').waitFor();
    await expect.poll(() => new URL(page.url()).hash).toBe('');
    const changedPassword = role === 'Employee' ? '1234' : 'abcdef';
    await page.getByLabel(/^New password/).fill(changedPassword);
    await page.getByLabel('Confirm new password').fill(`${changedPassword}-mismatch`);
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await page.getByText('New passwords do not match', { exact: true }).waitFor();
    await page.getByLabel('Confirm new password').fill(changedPassword);
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await page
      .getByText('Password reset successfully. Please sign in with your new password.', {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await page.screenshot({
      path: path.join(shots, `password-reset-${role.toLowerCase()}.png`),
      fullPage: true,
    });
    await page.getByRole('link', { name: 'Back to sign in', exact: true }).click();
    await page.getByLabel('Email address').fill(`${role.toLowerCase()}@browser.test`);
    await page.locator('input[autocomplete="current-password"]').fill(changedPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/dashboard');
    await page.goto(`${process.env.CLIENT_URL}/account`);
    const minimum = role === 'Employee' ? 4 : 6;
    await expect(page.getByLabel(/^New password/)).toHaveAttribute('minlength', String(minimum));
    await expect(page.getByLabel('Confirm new password')).toHaveAttribute(
      'minlength',
      String(minimum),
    );
    await page.getByLabel('Current password', { exact: false }).fill(changedPassword);
    const personalPassword = role === 'Employee' ? 'text' : '123456';
    await page.getByLabel(/^New password/).fill(personalPassword);
    await page.getByLabel('Confirm new password').fill(personalPassword);
    await page.getByRole('button', { name: 'Update password', exact: true }).click();
    await page.getByText('Password changed successfully', { exact: true }).waitFor();
    await recovery.close();
  }
  console.log(
    'PASS Password recovery: Employee, HR and Admin SMTP reset links, mismatch validation, hidden URL token, mobile layout and new-password sign-in',
  );
  assert.deepEqual(errors, [], `Browser runtime errors: ${errors.join('; ')}`);
  console.log(
    'Browser smoke checks passed without runtime errors. Screenshots saved in artifacts/.',
  );
} finally {
  cloudinary.uploader.upload_stream = originalUpload;
  cloudinary.uploader.destroy = originalDestroy;
  globalThis.fetch = originalFetch;
  await browser?.close();
  if (web) await new Promise((resolve) => web.httpServer.close(resolve));
  if (apiServer) await new Promise((resolve) => apiServer.close(resolve));
  await mongoose.disconnect();
  await repl?.stop();
  await smtp?.close();
}
