import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { inflateSync } from 'node:zlib';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import {
  User,
  Employee,
  Settings,
  Attendance,
  Leave,
  Payroll,
  AuditLog,
  Counter,
} from '../models/index.js';
import { nextEmployeeId, transaction } from '../services/core.js';
import { calculatePayroll, today } from '../utils/dates.js';
import { normalizeRecords } from '../services/normalize-records.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'hrm-workflow-tests-isolated-secret-2026';
process.env.CLIENT_URL = 'http://localhost:5173';
const password = 'Workflow-test-2026!';
let repl, app, adminCookie, hash, sequence;
const as = (method, url, cookie = adminCookie) =>
  request(app)[method](`/api${url}`).set('Origin', process.env.CLIENT_URL).set('Cookie', cookie);
async function login(user) {
  const res = await request(app)
    .post('/api/auth/login')
    .set('Origin', process.env.CLIENT_URL)
    .send({ email: user.email, password });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers['set-cookie'][0].split(';')[0];
}
async function person(overrides = {}) {
  const n = ++sequence;
  const user = await User.create({
    name: `Person ${n}`,
    email: `person${n}@workflow.test`,
    password: hash,
    mustChangePassword: false,
  });
  const employee = await Employee.create({
    user: user._id,
    name: user.name,
    email: user.email,
    employeeId: `WORK-${n}`,
    joiningDate: '2024-01-01',
    salary: 20000,
    ...overrides,
  });
  user.employee = employee._id;
  await user.save();
  return { user, employee };
}
const payload = (employee, changes = {}) => ({
  name: employee.name,
  email: employee.email,
  joiningDate: employee.joiningDate,
  salary: employee.salary,
  status: employee.status,
  ...changes,
});
async function excel(url) {
  const res = await as('get', url)
    .buffer(true)
    .parse((res, done) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
  assert.equal(res.status, 200, res.body.toString());
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(res.body);
  return book.worksheets[0];
}
before(
  async () => {
    hash = await bcrypt.hash(password, 10);
    repl = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: '7.0.24' },
    });
    await mongoose.connect(repl.getUri(), { dbName: 'hrm_workflow_tests' });
    for (const Model of Object.values(mongoose.models)) await Model.init();
    app = createApp();
  },
  { timeout: 120000 },
);
beforeEach(async () => {
  for (const Model of Object.values(mongoose.models)) await Model.deleteMany({});
  sequence = 0;
  await Settings.create({
    _id: 'company',
    weekends: [5, 6],
    holidays: [{ date: '2024-02-21', name: 'Holiday' }],
    leavePolicy: { Casual: 1, Sick: 9, Annual: 18 },
  });
  const admin = await User.create({
    name: 'Admin',
    email: 'admin@workflow.test',
    password: hash,
    role: 'Admin',
    mustChangePassword: false,
  });
  adminCookie = await login(admin);
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});

test('employee lifecycle synchronizes identity, protects access and retains history', async () => {
  const { user, employee } = await person();
  const cookie = await login(user);
  const edited = await as('put', `/employees/${employee._id}`).send(
    payload(employee, { name: 'Updated Person', email: 'updated@workflow.test', salary: 25000 }),
  );
  assert.equal(edited.status, 200);
  assert.equal((await as('get', '/auth/me', cookie)).body.data.name, 'Updated Person');
  assert.equal((await User.findById(user._id)).email, 'updated@workflow.test');
  const ended = await as('put', `/employees/${employee._id}`).send(
    payload(employee, { status: 'Inactive', endDate: '2024-02-29' }),
  );
  assert.equal(ended.status, 200);
  assert.equal((await as('get', '/auth/me', cookie)).status, 401);
  assert.equal((await as('patch', `/users/${user._id}`).send({ active: true })).status, 409);
  assert.equal(
    (await as('put', `/employees/${employee._id}`).send(payload(employee, { status: 'Active' })))
      .status,
    200,
  );
  assert.equal((await as('patch', `/users/${user._id}`).send({ active: true })).status, 200);
  assert.equal((await Employee.findById(employee._id)).endDate, undefined);
  assert.equal((await as('delete', `/employees/${employee._id}`)).status, 200);
  assert.equal((await as('get', '/employees')).body.data.total, 0);
  assert.equal((await User.findById(user._id)).active, false);
});

