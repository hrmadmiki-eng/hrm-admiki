import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { v2 as cloudinary } from 'cloudinary';
import { createApp } from '../app.js';
import {
  User,
  Employee,
  Settings,
  Counter,
  Attendance,
  Payroll,
  AuditLog,
} from '../models/index.js';
import { dayjs, today } from '../utils/dates.js';
import { PhotoCleanup, drainPhotoCleanup } from '../services/photo-cleanup.js';
import { root } from '../config/env.js';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-test-secret-never-used-in-production-2026';
process.env.CLIENT_URL = 'http://localhost:5173';
process.env.JWT_EXPIRE = '7d';
process.env.BCRYPT_SALT_ROUNDS = '10';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';
const origin = process.env.CLIENT_URL;
const password = 'Test-password-2026!';
let repl, app, admin, hr, employee, other, config, month, firstDay, secondDay, thirdDay, fourthDay;
const cookies = {};
const cloudinaryUploads = [];
const cloudinaryDeletes = [];
const originalUploadStream = cloudinary.uploader.upload_stream;
const originalDestroy = cloudinary.uploader.destroy;
const originalFetch = globalThis.fetch;
async function makeUser(role, number) {
  const user = await User.create({
    name: `${role} Test ${number}`,
    email: `test${number}@example.com`,
    password: await bcrypt.hash(password, 10),
    role,
    mustChangePassword: false,
  });
  const person = await Employee.create({
    user: user._id,
    name: user.name,
    email: user.email,
    employeeId: `TEST-${number}`,
    joiningDate: '2024-01-01',
    salary: 30000,
  });
  user.employee = person._id;
  await user.save();
  return { user, person };
}
function as(role, method, path) {
  return request(app)[method](path).set('Origin', origin).set('Cookie', cookies[role]);
}
before(
  async () => {
    cloudinary.uploader.upload_stream = (options, done) =>
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
        final(callback) {
          assert.equal(options.backup, false);
          assert.equal(options.overwrite, false);
          assert.equal(options.resource_type, 'image');
          assert.match(options.public_id, /^admiki-hrms\/profile-pictures\//);
          cloudinaryUploads.push(options.public_id);
          done(null, {
            secure_url: `https://res.cloudinary.com/test-cloud/image/upload/${options.public_id}.webp`,
            public_id: options.public_id,
          });
          callback();
        },
      });
    cloudinary.uploader.destroy = async (publicId) => {
      cloudinaryDeletes.push(publicId);
      return { result: 'ok' };
    };
    globalThis.fetch = async (url, options) => {
      if (String(url).startsWith('https://res.cloudinary.com/test-cloud/'))
        return new Response(Buffer.from('mock-webp'), {
          status: 200,
          headers: { 'content-type': 'image/webp' },
        });
      return originalFetch(url, options);
    };
    repl = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      binary: { version: '7.0.24' },
    });
    await mongoose.connect(repl.getUri(), { dbName: 'admiki_isolated_tests' });
    for (const Model of Object.values(mongoose.models)) await Model.init();
    config = await Settings.create({
      _id: 'company',
      weekends: [],
      leavePolicy: { Casual: 1, Sick: 14, Annual: 20 },
    });
    await Counter.create({ _id: 'employee', value: 0 });
    admin = await makeUser('Admin', 1);
    hr = await makeUser('HR', 2);
    employee = await makeUser('Employee', 3);
    other = await makeUser('Employee', 4);
    app = createApp();
    for (const [role, data] of Object.entries({ admin, hr, employee, other })) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Origin', origin)
        .send({ email: data.user.email, password });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      cookies[role] = res.headers['set-cookie'][0].split(';')[0];
    }
    month = dayjs().subtract(1, 'month').format('YYYY-MM');
    firstDay = `${month}-01`;
    secondDay = `${month}-02`;
    thirdDay = `${month}-03`;
    fourthDay = `${month}-04`;
  },
  { timeout: 240000 },
);
after(async () => {
  cloudinary.uploader.upload_stream = originalUploadStream;
  cloudinary.uploader.destroy = originalDestroy;
  globalThis.fetch = originalFetch;
  await mongoose.disconnect();
  await repl?.stop();
});
test('authentication, standardized errors and cross-origin protection', async () => {
  const res = await request(app).get('/api/employees');
  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
  assert.ok('data' in res.body && 'error' in res.body);
  assert.equal(
    (
      await request(app)
        .post('/api/auth/login')
        .set('Origin', origin)
        .send({ email: 'nobody@example.com', password: 'wrong' })
    ).status,
    401,
  );
  assert.equal(
    (await request(app).post('/api/auth/login').send({ email: admin.user.email, password })).status,
    403,
  );
  assert.equal(
    (
      await request(app)
        .post('/api/auth/logout')
        .set('Origin', 'https://evil.example')
        .set('Cookie', cookies.admin)
    ).status,
    403,
  );
});
test('HR is denied Admin-only APIs and employees cannot perform management writes', async () => {
  for (const route of ['/users', '/settings', '/audit'])
    assert.equal((await as('hr', 'get', `/api${route}`)).status, 403, route);
  assert.equal(
    (await as('hr', 'put', '/api/settings').send({ companyName: 'Attack' })).status,
    403,
  );
  assert.equal(
    (await as('hr', 'patch', `/api/users/${employee.user._id}`).send({ role: 'Admin' })).status,
    403,
  );
  for (const route of [
    '/employees',
    '/departments',
    '/designations',
    '/reports/payroll',
    '/users',
    '/settings',
    '/audit',
  ])
    assert.equal((await as('employee', 'get', `/api${route}`)).status, 403, route);
  assert.equal((await as('employee', 'post', '/api/employees').send({})).status, 403);
  assert.equal((await as('employee', 'put', '/api/attendance/manual').send({})).status, 403);
  assert.equal((await as('employee', 'post', '/api/payroll/generate').send({})).status, 403);
});
test('employee dashboard and query scoping exclude company and coworker data', async () => {
  const res = await as('employee', 'get', '/api/dashboard');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.employee._id, String(employee.person._id));
  for (const field of [
    'totalEmployees',
    'presentToday',
    'onLeave',
    'payrollSeries',
    'departments',
    'pendingLeave',
  ])
    assert.ok(!(field in res.body.data));
  for (const resource of ['attendance', 'leave', 'payroll']) {
    assert.equal(
      (await as('employee', 'get', `/api/${resource}?employee=${other.person._id}`)).status,
      403,
    );
    assert.equal(
      (await as('employee', 'get', `/api/${resource}?department=${new mongoose.Types.ObjectId()}`))
        .status,
      403,
    );
  }
  assert.equal((await as('employee', 'get', `/api/employees/${other.person._id}`)).status, 403);
  const me = await as('employee', 'get', '/api/auth/me');
  assert.ok(!('password' in me.body.data));
  assert.ok(!('tokenVersion' in me.body.data));
});
test('bad IDs, dates, object filters and malformed JSON produce 400 errors', async () => {
  assert.equal((await as('admin', 'get', '/api/employees/not-an-id')).status, 400);
  assert.equal((await as('admin', 'get', '/api/attendance?month=2026-99')).status, 400);
  assert.equal((await as('admin', 'get', '/api/employees?search=ok&search=also')).status, 400);
  assert.equal(
    (
      await as('employee', 'post', '/api/leave').send({
        type: 'Sick',
        startDate: '2025-02-29',
        endDate: '2025-03-01',
        reason: 'Invalid',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await as('admin', 'post', '/api/departments')
        .set('Content-Type', 'application/json')
        .send('{broken')
    ).status,
    400,
  );
});
test('assignment validation, protected deletion and mandatory first password change', async () => {
  const a = await as('hr', 'post', '/api/departments').send({ name: 'Engineering' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await as('hr', 'post', '/api/departments').send({ name: 'Finance' });
  const role = await as('hr', 'post', '/api/designations').send({
    name: 'Engineer',
    department: a.body.data._id,
  });
  assert.equal(role.status, 201);
  const payload = {
    name: 'New Employee',
    email: 'new@example.com',
    joiningDate: '2024-01-01',
    salary: 20000,
    department: b.body.data._id,
    designation: role.body.data._id,
    password,
  };
  assert.equal((await as('hr', 'post', '/api/employees').send(payload)).status, 400);
  assert.equal(
    (
      await as('hr', 'post', '/api/employees').send({
        ...payload,
        department: a.body.data._id,
        password: '123',
      })
    ).status,
    400,
  );
  const created = await as('hr', 'post', '/api/employees').send({
    ...payload,
    department: a.body.data._id,
    role: 'Admin',
    password: '1234',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.match(created.body.data.employeeId, /^1\d{3}$/);
  const user = await User.findById(created.body.data.user);
  assert.equal(user.role, 'Employee');
  assert.equal(user.mustChangePassword, true);
  assert.equal((await as('hr', 'delete', `/api/departments/${a.body.data._id}`)).status, 409);
  const login = await request(app)
    .post('/api/auth/login')
    .set('Origin', origin)
    .send({ email: user.email, password: '1234' });
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  assert.equal((await request(app).get('/api/dashboard').set('Cookie', cookie)).status, 403);
  const changed = await request(app)
    .put('/api/auth/password')
    .set('Origin', origin)
    .set('Cookie', cookie)
    .send({ currentPassword: '1234', newPassword: 'text' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.data.mustChangePassword, false);
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 401);
});
test('simultaneous self check-ins create exactly one record', async () => {
  const results = await Promise.all([
    as('employee', 'post', '/api/attendance/check-in'),
    as('employee', 'post', '/api/attendance/check-in'),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    await Attendance.countDocuments({ employee: employee.person._id, date: today(config) }),
    1,
  );
  assert.equal((await as('employee', 'post', '/api/attendance/check-out')).status, 200);
  assert.equal((await as('employee', 'post', '/api/attendance/check-out')).status, 409);
});
test('leave overlap, self-approval, quota overflow and attendance conflict', async () => {
  const payload = {
    type: 'Casual',
    startDate: secondDay,
    endDate: thirdDay,
    reason: 'Family commitment',
  };
  const res = await as('employee', 'post', '/api/leave').send(payload);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await as('employee', 'post', '/api/leave').send(payload)).status, 409);
  assert.equal(
    (
      await as('employee', 'patch', `/api/leave/${res.body.data._id}/review`).send({
        status: 'Approved',
      })
    ).status,
    403,
  );
  const approved = await as('hr', 'patch', `/api/leave/${res.body.data._id}/review`).send({
    status: 'Approved',
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.data.paidDates.length, 1);
  assert.equal(approved.body.data.workDates.length, 2);
  assert.equal(
    (
      await as('admin', 'put', '/api/attendance/manual').send({
        employee: employee.person._id,
        date: secondDay,
        status: 'Present',
        checkIn: '09:00',
      })
    ).status,
    409,
  );
  const own = await as('hr', 'post', '/api/leave').send({ ...payload, type: 'Sick' });
  assert.equal(own.status, 201);
  assert.equal(
    (await as('hr', 'patch', `/api/leave/${own.body.data._id}/review`).send({ status: 'Approved' }))
      .status,
    403,
  );
  await as('admin', 'patch', `/api/leave/${own.body.data._id}/review`).send({ status: 'Rejected' });
  const balance = await as('employee', 'get', `/api/leave/balance?year=${month.slice(0, 4)}`);
  assert.equal(balance.body.data.balances.find((b) => b.type === 'Casual').remaining, 0);
});
test('payroll blocks pending leave, computes snapshots and locks source records', async () => {
  assert.equal(
    (
      await as('hr', 'put', '/api/attendance/manual').send({
        employee: employee.person._id,
        date: firstDay,
        status: 'Present',
        checkIn: '09:00',
        checkOut: '18:00',
      })
    ).status,
    200,
  );
  const leave = await as('employee', 'post', '/api/leave').send({
    type: 'Sick',
    startDate: fourthDay,
    endDate: fourthDay,
    reason: 'Appointment',
  });
  assert.equal(leave.status, 201);
  assert.equal(
    (
      await as('hr', 'post', '/api/payroll/generate').send({
        month,
        employee: String(employee.person._id),
      })
    ).status,
    409,
  );
  await as('employee', 'patch', `/api/leave/${leave.body.data._id}/cancel`);
  const generated = await as('hr', 'post', '/api/payroll/generate').send({
    month,
    employee: String(employee.person._id),
    allowance: 1000,
    bonus: 500,
    deduction: 100,
  });
  assert.equal(generated.status, 200, JSON.stringify(generated.body));
  assert.equal(generated.body.data.created, 1);
  const record = await Payroll.findOne({ employee: employee.person._id, month });
  assert.equal(record.presentDays, 1);
  assert.equal(record.paidDays, 1);
  assert.equal(record.unpaidDays, 1);
  assert.equal(record.absentDays, record.workingDays - 3);
  assert.equal(record.basic, 30000);
  assert.equal(
    record.netSalary,
    Math.round(
      (31400 - Math.round(((30000 * (record.workingDays - 2)) / record.workingDays) * 100) / 100) *
        100,
    ) / 100,
  );
  const repeat = await as('hr', 'post', '/api/payroll/generate').send({
    month,
    employee: String(employee.person._id),
  });
  assert.equal(repeat.body.data.skipped, 1);
  assert.equal(
    (
      await as('hr', 'put', '/api/attendance/manual').send({
        employee: employee.person._id,
        date: fourthDay,
        status: 'Absent',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await as('employee', 'post', '/api/leave').send({
        type: 'Sick',
        startDate: fourthDay,
        endDate: fourthDay,
        reason: 'Retroactive',
      })
    ).status,
    409,
  );
  assert.equal(
    (await as('hr', 'post', '/api/payroll/generate').send({ month: dayjs().format('YYYY-MM') }))
      .status,
    400,
  );
  assert.equal((await as('other', 'get', `/api/payroll/${record._id}/payslip`)).status, 403);
  assert.equal((await as('employee', 'patch', `/api/payroll/${record._id}/paid`)).status, 403);
  assert.equal((await as('hr', 'patch', `/api/payroll/${record._id}/paid`)).status, 200);
  assert.equal((await as('hr', 'patch', `/api/payroll/${record._id}/paid`)).status, 409);
});
test('reports and personal payslips generate valid PDF and Excel files', async () => {
  function binary(res, callback) {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  }
  for (const type of ['employees', 'attendance', 'leave', 'payroll']) {
    const response = await as(
      'admin',
      'get',
      `/api/reports/${type}?month=${month}&employee=${employee.person._id}&format=excel`,
    )
      .buffer(true)
      .parse(binary);
    assert.equal(response.status, 200, type);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    assert.ok(workbook.worksheets[0].rowCount >= 1, type);
  }
  const record = await Payroll.findOne({ employee: employee.person._id });
  const pdf = await as('employee', 'get', `/api/payroll/${record._id}/payslip?format=pdf`)
    .buffer(true)
    .parse(binary);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
  assert.match(pdf.headers['content-disposition'], /attachment/);
  const excel = await as('employee', 'get', `/api/payroll/${record._id}/payslip?format=excel`)
    .buffer(true)
    .parse(binary);
  assert.equal(excel.status, 200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(excel.body);
  assert.equal(
    book.worksheets[0].getCell('B2').value,
    `${employee.person.name} (${employee.person.employeeId})`,
  );
});
test('photo uploads validate image content and enforce employee ownership', async () => {
  const image = await sharp({
    create: { width: 12, height: 12, channels: 3, background: '#176b51' },
  })
    .png()
    .toBuffer();
  const uploaded = await as('admin', 'post', `/api/employees/${other.person._id}/photo`).attach(
    'photo',
    image,
    'avatar.png',
  );
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  const firstPhoto = uploaded.body.data.photo;
  assert.match(firstPhoto.url, /^https:\/\/res\.cloudinary\.com\//);
  assert.ok(firstPhoto.public_id);
  assert.deepEqual((await Employee.findById(other.person._id).lean()).photo, firstPhoto);
  assert.equal(
    (await as('employee', 'get', `/api/employees/${other.person._id}/photo`)).status,
    403,
  );
  const photo = await as('other', 'get', `/api/employees/${other.person._id}/photo`);
  assert.equal(photo.status, 200);
  assert.match(photo.headers['content-type'], /^image\/webp/);
  const replaced = await as('admin', 'post', `/api/employees/${other.person._id}/photo`).attach(
    'photo',
    image,
    'replacement.png',
  );
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  assert.notEqual(replaced.body.data.photo.public_id, firstPhoto.public_id);
  assert.ok(cloudinaryDeletes.includes(firstPhoto.public_id));
  assert.equal(
    (
      await as('admin', 'post', `/api/employees/${other.person._id}/photo`).attach(
        'photo',
        Buffer.from('<script>bad()</script>'),
        'fake.png',
      )
    ).status,
    400,
  );
  assert.equal(
    (await as('admin', 'delete', `/api/employees/${other.person._id}/photo`)).status,
    200,
  );
  assert.ok(cloudinaryDeletes.includes(replaced.body.data.photo.public_id));
  assert.equal((await Employee.findById(other.person._id).lean()).photo, null);
  assert.equal(cloudinaryUploads.length, 2);

  const archived = await makeUser('Employee', 99);
  archived.person.photo = {
    url: 'https://res.cloudinary.com/test-cloud/image/upload/archive-photo.webp',
    public_id: 'admiki-hrms/profile-pictures/archive-photo',
  };
  archived.person.markModified('photo');
  await archived.person.save();
  assert.equal((await as('admin', 'delete', `/api/employees/${archived.person._id}`)).status, 200);
  assert.ok(cloudinaryDeletes.includes(archived.person.photo.public_id));
  const archivedRecord = await Employee.findById(archived.person._id).lean();
  assert.equal(archivedRecord.deleted, true);
  assert.equal(archivedRecord.photo, undefined);
});
async function photoImage() {
  return sharp({ create: { width: 12, height: 12, channels: 3, background: '#176b51' } })
    .png()
    .toBuffer();
}
const testPhoto = (id) => ({
  url: `https://res.cloudinary.com/test-cloud/image/upload/${id}.webp`,
  public_id: id,
});

test('failed cleanup is persisted and retried for replacement, removal and archival', async (t) => {
  const person = (await makeUser('Employee', 101)).person;
  person.photo = testPhoto('cleanup-replacement');
  await person.save();
  const destroy = cloudinary.uploader.destroy;
  const failing = t.mock.method(cloudinary.uploader, 'destroy', async () => {
    throw new Error('provider unavailable');
  });
  const replacement = await as('admin', 'post', `/api/employees/${person._id}/photo`).attach(
    'photo',
    await photoImage(),
    'replacement.png',
  );
  assert.equal(replacement.status, 200);
  assert.deepEqual((await Employee.findById(person._id)).photo, replacement.body.data.photo);
  assert.ok(await PhotoCleanup.exists({ publicId: person.photo.public_id }));
  const removed = await as('admin', 'delete', `/api/employees/${person._id}/photo`);
  assert.equal(removed.status, 200);
  assert.match(removed.body.message, /Stored image deletion is pending/);
  assert.equal((await Employee.findById(person._id)).photo, null);
  assert.ok(await PhotoCleanup.exists({ publicId: replacement.body.data.photo.public_id }));
  await Employee.updateOne({ _id: person._id }, { $set: { photo: testPhoto('cleanup-archive') } });
  assert.equal((await as('admin', 'delete', `/api/employees/${person._id}`)).status, 200);
  assert.ok(await PhotoCleanup.exists({ publicId: 'cleanup-archive' }));
  failing.mock.restore();
  const retry = t.mock.method(cloudinary.uploader, 'destroy', async (id, options) => {
    assert.equal(options.invalidate, true);
    assert.equal(options.resource_type, 'image');
    return destroy(id, options);
  });
  await PhotoCleanup.updateMany({}, { $set: { nextAttemptAt: new Date(0) } });
  await drainPhotoCleanup();
  assert.equal(retry.mock.callCount(), 3);
  assert.equal(await PhotoCleanup.countDocuments(), 0);
});

test('a database failure preserves the old photo and cleans up the new upload', async (t) => {
  const person = (await makeUser('Employee', 102)).person;
  person.photo = testPhoto('preserved-on-db-failure');
  await person.save();
  t.mock.method(AuditLog, 'create', async () => {
    throw new Error('simulated database failure');
  });
  const response = await as('admin', 'post', `/api/employees/${person._id}/photo`).attach(
    'photo',
    await photoImage(),
    'avatar.png',
  );
  assert.equal(response.status, 500);
  assert.deepEqual((await Employee.findById(person._id)).photo, person.photo);
  assert.ok(cloudinaryDeletes.includes(cloudinaryUploads.at(-1)));
  assert.ok(!cloudinaryDeletes.includes(person.photo.public_id));
  assert.equal(await PhotoCleanup.countDocuments(), 0);
});

test('upload errors preserve the current photo and reserve cleanup for ambiguous uploads', async (t) => {
  const person = (await makeUser('Employee', 103)).person;
  person.photo = testPhoto('preserved-on-upload-failure');
  await person.save();
  let attempted;
  t.mock.method(cloudinary.uploader, 'upload_stream', (options, done) => {
    attempted = options.public_id;
    return new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
      final(callback) {
        done(new Error('provider error with private details'));
        callback();
      },
    });
  });
  const response = await as('admin', 'post', `/api/employees/${person._id}/photo`).attach(
    'photo',
    await photoImage(),
    'avatar.png',
  );
  assert.equal(response.status, 502);
  assert.ok(!JSON.stringify(response.body).includes('private details'));
  assert.deepEqual((await Employee.findById(person._id)).photo, person.photo);
  assert.ok(await PhotoCleanup.exists({ publicId: attempted }));
  await PhotoCleanup.updateMany({}, { $set: { nextAttemptAt: new Date(0) } });
  await drainPhotoCleanup();
  assert.ok(cloudinaryDeletes.includes(attempted));
  assert.ok(!cloudinaryDeletes.includes(person.photo.public_id));
});

test('a replacement during photo deletion retains the new photo', { timeout: 15000 }, async (t) => {
  const person = (await makeUser('Employee', 104)).person;
  person.photo = testPhoto('concurrent-photo');
  await person.save();
  const destroy = cloudinary.uploader.destroy;
  let release, deleting;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    deleting = resolve;
  });
  t.mock.method(cloudinary.uploader, 'destroy', async (id, options) => {
    if (id === person.photo.public_id) {
      deleting();
      await gate;
    }
    return destroy(id, options);
  });
  const removal = as('admin', 'delete', `/api/employees/${person._id}/photo`).then((res) => res);
  try {
    await started;
    const replacement = await as('admin', 'post', `/api/employees/${person._id}/photo`).attach(
      'photo',
      await photoImage(),
      'new.png',
    );
    assert.equal(replacement.status, 200);
    release();
    assert.equal((await removal).status, 200);
    assert.deepEqual((await Employee.findById(person._id)).photo, replacement.body.data.photo);
    assert.ok(!cloudinaryDeletes.includes(replacement.body.data.photo.public_id));
    assert.equal(await PhotoCleanup.countDocuments(), 0);
  } finally {
    release();
  }
});

test('cleanup skips a currently referenced image and accepts already deleted assets', async (t) => {
  const person = (await makeUser('Employee', 105)).person;
  person.photo = testPhoto('still-in-use');
  await person.save();
  await PhotoCleanup.create([
    { publicId: person.photo.public_id },
    { publicId: 'already-deleted' },
  ]);
  const destroy = t.mock.method(cloudinary.uploader, 'destroy', async (id) => {
    assert.equal(id, 'already-deleted');
    return { result: 'not found' };
  });
  await drainPhotoCleanup();
  assert.equal(destroy.mock.callCount(), 1);
  assert.equal(await PhotoCleanup.countDocuments(), 0);
  assert.deepEqual((await Employee.findById(person._id)).photo, person.photo);
});

test('legacy local photos remain readable and are removed when replaced', async () => {
  const person = (await makeUser('Employee', 106)).person;
  const filename = `test-legacy-${randomUUID()}.png`;
  const uploads = path.join(root, 'server/uploads');
  const filePath = path.join(uploads, filename);
  await fs.mkdir(uploads, { recursive: true });
  await fs.writeFile(filePath, await photoImage());
  try {
    person.photo = filename;
    await person.save();
    const existing = await as('admin', 'get', `/api/employees/${person._id}/photo`);
    assert.equal(existing.status, 200);
    assert.match(existing.headers['content-type'], /^image\/png/);
    const replacement = await as('admin', 'post', `/api/employees/${person._id}/photo`).attach(
      'photo',
      await photoImage(),
      'new.png',
    );
    assert.equal(replacement.status, 200);
    assert.ok(replacement.body.data.photo.public_id);
    await assert.rejects(fs.access(filePath), { code: 'ENOENT' });
    assert.equal(await PhotoCleanup.countDocuments(), 0);
  } finally {
    await fs.unlink(filePath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
});

test('missing configuration and oversized uploads leave existing photos intact', async () => {
  const person = (await makeUser('Employee', 107)).person;
  person.photo = testPhoto('preserved-on-invalid-request');
  await person.save();
  const uploadsBefore = cloudinaryUploads.length;
  const secret = process.env.CLOUDINARY_API_SECRET;
  try {
    delete process.env.CLOUDINARY_API_SECRET;
    const missing = await as('admin', 'post', `/api/employees/${person._id}/photo`).attach(
      'photo',
      await photoImage(),
      'new.png',
    );
    assert.equal(missing.status, 503);
  } finally {
    process.env.CLOUDINARY_API_SECRET = secret;
  }
  const oversized = await as('admin', 'post', `/api/employees/${person._id}/photo`).attach(
    'photo',
    Buffer.alloc(3 * 1024 * 1024 + 1),
    'large.png',
  );
  assert.equal(oversized.status, 400);
  assert.equal(cloudinaryUploads.length, uploadsBefore);
  assert.deepEqual((await Employee.findById(person._id)).photo, person.photo);
  await PhotoCleanup.updateMany({}, { $set: { nextAttemptAt: new Date(0) } });
  await drainPhotoCleanup();
});

test('Cloudinary permission denial gives an actionable error without leaking provider secrets', async (t) => {
  const person = (await makeUser('Employee', 108)).person;
  person.photo = testPhoto('preserved-on-permission-denial');
  await person.save();
  const logs = t.mock.method(console, 'error', () => {});
  t.mock.method(
    cloudinary.uploader,
    'upload_stream',
    (_options, done) =>
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
        final(callback) {
          done({
            http_code: 403,
            message: 'private-provider-key-and-signature',
            request: { api_secret: 'never-log-this' },
          });
          callback();
        },
      }),
  );
  const response = await as('admin', 'post', `/api/employees/${person._id}/photo`).attach(
    'photo',
    await photoImage(),
    'new.png',
  );
  assert.equal(response.status, 503);
  assert.match(response.body.message, /Cloudinary asset create\/upload permissions/);
  assert.equal(response.body.success, false);
  assert.deepEqual((await Employee.findById(person._id)).photo, person.photo);
  const output = JSON.stringify([response.body, logs.mock.calls.map((call) => call.arguments)]);
  assert.ok(output.includes('PHOTO_STORAGE_PERMISSION_DENIED'));
  assert.ok(!output.includes('private-provider-key-and-signature'));
  assert.ok(!output.includes('never-log-this'));
  await PhotoCleanup.updateMany({}, { $set: { nextAttemptAt: new Date(0) } });
  await drainPhotoCleanup();
});

test('employees can add and delete only their own profile picture', async () => {
  const endpoint = `/api/employees/${employee.person._id}/photo`;
  const uploaded = await as('employee', 'post', endpoint).attach(
    'photo',
    await photoImage(),
    'own.png',
  );
  assert.equal(uploaded.status, 200);
  const savedPhoto = uploaded.body.data.photo;
  assert.deepEqual((await as('employee', 'get', '/api/employees/me')).body.data.photo, savedPhoto);
  const fetched = await as('employee', 'get', endpoint);
  assert.equal(fetched.status, 200);
  assert.match(fetched.headers['cache-control'], /no-store/);
  const countBefore = cloudinaryUploads.length;
  assert.equal(
    (await as('other', 'post', endpoint).attach('photo', await photoImage(), 'forbidden.png'))
      .status,
    403,
  );
  assert.equal((await as('other', 'delete', endpoint)).status, 403);
  assert.equal(cloudinaryUploads.length, countBefore);
  assert.deepEqual((await Employee.findById(employee.person._id)).photo, savedPhoto);
  const deleted = await as('employee', 'delete', endpoint);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.message, 'Profile picture deleted');
  assert.ok(cloudinaryDeletes.includes(savedPhoto.public_id));
  assert.equal((await Employee.findById(employee.person._id)).photo, null);
  assert.equal((await as('employee', 'get', '/api/employees/me')).body.data.photo, null);
  assert.equal(
    (await as('admin', 'get', `/api/employees/${employee.person._id}`)).body.data.photo,
    null,
  );
  assert.equal((await as('employee', 'get', endpoint)).status, 404);
  assert.equal(await PhotoCleanup.countDocuments(), 0);
});

test('photo deletion removes legacy local files as well as database references', async () => {
  const filename = `test-legacy-delete-${randomUUID()}.png`;
  const filePath = path.join(root, 'server/uploads', filename);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, await photoImage());
  try {
    await Employee.updateOne({ _id: employee.person._id }, { $set: { photo: filename } });
    const deleted = await as('employee', 'delete', `/api/employees/${employee.person._id}/photo`);
    assert.equal(deleted.status, 200);
    await assert.rejects(fs.access(filePath), { code: 'ENOENT' });
    assert.equal((await Employee.findById(employee.person._id)).photo, null);
    assert.equal(await PhotoCleanup.countDocuments(), 0);
  } finally {
    await fs.unlink(filePath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
});

test('settings preserve historical calendars and role changes revoke sessions', async () => {
  assert.equal((await as('admin', 'put', '/api/settings').send({ weekends: [5, 6] })).status, 409);
  assert.equal(
    (await as('admin', 'put', '/api/settings').send({ officeStart: '18:00', officeEnd: '09:00' }))
      .status,
    400,
  );
  assert.equal(
    (
      await as('admin', 'put', '/api/settings').send({
        holidays: [{ date: '2024-01-01', name: 'Retroactive' }],
      })
    ).status,
    409,
  );
  assert.equal(
    (await as('admin', 'patch', `/api/users/${other.user._id}`).send({ role: 'HR' })).status,
    200,
  );
  assert.equal((await as('other', 'get', '/api/auth/me')).status, 401);
  assert.equal(
    (await as('admin', 'patch', `/api/users/${admin.user._id}`).send({ role: 'Employee' })).status,
    403,
  );
  assert.equal((await as('hr', 'delete', `/api/employees/${admin.person._id}`)).status, 403);
  assert.ok((await AuditLog.countDocuments({ action: 'payroll.generated' })) > 0);
  assert.equal((await as('admin', 'get', '/api/audit')).status, 200);
});
test('logout invalidates copied session tokens', async () => {
  assert.equal((await as('employee', 'post', '/api/auth/logout')).status, 200);
  assert.equal((await as('employee', 'get', '/api/auth/me')).status, 401);
});
test('employment dates can change after the last payroll without rewriting paid periods', async () => {
  const payload = {
    name: employee.person.name,
    email: employee.person.email,
    joiningDate: employee.person.joiningDate,
    salary: 30000,
    status: 'Terminated',
    endDate: today(config),
  };
  const response = await as('admin', 'put', `/api/employees/${employee.person._id}`).send(payload);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal((await User.findById(employee.user._id)).active, false);
  const invalid = await as('admin', 'put', `/api/employees/${employee.person._id}`).send({
    ...payload,
    endDate: firstDay,
  });
  assert.equal(invalid.status, 409);
});
test('date filtering and invalid employment dates are validated', async () => {
  const records = await as(
    'admin',
    'get',
    `/api/attendance?startDate=${firstDay}&endDate=${firstDay}&employee=${employee.person._id}`,
  );
  assert.equal(records.status, 200);
  assert.equal(records.body.data.total, 1);
  assert.equal(records.body.data.items[0].date, firstDay);
  assert.equal(
    (await as('admin', 'get', `/api/audit?startDate=${thirdDay}&endDate=${firstDay}`)).status,
    400,
  );
  assert.equal(
    (
      await as('admin', 'put', `/api/employees/${other.person._id}`).send({
        name: other.person.name,
        email: other.person.email,
        joiningDate: '2024-01-01',
        salary: 30000,
        status: 'Inactive',
        endDate: '2026-02-30',
      })
    ).status,
    400,
  );
});
