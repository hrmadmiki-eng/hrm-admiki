import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { root } from '../config/env.js';
import {
  Employee,
  User,
  Department,
  Designation,
  Payroll,
  Attendance,
  Leave,
} from '../models/index.js';
import { AppError, ok, pagination, escapeRegex, pick } from '../utils/http.js';
import {
  transaction,
  audit,
  nextEmployeeId,
  lockEmployee,
  lockSettings,
} from '../services/core.js';
import { ownEmployee } from '../middleware/auth.js';
import { dayjs, datesBetween, today } from '../utils/dates.js';
import { settings } from '../services/core.js';
import { dashboardTeam } from '../services/dashboard-team.js';
import { profilePhotoId, uploadProfilePhoto } from '../services/cloudinary.js';
import {
  PhotoCleanup,
  queuePhotoDeletion,
  processPhotoDeletion,
} from '../services/photo-cleanup.js';
const fields = [
  'name',
  'email',
  'phone',
  'address',
  'department',
  'designation',
  'joiningDate',
  'salary',
  'status',
  'endDate',
];
const cloudinaryPhoto = (photo) =>
  photo && typeof photo === 'object' && photo.url && photo.public_id ? photo : null;
async function assignments(data, session) {
  if (data.department && !(await Department.exists({ _id: data.department }).session(session)))
    throw new AppError(400, 'Department does not exist');
  if (
    data.designation &&
    !(await Designation.exists({
      _id: data.designation,
      department: data.department,
    }).session(session))
  )
    throw new AppError(400, 'Choose a job title from the selected department.');
  if (data.endDate && data.endDate < data.joiningDate)
    throw new AppError(400, 'The last day at work cannot be before the start date.');
  if (data.status !== 'Active' && !data.endDate)
    throw new AppError(400, 'Enter the last day at work for an employee who is no longer active.');
  if (data.status === 'Active') data.endDate = undefined;
}
export async function list(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const filter = req.query.includeArchived === 'true' ? {} : { deleted: false };
  if (req.query.employee) filter._id = req.query.employee;
  if (req.query.department) filter.department = req.query.department;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    const regex = new RegExp(escapeRegex(req.query.search), 'i');
    filter.$or = [{ name: regex }, { email: regex }, { employeeId: regex }];
  }
  if (req.query.dashboard) {
    const config = await settings();
    const { groups } = await dashboardTeam(req.query.date || today(config), config);
    const ids = groups[req.query.dashboard];
    filter._id = {
      $in: req.query.employee ? ids.filter((id) => String(id) === req.query.employee) : ids,
    };
  }
  const [items, total] = await Promise.all([
    Employee.find(filter)
      .populate('department designation')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Employee.countDocuments(filter),
  ]);
  ok(res, { items, total, page, pages: Math.ceil(total / limit) });
}
export async function profile(req, res) {
  const employee = req.params.id
    ? await Employee.findOne({ _id: req.params.id, deleted: false })
    : await ownEmployee(req);
  if (!employee) throw new AppError(404, 'Employee not found');
  await employee.populate('department designation');
  ok(res, employee);
}
export async function create(req, res) {
  const password = await bcrypt.hash(
    req.body.password,
    Number(process.env.BCRYPT_SALT_ROUNDS || 10),
  );
  const employee = await transaction(async (session) => {
    await lockSettings(session);
    const data = pick(req.body, fields);
    data.status ||= 'Active';
    await assignments(data, session);
    const [user] = await User.create(
      [{ name: data.name, email: data.email, password, role: 'Employee' }],
      { session },
    );
    const [employee] = await Employee.create(
      [{ ...data, employeeId: await nextEmployeeId(session), user: user._id }],
      { session },
    );
    user.employee = employee._id;
    user.active = data.status === 'Active';
    await user.save({ session });
    await audit(
      req,
      'employee.created',
      'Employee',
      employee._id,
      { employeeId: employee.employeeId },
      session,
    );
    return employee;
  });
  ok(res, employee, 'Employee and login account created', 201);
}
export async function update(req, res) {
  const employee = await transaction(async (session) => {
    await lockSettings(session);
    const employee = await lockEmployee(req.params.id, session);
    const before = employee.toObject();
    const data = { ...before, ...pick(req.body, fields) };
    await assignments(data, session);
    const user = await User.findById(employee.user).session(session);
    if (req.user.role !== 'Admin' && user.role === 'Admin' && data.email !== before.email)
      throw new AppError(403, 'Only an Admin can change an Admin login email');
    if (data.status !== 'Active') {
      if (user.role === 'Admin' || String(user._id) === String(req.user._id))
        throw new AppError(403, 'Admin accounts and your own account cannot be deactivated here');
    }
    if (
      data.joiningDate !== before.joiningDate ||
      (data.endDate || '') !== (before.endDate || '')
    ) {
      const snapshots = await Payroll.find({ employee: employee._id })
        .select('month')
        .session(session);
      for (const snapshot of snapshots) {
        const start = `${snapshot.month}-01`;
        const end = dayjs.utc(start).endOf('month').format('YYYY-MM-DD');
        const changed = datesBetween(start, end).some((date) => {
          const wasEmployed =
            date >= before.joiningDate && (!before.endDate || date <= before.endDate);
          const willBeEmployed =
            date >= data.joiningDate && (!data.endDate || date <= data.endDate);
          return wasEmployed !== willBeEmployed;
        });
        if (changed)
          throw new AppError(
            409,
            'These work dates affect a month with saved pay and cannot be changed.',
          );
      }
      if (
        await Attendance.exists({
          employee: employee._id,
          $or: [
            { date: { $lt: data.joiningDate } },
            ...(data.endDate ? [{ date: { $gt: data.endDate } }] : []),
          ],
        }).session(session)
      )
        throw new AppError(
          409,
          'These work dates would leave attendance outside the time this person worked here.',
        );
      if (
        await Leave.exists({
          employee: employee._id,
          status: { $in: ['Pending', 'Approved'] },
          $or: [
            { startDate: { $lt: data.joiningDate } },
            ...(data.endDate ? [{ endDate: { $gt: data.endDate } }] : []),
          ],
        }).session(session)
      )
        throw new AppError(
          409,
          'These work dates would leave leave requests outside the time this person worked here.',
        );
    }
    Object.assign(employee, pick(data, fields));
    employee.endDate = data.endDate;
    await employee.save({ session });
    const userUpdate = {
      $set: { name: employee.name, email: employee.email },
      $unset: { passwordReset: 1 },
    };
    if (employee.status !== 'Active') {
      userUpdate.$set.active = false;
      userUpdate.$inc = { tokenVersion: 1 };
    }
    await User.updateOne({ _id: employee.user }, userUpdate, {
      session,
      runValidators: true,
    });
    await audit(
      req,
      'employee.updated',
      'Employee',
      employee._id,
      {
        fields: fields.filter((f) => String(before[f]) !== String(employee[f])),
      },
      session,
    );
    return employee;
  });
  ok(res, employee, 'Employee updated');
}
export async function remove(req, res) {
  const cleanupId = await transaction(async (session) => {
    const config = await lockSettings(session);
    const employee = await lockEmployee(req.params.id, session);
    const user = await User.findById(employee.user).session(session);
    if (user.role === 'Admin' || String(user._id) === String(req.user._id))
      throw new AppError(403, 'You cannot remove an Admin or yourself from the current team.');
    if (await Leave.exists({ employee: employee._id, status: 'Pending' }).session(session))
      throw new AppError(
        409,
        'Decide the waiting leave requests before removing this employee from the current team.',
      );
    const endDate =
      employee.endDate ||
      (today(config) < employee.joiningDate ? employee.joiningDate : today(config));
    if (
      await Leave.exists({
        employee: employee._id,
        status: 'Approved',
        endDate: { $gt: endDate },
      }).session(session)
    )
      throw new AppError(
        409,
        'This person has approved leave after their last day at work. Set a last day that includes their approved leave before removing them.',
      );
    const cleanupId = await queuePhotoDeletion(employee.photo, session);
    employee.photo = undefined;
    employee.markModified('photo');
    employee.deleted = true;
    employee.status = 'Terminated';
    employee.endDate = endDate;
    await employee.save({ session });
    await User.updateOne(
      { _id: user._id },
      { $set: { active: false }, $inc: { tokenVersion: 1 } },
      { session },
    );
    await audit(req, 'employee.archived', 'Employee', employee._id, {}, session);
    return cleanupId;
  });
  await processPhotoDeletion(cleanupId);
  ok(res, null, 'Employee removed from the current team. Past records have been kept.');
}
export async function uploadPhoto(req, res) {
  if (!req.file) throw new AppError(400, 'Select a JPEG, PNG or WebP photo');
  const employee = await Employee.findOne({
    _id: req.params.id,
    deleted: false,
  });
  if (!employee) throw new AppError(404, 'Employee not found');
  let buffer;
  try {
    const input = sharp(req.file.buffer, {
      limitInputPixels: 20000000,
      animated: false,
    });
    const meta = await input.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('format');
    buffer = await input
      .rotate()
      .resize(400, 400, { fit: 'cover' })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new AppError(400, 'Invalid image. Use a JPEG, PNG or WebP under 3 MB.');
  }
  const publicId = profilePhotoId(String(employee._id));
  // Reserve cleanup before contacting Cloudinary, including crashes or ambiguous upload timeouts.
  const stagedCleanup = await queuePhotoDeletion({ public_id: publicId }, undefined, 3600000);
  const uploaded = await uploadProfilePhoto(buffer, String(employee._id), publicId);
  let cleanupId;
  try {
    cleanupId = await transaction(async (session) => {
      const record = await lockEmployee(employee._id, session);
      const previousCleanup = await queuePhotoDeletion(record.photo, session);
      record.photo = uploaded;
      record.markModified('photo');
      await record.save({ session });
      await audit(req, 'employee.photo_updated', 'Employee', record._id, {}, session);
      await PhotoCleanup.deleteOne({ _id: stagedCleanup }, { session });
      return previousCleanup;
    });
  } catch (error) {
    // The durable reservation remains even if the database is unavailable during rollback.
    await PhotoCleanup.updateOne(
      { _id: stagedCleanup },
      { $set: { nextAttemptAt: new Date() } },
    ).catch(() => {});
    await processPhotoDeletion(stagedCleanup);
    throw error;
  }
  await processPhotoDeletion(cleanupId);
  ok(res, { photo: uploaded }, 'Photo updated');
}
export async function removePhoto(req, res) {
  const cleanupId = await transaction(async (session) => {
    const record = await lockEmployee(req.params.id, session);
    if (!record.photo) throw new AppError(404, 'Photo not found');
    const cleanupId = await queuePhotoDeletion(record.photo, session);
    record.photo = null;
    record.markModified('photo');
    await record.save({ session });
    await audit(req, 'employee.photo_deleted', 'Employee', record._id, {}, session);
    return cleanupId;
  });
  const removed = await processPhotoDeletion(cleanupId);
  ok(
    res,
    null,
    removed
      ? 'Profile picture deleted'
      : 'Profile picture removed from the app. Stored image deletion is pending and will retry automatically.',
  );
}
export async function photo(req, res) {
  const employee = await Employee.findOne({
    _id: req.params.id,
    deleted: false,
  });
  if (!employee) throw new AppError(404, 'Employee not found');
  if (req.user.role === 'Employee' && String(employee._id) !== String(req.user.employee))
    throw new AppError(403, 'You can only access your own photo');
  if (!employee.photo) throw new AppError(404, 'Photo not found');
  res.set('Cache-Control', 'private, no-store');
  const remote = cloudinaryPhoto(employee.photo);
  if (remote) {
    let response;
    try {
      response = await fetch(remote.url, { signal: AbortSignal.timeout(10000) });
    } catch {
      throw new AppError(502, 'Photo storage is temporarily unavailable');
    }
    if (!response.ok || !response.body)
      throw new AppError(502, 'Photo storage is temporarily unavailable');
    const contentType = response.headers.get('content-type') || 'image/webp';
    if (!contentType.startsWith('image/'))
      throw new AppError(502, 'Photo storage returned an invalid response');
    res.type(contentType);
    return pipeline(Readable.fromWeb(response.body), res);
  }
  // Preserve reads for legacy records until their next upload or deletion.
  res.sendFile(path.join(root, 'server/uploads', path.basename(employee.photo)));
}