test('catalog CRUD enforces unique names, department assignment and referenced deletion', async () => {
  const department = (await as('post', '/departments').send({ name: 'Engineering' })).body.data;
  assert.equal((await as('post', '/departments').send({ name: 'engineering' })).status, 409);
  const second = (await as('post', '/departments').send({ name: 'Operations' })).body.data;
  const designation = (
    await as('post', '/designations').send({ name: 'Engineer', department: department._id })
  ).body.data;
  const { employee } = await person({ department: department._id, designation: designation._id });
  assert.equal(
    (
      await as('put', `/employees/${employee._id}`).send(
        payload(employee, { department: second._id, designation: designation._id }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await as('put', `/designations/${designation._id}`).send({
        name: 'Engineer',
        department: second._id,
      })
    ).status,
    409,
  );
  assert.equal((await as('delete', `/departments/${department._id}`)).status, 409);
  assert.equal(
    (await as('put', `/departments/${department._id}`).send({ name: 'Product Engineering' }))
      .status,
    200,
  );
  assert.equal(
    (await as('get', `/employees/${employee._id}`)).body.data.department.name,
    'Product Engineering',
  );
  assert.equal(
    (
      await as('put', `/employees/${employee._id}`).send(
        payload(employee, { department: null, designation: null }),
      )
    ).status,
    200,
  );
  assert.equal((await as('delete', `/designations/${designation._id}`)).status, 200);
  assert.equal((await as('delete', `/departments/${department._id}`)).status, 200);
});

test('simultaneous employee creation assigns unique IDs and linked accounts', async () => {
  const responses = await Promise.all(
    [1, 2, 3].map((n) =>
      as('post', '/employees').send({
        name: `New ${n}`,
        email: `new${n}@workflow.test`,
        salary: 15000,
        joiningDate: '2024-01-01',
        password,
      }),
    ),
  );
  responses.forEach((res) => assert.equal(res.status, 201, JSON.stringify(res.body)));
  assert.equal(new Set(responses.map((res) => res.body.data.employeeId)).size, 3);
  for (const res of responses)
    assert.equal(String((await User.findById(res.body.data.user)).employee), res.body.data._id);
});

test('attendance, leave, partial employment, payroll, payment and exports reconcile end to end', async () => {
  const { user, employee } = await person({ joiningDate: '2024-02-11' });
  const cookie = await login(user);
  for (const [date, status, checkIn] of [
    ['2024-02-11', 'Present', '09:00'],
    ['2024-02-12', 'Late', '10:00'],
  ]) {
    assert.equal(
      (
        await as('put', '/attendance/manual').send({
          employee: employee._id,
          date,
          status,
          checkIn,
          checkOut: '18:00',
        })
      ).status,
      200,
    );
  }
  const leave = await as('post', '/leave', cookie).send({
    startDate: '2024-02-13',
    endDate: '2024-02-14',
    type: 'Casual',
    reason: 'Personal appointment',
  });
  assert.equal(leave.status, 201);
  assert.equal(
    (await as('post', '/payroll/generate').send({ employee: employee._id, month: '2024-02' }))
      .status,
    409,
  );
  assert.equal(
    (await as('patch', `/leave/${leave.body.data._id}/review`).send({ status: 'Approved' })).status,
    200,
  );
  assert.equal(
    (
      await as('put', `/employees/${employee._id}`).send(
        payload(employee, { status: 'Terminated', endDate: '2024-02-22' }),
      )
    ).status,
    200,
  );
  const generated = await as('post', '/payroll/generate').send({
    employee: employee._id,
    month: '2024-02',
    allowance: 1000,
    bonus: 500,
    deduction: 200,
  });
  assert.equal(generated.status, 200, JSON.stringify(generated.body));
  const record = await Payroll.findOne({ employee: employee._id });
  for (const [key, expected] of Object.entries({
    workingDays: 20,
    eligibleDays: 9,
    presentDays: 2,
    paidDays: 1,
    unpaidDays: 1,
    absentDays: 5,
    basic: 9000,
    attendanceDeduction: 6000,
    netSalary: 4300,
  }))
    assert.equal(record[key], expected, key);
  assert.equal(
    (
      await as('put', '/attendance/manual').send({
        employee: employee._id,
        date: '2024-02-15',
        status: 'Present',
        checkIn: '09:00',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await as('post', '/payroll/generate').send({
        employee: employee._id,
        month: '2024-02',
        bonus: 999,
      })
    ).body.data.skipped,
    1,
  );
  assert.equal((await as('patch', `/payroll/${record._id}/paid`)).status, 200);
  assert.equal((await as('patch', `/payroll/${record._id}/paid`)).status, 409);
  const report = await excel(
    `/reports/payroll?month=2024-02&employee=${employee._id}&format=excel`,
  );
  assert.equal(report.getCell('H2').value, 4300);
  assert.equal(report.getCell('J2').value, 'Paid');
  const slip = await excel(`/payroll/${record._id}/payslip?format=excel`);
  assert.equal(slip.getCell('B12').value, 4300);
  assert.equal(slip.lastRow.getCell(1).value, 'Currency');
  assert.equal(slip.lastRow.getCell(2).value, 'BDT');
  const attendance = await excel(
    `/reports/attendance?month=2024-02&employee=${employee._id}&format=excel`,
  );
  assert.equal(attendance.rowCount, 13);
  assert.equal(attendance.getCell('D4').value, 'Paid leave');
  assert.equal(attendance.getCell('D5').value, 'Unpaid leave');
  assert.equal(await AuditLog.countDocuments({ action: 'payroll.marked_paid' }), 1);
});

test('payroll net equals its rounded displayed components', () => {
  const result = calculatePayroll({
    salary: 1000,
    allowance: 0.005,
    bonus: 0.005,
    deduction: 0,
    workingDays: 20,
    eligibleDays: 20,
    absentDays: 0,
    unpaidDays: 0,
  });
  assert.equal(result.netSalary, 1000.02);
});

test('payroll list and report both give month precedence over explicit date ranges', async () => {
  const { employee } = await person();
  await as('post', '/payroll/generate').send({ employee: employee._id, month: '2024-02' });
  const query = `month=2024-02&startDate=2024-03-01&endDate=2024-03-31&employee=${employee._id}`;
  assert.equal((await as('get', `/payroll?${query}`)).body.data.total, 1);
  assert.equal((await excel(`/reports/payroll?${query}&format=excel`)).rowCount, 2);
});

test('attendance report accepts a historical end date without a start date', async () => {
  const { employee } = await person();
  const sheet = await excel(
    `/reports/attendance?endDate=2024-02-15&employee=${employee._id}&format=excel`,
  );
  assert.equal(sheet.rowCount, 16);
  assert.equal(sheet.getCell('C2').value, '2024-02-01');
});

test('archival refuses unresolved leave instead of making it unreviewable', async () => {
  const { employee } = await person();
  await Leave.create({
    employee: employee._id,
    startDate: '2024-02-11',
    endDate: '2024-02-11',
    type: 'Casual',
    reason: 'Pending review',
    workDates: ['2024-02-11'],
  });
  const result = await as('delete', `/employees/${employee._id}`);
  assert.equal(result.status, 409);
  assert.equal((await Employee.findById(employee._id)).deleted, false);
});

test('archived employees remain eligible for outstanding historical payroll and filters', async () => {
  const { employee } = await person({ status: 'Terminated', endDate: '2024-02-29' });
  assert.equal((await as('delete', `/employees/${employee._id}`)).status, 200);
  const generated = await as('post', '/payroll/generate').send({
    employee: employee._id,
    month: '2024-02',
  });
  assert.equal(generated.status, 200, JSON.stringify(generated.body));
  assert.equal(generated.body.data.created, 1);
  const listed = await as('get', '/employees?includeArchived=true');
  assert.equal(listed.body.data.total, 1);
  assert.equal(listed.body.data.items[0].deleted, true);
  assert.equal((await as('get', '/employees')).body.data.total, 0);
});

test('partial leave policy updates preserve other leave allowances', async () => {
  const updated = await as('put', '/settings').send({ leavePolicy: { Casual: 3 } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.leavePolicy.Sick, 9);
  assert.equal(updated.body.data.leavePolicy.Annual, 18);
});

test('audit date filters use the same company calendar as displayed events', async () => {
  await AuditLog.create({ action: 'test.local_date', createdAt: new Date('2024-02-10T19:00:00Z') });
  const res = await as(
    'get',
    '/audit?startDate=2024-02-11&endDate=2024-02-11&search=test.local_date',
  );
  assert.equal(res.body.data.total, 1);
});

test('migration normalizes historical payroll to BDT and dashboard totals match payroll', async () => {
  const { employee: first } = await person();
  const { employee: second } = await person();
  const month = today(await Settings.findById('company')).slice(0, 7);
  for (const [employee, currency, netSalary] of [
    [first, 'BDT', 1000],
    [second, 'USD', 20],
  ])
    await Payroll.create({
      employee: employee._id,
      employeeName: employee.name,
      employeeCode: employee.employeeId,
      month,
      currency,
      netSalary,
    });
  await normalizeRecords();
  const bdt = (await as('get', '/dashboard')).body.data;
  assert.equal(bdt.lastPayroll.total, 1020);
  assert.equal(bdt.payrollCurrency, 'BDT');
  assert.equal((await as('get', '/dashboard?currency=USD')).status, 400);
  for (const summary of [bdt]) {
    const response = await as(
      'get',
      `/payroll?month=${summary.lastPayroll._id}&currency=${summary.payrollCurrency}`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.data.total, summary.lastPayroll.count);
    assert.equal(
      response.body.data.items.reduce((sum, row) => sum + row.netSalary, 0),
      summary.lastPayroll.total,
    );
  }
  assert.equal((await as('get', '/payroll?currency=invalid')).status, 400);
});

test('employee IDs start at 1001, migrate archived staff and snapshots, and stay unique across retries', async () => {
  const first = await person({ employeeId: 'ADM-00001' });
  const archived = await person({ employeeId: 'ADM-00002', deleted: true });
  await Payroll.create({
    employee: archived.employee._id,
    employeeName: archived.employee.name,
    employeeCode: 'ADM-00002',
    month: '2024-02',
    currency: 'BDT',
    netSalary: 300,
  });
  await Counter.create({ _id: 'employee', value: 2 });
  const result = await normalizeRecords();
  assert.equal(result.employeeIdsUpdated, 2);
  assert.equal((await Employee.findById(first.employee._id)).employeeId, '1001');
  assert.equal((await Employee.findById(archived.employee._id)).employeeId, '1002');
  const snapshot = await Payroll.findOne({ employee: archived.employee._id });
  assert.equal(snapshot.employeeCode, '1002');
  assert.equal(snapshot.netSalary, 300);
  assert.equal((await normalizeRecords()).employeeIdsUpdated, 0);
  const ids = await Promise.all(
    Array.from({ length: 3 }, () => transaction((session) => nextEmployeeId(session))),
  );
  assert.deepEqual(ids.sort(), ['1003', '1004', '1005']);
  await assert.rejects(
    transaction(async (session) => {
      await nextEmployeeId(session);
      throw new Error('rollback');
    }),
  );
  assert.equal(await transaction((session) => nextEmployeeId(session)), '1006');
});

test('empty databases and existing numeric IDs share the same employee counter', async () => {
  assert.equal(await transaction((session) => nextEmployeeId(session)), '1001');
  await person({ employeeId: '1200' });
  await person({ employeeId: 'ADM-00002' });
  await normalizeRecords();
  assert.equal(await transaction((session) => nextEmployeeId(session)), '1202');
});

test('long valid employee emails follow the same limit as login accounts', async () => {
  const email = `${'a'.repeat(60)}@${'b'.repeat(55)}.${'c'.repeat(40)}.com`;
  const res = await as('post', '/employees').send({
    name: 'Long Email',
    email,
    salary: 1000,
    joiningDate: '2024-01-01',
    password,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await User.findById(res.body.data.user)).email, email);
});

test('valid high payroll adjustments do not exceed an unrelated single-component limit', async () => {
  const { employee } = await person();
  const res = await as('post', '/payroll/generate').send({
    employee: employee._id,
    month: '2024-02',
    allowance: 100000000,
    bonus: 100000000,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await Payroll.findOne({ employee: employee._id })).netSalary, 200000000);
});

test('inactive employee leave still appears in the dashboard review queue', async () => {
  const { employee } = await person({ status: 'Inactive', endDate: '2024-02-29' });
  await Leave.create({
    employee: employee._id,
    startDate: '2024-02-11',
    endDate: '2024-02-11',
    type: 'Casual',
    reason: 'Awaiting decision',
    workDates: ['2024-02-11'],
  });
  const res = await as('get', '/dashboard');
  assert.equal(res.body.data.pendingLeave, 1);
  assert.equal(res.body.data.recentLeave[0].employee._id, String(employee._id));
});

test('legacy archived pending leave can be rejected, and cannot be approved past employment', async () => {
  const { employee } = await person({ deleted: true, status: 'Terminated', endDate: '2024-02-10' });
  const leave = await Leave.create({
    employee: employee._id,
    startDate: '2024-02-11',
    endDate: '2024-02-11',
    type: 'Casual',
    reason: 'Legacy request',
    workDates: ['2024-02-11'],
  });
  assert.equal(
    (await as('patch', `/leave/${leave._id}/review`).send({ status: 'Approved' })).status,
    409,
  );
  assert.equal(
    (await as('patch', `/leave/${leave._id}/review`).send({ status: 'Rejected' })).status,
    200,
  );
});

test('historical archived attendance can be corrected until payroll locks it', async () => {
  const { employee } = await person({ deleted: true, status: 'Terminated', endDate: '2024-02-29' });
  const entry = {
    employee: employee._id,
    date: '2024-02-11',
    status: 'Present',
    checkIn: '09:00',
    checkOut: '18:00',
  };
  assert.equal((await as('put', '/attendance/manual').send(entry)).status, 200);
  assert.equal(
    (await as('post', '/payroll/generate').send({ employee: employee._id, month: '2024-02' }))
      .status,
    200,
  );
  assert.equal((await Payroll.findOne({ employee: employee._id })).netSalary, 1000);
  assert.equal((await as('put', '/attendance/manual').send(entry)).status, 409);
  assert.equal(
    (await as('put', '/attendance/manual').send({ ...entry, date: '2024-03-03' })).status,
    400,
  );
});

test('archive protects approved future leave and leaves account state unchanged on failure', async () => {
  const { user, employee } = await person();
  const date = `${Number(today(await Settings.findById('company')).slice(0, 4)) + 1}-02-01`;
  await Leave.create({
    employee: employee._id,
    startDate: date,
    endDate: date,
    type: 'Annual',
    reason: 'Future approval',
    status: 'Approved',
    workDates: [date],
    paidDates: [date],
  });
  assert.equal((await as('delete', `/employees/${employee._id}`)).status, 409);
  assert.equal((await Employee.findById(employee._id)).deleted, false);
  assert.equal((await User.findById(user._id)).active, true);
});

test('report PDF preserves lowercase admiki branding and renders repeated headers across pages', async () => {
  const { employee } = await person();
  const res = await as(
    'get',
    `/reports/attendance?month=2024-02&employee=${employee._id}&format=pdf`,
  )
    .buffer(true)
    .parse((stream, done) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => done(null, Buffer.concat(chunks)));
    });
  assert.equal(res.status, 200);
  const raw = res.body.toString('latin1');
  const text = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map((match) => {
      const stream = inflateSync(Buffer.from(match[1], 'latin1')).toString();
      return [...stream.matchAll(/<([a-f\d]+)>/gi)]
        .map((hex) => Buffer.from(hex[1], 'hex').toString('latin1'))
        .join('');
    })
    .join('\n');
  assert.ok(text.includes('admiki'));
  assert.ok(!text.includes('Admiki'));
  assert.ok((text.match(/attendance report/g) || []).length >= 2);
  assert.ok(text.includes('Page 1 of 2'));
  assert.ok(text.includes('Page 2 of 2'));
});

test('empty and formula-like report values produce safe readable spreadsheets', async () => {
  const { employee } = await person({ name: '=SUM(A1:A2)' });
  const report = await excel(`/reports/employees?employee=${employee._id}&format=excel`);
  assert.equal(report.getCell('B2').value, "'=SUM(A1:A2)");
  const empty = await excel(`/reports/leave?employee=${employee._id}&format=excel`);
  assert.equal(empty.rowCount, 1);
  assert.equal((await as('get', '/reports/missing')).status, 404);
  assert.equal((await as('get', '/reports/employees?format=csv')).status, 400);
});

test('HR cannot redirect an Admin login or password recovery through employee editing', async () => {
  const { user: manager } = await person();
  manager.role = 'HR';
  await manager.save();
  const cookie = await login(manager);
  const { user, employee } = await person();
  user.role = 'Admin';
  await user.save();
  const res = await as('put', `/employees/${employee._id}`, cookie).send(
    payload(employee, { email: 'redirected@workflow.test' }),
  );
  assert.equal(res.status, 403);
  assert.equal((await User.findById(user._id)).email, user.email);
  assert.equal((await Employee.findById(employee._id)).email, employee.email);
});

test('concurrent payroll generation creates one snapshot and concurrent paid requests one payment', async () => {
  const { employee } = await person();
  const generated = await Promise.all(
    [1, 2].map(() =>
      as('post', '/payroll/generate').send({ employee: employee._id, month: '2024-02' }),
    ),
  );
  generated.forEach((res) => assert.equal(res.status, 200));
  assert.equal(
    generated.reduce((sum, res) => sum + res.body.data.created, 0),
    1,
  );
  const record = await Payroll.findOne({ employee: employee._id });
  const paid = await Promise.all([1, 2].map(() => as('patch', `/payroll/${record._id}/paid`)));
  assert.deepEqual(paid.map((res) => res.status).sort(), [200, 409]);
  assert.equal(await AuditLog.countDocuments({ action: 'payroll.marked_paid' }), 1);
});

test('competing leave approvals cannot spend the same remaining paid day twice', async () => {
  const { employee } = await person();
  const leaves = await Leave.create(
    ['2024-02-11', '2024-02-12'].map((date) => ({
      employee: employee._id,
      startDate: date,
      endDate: date,
      type: 'Casual',
      reason: 'Concurrent approvals',
      workDates: [date],
    })),
  );
  const results = await Promise.all(
    leaves.map((leave) => as('patch', `/leave/${leave._id}/review`).send({ status: 'Approved' })),
  );
  results.forEach((res) => assert.equal(res.status, 200));
  assert.equal(
    results.reduce((sum, res) => sum + res.body.data.paidDates.length, 0),
    1,
  );
});

test('employee search, status filters, exact selection and pagination return consistent totals', async () => {
  const { employee: first } = await person({ name: 'Employee [A]' });
  await person({ name: 'Employee B' });
  await person({ name: 'Former Employee', status: 'Terminated', endDate: '2024-02-29' });
  const pages = await Promise.all(
    [1, 2].map((page) => as('get', `/employees?status=Active&limit=1&page=${page}`)),
  );
  pages.forEach((res) => {
    assert.equal(res.body.data.total, 2);
    assert.equal(res.body.data.pages, 2);
    assert.equal(res.body.data.items.length, 1);
  });
  assert.notEqual(pages[0].body.data.items[0]._id, pages[1].body.data.items[0]._id);
  const search = await as('get', '/employees?search=%5BA%5D');
  assert.equal(search.body.data.total, 1);
  assert.equal(search.body.data.items[0]._id, String(first._id));
  assert.equal((await as('get', `/employees?employee=${first._id}`)).body.data.total, 1);
  assert.equal((await as('get', '/employees?limit=101')).status, 400);
  assert.equal((await as('get', '/employees?includeArchived=invalid')).status, 400);
});

test('manager dashboard drill-downs match daily populations, pagination and pending requests', async () => {
  await Settings.updateOne({ _id: 'company' }, { $set: { weekends: [], holidays: [] } });
  const config = await Settings.findById('company');
  const date = today(config);
  const present = await person();
  const late = await person();
  const absent = await person();
  const missing = await person();
  const onLeave = await person();
  const inactive = await person({ status: 'Inactive' });
  const archived = await person({ deleted: true });
  await person({ joiningDate: '2099-01-01' });
  for (const [person, status] of [
    [present, 'Present'],
    [late, 'Late'],
    [absent, 'Absent'],
    [inactive, 'Present'],
    [archived, 'Present'],
  ])
    await Attendance.create({ employee: person.employee._id, date, status });
  const leave = (employee, status, workDates = [date]) =>
    Leave.create({
      employee: employee._id,
      type: 'Casual',
      startDate: date,
      endDate: date,
      workDates,
      status,
      reason: 'Dashboard coverage',
    });
  await leave(onLeave.employee, 'Approved');
  await leave(onLeave.employee, 'Approved'); // Count employees once, even with duplicate legacy leave.
  await leave(missing.employee, 'Approved', []); // Date overlap alone is not a working leave day.
  await leave(inactive.employee, 'Pending');
  await leave(archived.employee, 'Pending');
  const hr = await person();
  await User.updateOne({ _id: hr.user._id }, { $set: { role: 'HR' } });
  const hrCookie = await login(hr.user);
  const employeeCookie = await login(present.user);
  const expected = {
    active: [present, late, absent, missing, onLeave, hr],
    present: [present, late],
    absent: [absent, missing, hr],
    'on-leave': [onLeave],
  };
  const metrics = {
    active: 'totalEmployees',
    present: 'presentToday',
    absent: 'absentToday',
    'on-leave': 'onLeave',
  };
  for (const cookie of [adminCookie, hrCookie]) {
    const dashboard = (await as('get', '/dashboard', cookie)).body.data;
    assert.equal(dashboard.date, date);
    for (const [group, people] of Object.entries(expected)) {
      const url = '/employees?dashboard=' + group + '&date=' + date;
      const response = await as('get', url, cookie);
      assert.equal(response.status, 200);
      assert.equal(response.body.data.total, dashboard[metrics[group]]);
      assert.deepEqual(
        response.body.data.items.map((p) => p._id).sort(),
        people.map((p) => String(p.employee._id)).sort(),
      );
      const paginated = await as('get', url + '&limit=1&page=1', cookie);
      assert.equal(paginated.body.data.total, people.length);
      assert.equal(paginated.body.data.items.length, 1);
    }
    const pending = await as('get', '/leave?status=Pending', cookie);
    assert.equal(pending.body.data.total, dashboard.pendingLeave);
    assert.equal(pending.body.data.total, 2);
  }
  assert.equal(
    (await as('get', '/employees?dashboard=present&date=' + date, employeeCookie)).status,
    403,
  );
  assert.equal((await as('get', '/employees?dashboard=invalid')).status, 400);
  assert.equal((await as('get', '/employees?dashboard=absent&date=2026-02-30')).status, 400);
  const constrained = await as(
    'get',
    '/employees?dashboard=present&date=' + date + '&employee=' + missing.employee._id,
  );
  assert.equal(constrained.body.data.total, 0);
  await Settings.updateOne({ _id: 'company' }, { $set: { holidays: [{ date, name: 'Holiday' }] } });
  assert.equal((await as('get', '/dashboard')).body.data.absentToday, 0);
  assert.equal((await as('get', '/employees?dashboard=absent&date=' + date)).body.data.total, 0);
  await Settings.updateOne(
    { _id: 'company' },
    { $set: { holidays: [], weekends: [0, 1, 2, 3, 4, 5, 6] } },
  );
  assert.equal((await as('get', '/employees?dashboard=absent&date=' + date)).body.data.total, 0);
});
