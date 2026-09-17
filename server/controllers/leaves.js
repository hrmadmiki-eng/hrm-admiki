import { Leave, Attendance } from '../models/index.js';
import { ownEmployee } from '../middleware/auth.js';
import { AppError, ok, pagination, pick } from '../utils/http.js';
import { today, workDates } from '../utils/dates.js';
import {
  transaction,
  lockEmployee,
  lockSettings,
  settings,
  assertMonthOpen,
  audit,
} from '../services/core.js';
import { employeeFilter, dateFilter } from '../services/filters.js';
import { notifyLeaveSubmitted, notifyLeaveReviewed } from '../services/notifications.js';
export async function balances(employee, year, config, session = null) {
  const leaves = await Leave.find({
    employee,
    status: 'Approved',
    startDate: { $gte: `${year}-01-01`, $lte: `${year}-12-31` },
  }).session(session);
  return Object.entries(
    config.leavePolicy.toObject ? config.leavePolicy.toObject() : config.leavePolicy,
  ).map(([type, allowance]) => {
    const used = leaves
      .filter((l) => l.type === type)
      .reduce((sum, l) => sum + l.paidDates.length, 0);
    return { type, allowance, used, remaining: Math.max(0, allowance - used) };
  });
}
export async function balance(req, res) {
  const employee = await ownEmployee(req);
  const config = await settings();
  const year = req.query.year || today(config).slice(0, 4);
  ok(res, { year, balances: await balances(employee._id, year, config) });
}
export async function list(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const filter = { ...(await employeeFilter(req)) };
  const range = dateFilter(req.query).date;
  if (range?.$gte) filter.endDate = { $gte: range.$gte };
  if (range?.$lte) filter.startDate = { $lte: range.$lte };
  if (req.query.status) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    Leave.find(filter)
      .populate('employee', 'name employeeId')
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Leave.countDocuments(filter),
  ]);
  ok(res, { items, total, page, pages: Math.ceil(total / limit) });
}
export async function detail(req, res) {
  const filter = { _id: req.params.id };
  if (req.user.role === 'Employee') {
    if (!req.user.employee) throw new AppError(404, 'Leave request not found');
    filter.employee = req.user.employee;
  }
  const leave = await Leave.findOne(filter)
    .populate('employee', 'name employeeId')
    .populate('reviewedBy', 'name');
  if (!leave) throw new AppError(404, 'Leave request not found');
  ok(res, leave);
}
export async function apply(req, res) {
  const own = await ownEmployee(req);
  const leave = await transaction(async (session) => {
    const config = await lockSettings(session);
    const employee = await lockEmployee(own._id, session);
    const { startDate, endDate, type } = req.body;
    if (employee.status !== 'Active') throw new AppError(403, 'Employee profile is inactive');
    if (startDate > endDate || startDate.slice(0, 4) !== endDate.slice(0, 4))
      throw new AppError(400, 'Choose start and end dates in the same year.');
    if (startDate < employee.joiningDate || (employee.endDate && endDate > employee.endDate))
      throw new AppError(400, 'Leave must fall between the start date and the last day at work.');
    if (Number(startDate.slice(0, 4)) > Number(today(config).slice(0, 4)) + 1)
      throw new AppError(400, 'You can request leave for this year or next year.');
    const dates = workDates(startDate, endDate, config);
    if (!dates.length) throw new AppError(400, 'The selected dates are all days off or holidays.');
    await assertMonthOpen(employee._id, dates, session);
    if (
      await Leave.exists({
        employee: employee._id,
        status: { $in: ['Pending', 'Approved'] },
        startDate: { $lte: endDate },
        endDate: { $gte: startDate },
      }).session(session)
    )
      throw new AppError(409, 'You already requested leave on one or more of these dates.');
    if (
      await Attendance.exists({
        employee: employee._id,
        date: { $in: dates },
        status: { $in: ['Present', 'Late'] },
      }).session(session)
    )
      throw new AppError(409, 'Attendance already records work on one of these dates');
    const [record] = await Leave.create(
      [
        {
          ...pick(req.body, ['startDate', 'endDate', 'type', 'reason']),
          employee: employee._id,
          workDates: dates,
          paidDates: [],
        },
      ],
      { session },
    );
    await audit(req, 'leave.applied', 'Leave', record._id, { startDate, endDate, type }, session);
    await notifyLeaveSubmitted(record, employee, session);
    return record;
  });
  ok(res, leave, 'Leave request submitted', 201);
}
export async function review(req, res) {
  const leave = await transaction(async (session) => {
    const config = await lockSettings(session);
    const record = await Leave.findById(req.params.id).session(session);
    if (!record) throw new AppError(404, 'Leave request not found');
    if (String(record.employee) === String(req.user.employee))
      throw new AppError(403, 'Another HR or Admin must decide your leave request.');
    const employee = await lockEmployee(record.employee, session, { includeArchived: true });
    if (record.status !== 'Pending')
      throw new AppError(409, 'This leave request already has a decision.');
    await assertMonthOpen(record.employee, record.workDates, session);
    if (req.body.status === 'Approved') {
      if (
        record.startDate < employee.joiningDate ||
        (employee.endDate && record.endDate > employee.endDate)
      )
        throw new AppError(409, 'Leave must fall between the start date and the last day at work.');
      record.workDates = workDates(record.startDate, record.endDate, config);
      if (!record.workDates.length)
        throw new AppError(400, 'This request only includes days off or holidays.');
      if (
        await Attendance.exists({
          employee: record.employee,
          date: { $in: record.workDates },
          status: { $in: ['Present', 'Late'] },
        }).session(session)
      )
        throw new AppError(409, 'Attendance shows work on a day in this leave request.');
      const balance = await balances(
        record.employee,
        record.startDate.slice(0, 4),
        config,
        session,
      );
      const available = balance.find((b) => b.type === record.type)?.remaining || 0;
      record.paidDates = record.workDates.slice(0, available);
    }
    record.status = req.body.status;
    record.reviewNote = req.body.reviewNote || '';
    record.reviewedBy = req.user._id;
    record.reviewedAt = new Date();
    await record.save({ session });
    await notifyLeaveReviewed(record, employee, session);
    await audit(
      req,
      `leave.${record.status.toLowerCase()}`,
      'Leave',
      record._id,
      {
        paidDays: record.paidDates.length,
        unpaidDays: record.workDates.length - record.paidDates.length,
      },
      session,
    );
    return record;
  });
  ok(res, leave, 'Leave request reviewed');
}
export async function cancel(req, res) {
  const own = await ownEmployee(req);
  await transaction(async (session) => {
    await lockSettings(session);
    await lockEmployee(own._id, session);
    const leave = await Leave.findOne({
      _id: req.params.id,
      employee: own._id,
    }).session(session);
    if (!leave) throw new AppError(404, 'Leave request not found');
    if (leave.status !== 'Pending')
      throw new AppError(409, 'You can only cancel requests that are still waiting for approval.');
    leave.status = 'Cancelled';
    await leave.save({ session });
    await audit(req, 'leave.cancelled', 'Leave', leave._id, {}, session);
  });
  ok(res, null, 'Leave request cancelled');
}
