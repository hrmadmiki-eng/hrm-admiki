import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { User, Employee, Settings, Leave, Notification, AuditLog } from '../models/index.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-notification-test-secret-2026';
process.env.CLIENT_URL = 'http://localhost:5173';
const origin = process.env.CLIENT_URL;
let repl, app, users;
const date = `${new Date().getUTCFullYear()}-12-01`;
const payload = { startDate: date, endDate: date, type: 'Casual', reason: 'Private appointment' };
function as(name, method, endpoint) {
  const cookie = jwt.sign({ version: 0 }, process.env.JWT_SECRET, {
    subject: String(users[name]._id),
    issuer: 'admiki-hrms',
    audience: 'admiki-web',
    expiresIn: '1h',
  });
  return request(app)
    [method](`/api${endpoint}`)
    .set('Origin', origin)
    .set('Cookie', `admiki_session=${cookie}`);
}
async function inbox(name, query = '') {
  const response = await as(name, 'get', `/notifications${query}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.match(response.headers['cache-control'], /no-store/);
  return response.body.data;
}
before(
  async () => {
    repl = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      binary: { version: '7.0.24' },
    });
    await mongoose.connect(repl.getUri(), { dbName: 'admiki_notification_tests' });
    for (const Model of Object.values(mongoose.models)) await Model.init();
    app = createApp();
  },
  { timeout: 240000 },
);
beforeEach(async () => {
  for (const Model of [Notification, Leave, AuditLog, Employee, User, Settings])
    await Model.deleteMany({});
  await Settings.create({ weekends: [] });
  users = {};
  for (const [name, role] of Object.entries({
    admin: 'Admin',
    hr: 'HR',
    alice: 'Employee',
    bob: 'Employee',
    inactive: 'HR',
  })) {
    const user = await User.create({
      name,
      email: `${name}@test.example`,
      password: 'unused-test-hash',
      role,
      active: name !== 'inactive',
      mustChangePassword: false,
    });
    const employee = await Employee.create({
      user: user._id,
      employeeId: name,
      name,
      email: user.email,
      joiningDate: '2024-01-01',
      salary: 1000,
    });
    user.employee = employee._id;
    await user.save();
    users[name] = user;
  }
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});

test('submissions notify active reviewers only; review decisions notify only the requester once', async () => {
  const response = await as('alice', 'post', '/leave').send({
    ...payload,
    employee: users.bob.employee,
    recipient: users.bob._id,
  });
  assert.equal(response.status, 201);
  const id = response.body.data._id;
  for (const name of ['admin', 'hr']) {
    const data = await inbox(name);
    assert.equal(data.unreadCount, 1);
    assert.match(data.items[0].message, /alice/);
    assert.equal(data.items[0].href, `/leave/${id}`);
    assert.equal(data.items[0].eventKey, undefined);
    assert.equal(data.items[0].recipient, undefined);
    assert.ok(!data.items[0].message.includes(payload.reason));
  }
  for (const name of ['alice', 'bob']) assert.equal((await inbox(name)).total, 0);
  assert.equal(await Notification.countDocuments({ recipient: users.inactive._id }), 0);
  const decisions = await Promise.all(
    ['admin', 'hr'].map((name) =>
      as(name, 'patch', `/leave/${id}/review`).send({
        status: 'Approved',
        reviewNote: 'Enjoy your leave',
      }),
    ),
  );
  assert.deepEqual(decisions.map((r) => r.status).sort(), [200, 409]);
  const own = await inbox('alice');
  assert.equal(own.total, 1);
  assert.equal(own.items[0].title, 'Leave request approved');
  assert.equal(own.items[0].href, `/leave/${id}`);
  assert.match(own.items[0].message, /Enjoy your leave/);
  assert.equal((await inbox('bob')).total, 0);
  assert.equal((await inbox('admin')).total, 1);
  const rejected = await as('bob', 'post', '/leave').send(payload);
  assert.equal(rejected.status, 201);
  assert.equal(
    (
      await as('hr', 'patch', `/leave/${rejected.body.data._id}/review`).send({
        status: 'Rejected',
      })
    ).status,
    200,
  );
  assert.equal((await inbox('bob')).items[0].title, 'Leave request declined');
  assert.equal((await inbox('alice')).total, 1);
});

test('direct leave links enforce ownership and return current request details', async () => {
  const submitted = await as('alice', 'post', '/leave').send(payload);
  const id = submitted.body.data._id;
  assert.equal((await request(app).get(`/api/leave/${id}`)).status, 401);
  for (const name of ['alice', 'hr', 'admin']) {
    const response = await as(name, 'get', `/leave/${id}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data._id, id);
    assert.equal(response.body.data.reason, payload.reason);
    assert.equal(response.body.data.employee._id, String(users.alice.employee));
  }
  const forbidden = await as(
    'bob',
    'get',
    `/leave/${id}?employee=${users.alice.employee}&role=Admin`,
  );
  assert.equal(forbidden.status, 404);
  assert.equal(forbidden.body.data, null);
  assert.equal((await as('alice', 'get', '/leave/invalid')).status, 400);
  assert.equal((await as('alice', 'get', `/leave/${new mongoose.Types.ObjectId()}`)).status, 404);
  await as('hr', 'patch', `/leave/${id}/review`).send({
    status: 'Rejected',
    reviewNote: 'Try another date',
  });
  const reviewed = await as('alice', 'get', `/leave/${id}`);
  assert.equal(reviewed.body.data.status, 'Rejected');
  assert.equal(reviewed.body.data.reviewNote, 'Try another date');
});

