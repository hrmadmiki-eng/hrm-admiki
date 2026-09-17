import bcrypt from 'bcryptjs';
import { User, Settings, AuditLog, Attendance, Payroll, Leave, Employee } from '../models/index.js';
import { AppError, ok, pick, pagination, escapeRegex } from '../utils/http.js';
import { audit, transaction, lockSettings, lockEmployee, settings } from '../services/core.js';
import { today, dayjs } from '../utils/dates.js';
import { validatePassword } from '../utils/password.js';
import { activityLabels } from '../../shared/language.mjs';
export async function users(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const filter = {};
  if (req.query.search)
    filter.$or = [
      { name: new RegExp(escapeRegex(req.query.search), 'i') },
      { email: new RegExp(escapeRegex(req.query.search), 'i') },
    ];
  const [items, total] = await Promise.all([
    User.find(filter)
      .populate('employee', 'employeeId deleted status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    User.countDocuments(filter),
  ]);
  ok(res, { items, total, page, pages: Math.ceil(total / limit) });
}
export async function updateUser(req, res) {
  const password = req.body.password
    ? await bcrypt.hash(req.body.password, Number(process.env.BCRYPT_SALT_ROUNDS || 10))
    : null;
  const user = await transaction(async (session) => {
    await lockSettings(session);
    const user = await User.findById(req.params.id).select('+tokenVersion').session(session);
    if (!user) throw new AppError(404, 'User not found');
    if (String(user._id) === String(req.user._id))
      throw new AppError(
        403,
        'Use account settings to change your password. Your own role and access cannot be changed here.',
      );
    if (user.employee) {
      const employee = await Employee.findById(user.employee).session(session);
      if (
        (!employee || employee.deleted || employee.status !== 'Active') &&
        req.body.active === true
      )
        throw new AppError(
          409,
          'This person must be on the current team with an active employee profile before they can sign in.',
        );
    }
    Object.assign(user, pick(req.body, ['role', 'active']));
    if (password) {
      validatePassword(req.body.password, user.role);
      user.password = password;
      user.mustChangePassword = true;
    }
    user.tokenVersion++;
    user.passwordReset = undefined;
    await user.save({ session });
    if (!(await User.exists({ role: 'Admin', active: true }).session(session)))
      throw new AppError(409, 'At least one active Admin is required');
    await audit(
      req,
      'user.updated',
      'User',
      user._id,
      {
        role: user.role,
        active: user.active,
        passwordReset: Boolean(password),
      },
      session,
    );
    return user;
  });
  ok(res, user, 'Account updated. This person must sign in again.');
}
export async function getSettings(req, res) {
  ok(res, await settings());
}
export async function publicConfig(req, res) {
  const config = await settings();
  ok(
    res,
    pick(config, [
      'companyName',
      'currency',
      'timezone',
      'officeStart',
      'officeEnd',
      'graceMinutes',
    ]),
  );
}
export async function updateSettings(req, res) {
  const result = await transaction(async (session) => {
    const config = await lockSettings(session);
    const fields = [
      'companyName',
      'email',
      'phone',
      'address',
      'currency',
      'timezone',
      'officeStart',
      'officeEnd',
      'graceMinutes',
      'weekends',
      'holidays',
      'leavePolicy',
    ];
    const next = pick(req.body, fields);
    if ((next.officeEnd || config.officeEnd) <= (next.officeStart || config.officeStart))
      throw new AppError(
        400,
        'Office end must be after office start; overnight shifts are not supported',
      );
    if (
      (next.timezone && next.timezone !== config.timezone) ||
      (next.weekends &&
        JSON.stringify([...next.weekends].sort()) !== JSON.stringify([...config.weekends].sort()))
    ) {
      if (
        (await Attendance.exists({}).session(session)) ||
        (await Payroll.exists({}).session(session)) ||
        (await Leave.exists({
          status: { $in: ['Pending', 'Approved'] },
        }).session(session))
      )
        throw new AppError(
          409,
          'Time zone and weekly days off cannot change after attendance, leave, or pay is saved. Choose these settings before adding records.',
        );
    }
    if (next.holidays) {
      const oldDates = new Set(config.holidays.map((h) => h.date));
      const newDates = new Set(next.holidays.map((h) => h.date));
      if (newDates.size !== next.holidays.length)
        throw new AppError(400, 'The same holiday date cannot be added twice.');
      const changed = [...oldDates, ...newDates].filter((d) => oldDates.has(d) !== newDates.has(d));
      for (const date of changed) {
        if (date < today(config)) throw new AppError(409, 'Past holiday dates cannot be changed');
        if (
          (await Attendance.exists({ date }).session(session)) ||
          (await Leave.exists({
            status: { $in: ['Pending', 'Approved'] },
            startDate: { $lte: date },
            endDate: { $gte: date },
          }).session(session))
        )
          throw new AppError(409, `Holiday ${date} conflicts with attendance or leave`);
      }
    }
    if (next.leavePolicy)
      next.leavePolicy = {
        ...config.leavePolicy.toObject(),
        ...pick(next.leavePolicy, ['Casual', 'Sick', 'Annual']),
      };
    Object.assign(config, next);
    await config.save({ session });
    await audit(
      req,
      'settings.updated',
      'Settings',
      'company',
      { fields: Object.keys(next) },
      session,
    );
    return config;
  });
  ok(res, result, 'Settings saved');
}
export async function auditLogs(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const config = await settings();
  const filter = {};
  if (req.query.search) {
    const search = new RegExp(escapeRegex(req.query.search), 'i');
    const codes = Object.entries(activityLabels)
      .filter(([, label]) => search.test(label))
      .map(([code]) => code);
    filter.$or = [{ action: search }, { action: { $in: codes } }, { actorName: search }];
  }
  if (req.query.startDate || req.query.endDate)
    filter.createdAt = {
      ...(req.query.startDate
        ? { $gte: dayjs.tz(`${req.query.startDate} 00:00`, config.timezone).toDate() }
        : {}),
      ...(req.query.endDate
        ? { $lte: dayjs.tz(`${req.query.endDate} 23:59:59.999`, config.timezone).toDate() }
        : {}),
    };
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    AuditLog.countDocuments(filter),
  ]);
  ok(res, { items, total, page, pages: Math.ceil(total / limit) });
}