test('forged recipients, guessed IDs, read-all, pagination and unread counts stay private', async () => {
  const notes = await Notification.insertMany(
    ['alice', 'alice', 'bob'].map((name, i) => ({
      recipient: users[name]._id,
      kind: 'announcement',
      title: name,
      message: `Private ${name}`,
      eventKey: `event-${i}`,
    })),
  );
  assert.equal((await request(app).get('/api/notifications')).status, 401);
  const forged = await inbox(
    'bob',
    `?recipient=${users.alice._id}&userId=${users.alice._id}&role=Admin`,
  );
  assert.equal(forged.total, 1);
  assert.equal(forged.unreadCount, 1);
  assert.equal(forged.items[0].title, 'bob');
  for (const name of ['bob', 'admin'])
    assert.equal(
      (
        await as(name, 'patch', `/notifications/${notes[0]._id}/read`).send({
          recipient: users.alice._id,
        })
      ).status,
      404,
    );
  assert.equal((await as('alice', 'patch', '/notifications/invalid/read')).status, 400);
  assert.equal(
    (await as('alice', 'patch', `/notifications/${new mongoose.Types.ObjectId()}/read`)).status,
    404,
  );
  const first = await inbox('alice', '?limit=1');
  const second = await inbox('alice', '?limit=1&page=2');
  assert.equal(first.pages, 2);
  assert.notEqual(first.items[0]._id, second.items[0]._id);
  assert.equal((await as('alice', 'get', '/notifications?limit=1000')).status, 400);
  const endpoint = `/notifications/${notes[0]._id}/read`;
  assert.equal((await as('alice', 'patch', endpoint)).status, 200);
  const readAt = (await Notification.findById(notes[0]._id)).readAt;
  assert.equal((await as('alice', 'patch', endpoint)).status, 200);
  assert.deepEqual((await Notification.findById(notes[0]._id)).readAt, readAt);
  assert.equal((await inbox('alice', '?unread=true')).total, 1);
  assert.equal(
    (await as('alice', 'patch', '/notifications/read-all').send({ recipient: users.bob._id }))
      .status,
    200,
  );
  assert.equal((await inbox('alice')).unreadCount, 0);
  assert.equal((await inbox('bob')).unreadCount, 1);
});

test('announcements require HR/Admin and fan out separate read states to active employees', async () => {
  assert.equal(
    (await as('alice', 'post', '/announcements').send({ title: 'No', message: 'No' })).status,
    403,
  );
  assert.equal(
    (await as('admin', 'post', '/announcements').send({ title: '  ', message: 'No' })).status,
    400,
  );
  for (const name of ['admin', 'hr']) {
    const response = await as(name, 'post', '/announcements').send({
      title: 'Office update',
      message: '<script>plain text</script>',
      recipient: users.admin._id,
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.recipients, 2);
  }
  assert.equal((await inbox('admin')).total, 0);
  assert.equal((await inbox('hr')).total, 0);
  const alice = await inbox('alice');
  const bob = await inbox('bob');
  assert.equal(alice.total, 2);
  assert.equal(bob.total, 2);
  assert.notEqual(alice.items[0]._id, bob.items[0]._id);
  await as('alice', 'patch', '/notifications/read-all');
  assert.equal((await inbox('bob')).unreadCount, 2);
  assert.equal(await AuditLog.countDocuments({ action: 'announcement.published' }), 2);
});

test('demoted reviewers cannot read or update old staff request notifications', async () => {
  await as('alice', 'post', '/leave').send(payload);
  const note = (await inbox('hr')).items[0];
  await User.updateOne({ _id: users.hr._id }, { $set: { role: 'Employee' } });
  assert.equal((await inbox('hr')).total, 0);
  assert.equal((await inbox('hr')).unreadCount, 0);
  assert.equal((await as('hr', 'patch', `/notifications/${note._id}/read`)).status, 404);
  await as('hr', 'patch', '/notifications/read-all');
  assert.equal((await Notification.findById(note._id)).readAt, null);
});

test('notification failures roll back submissions, reviews and announcement fanout', async (t) => {
  const original = Notification.insertMany;
  const mock = t.mock.method(Notification, 'insertMany', async function (...args) {
    await original.apply(this, args);
    throw new Error('Simulated notification storage failure');
  });
  t.mock.method(console, 'error', () => {});
  assert.equal((await as('alice', 'post', '/leave').send(payload)).status, 500);
  assert.equal(await Leave.countDocuments(), 0);
  assert.equal(await Notification.countDocuments(), 0);
  mock.mock.restore();
  const submitted = await as('alice', 'post', '/leave').send(payload);
  t.mock.method(Notification, 'insertMany', async () => {
    throw new Error('Simulated failure');
  });
  assert.equal(
    (
      await as('hr', 'patch', `/leave/${submitted.body.data._id}/review`).send({
        status: 'Approved',
      })
    ).status,
    500,
  );
  assert.equal((await Leave.findById(submitted.body.data._id)).status, 'Pending');
  assert.equal((await inbox('alice')).total, 0);
  assert.equal(
    (await as('admin', 'post', '/announcements').send({ title: 'Failed', message: 'Failed' }))
      .status,
    500,
  );
  assert.equal(await Notification.countDocuments({ kind: 'announcement' }), 0);
  assert.equal(await AuditLog.countDocuments({ action: 'announcement.published' }), 0);
});
