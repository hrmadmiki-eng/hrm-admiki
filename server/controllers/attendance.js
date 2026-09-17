import { Attendance, Leave } from '../models/index.js';
import { AppError, ok, pagination, pick } from '../utils/http.js';
import { today, isWorkday, isLate, dayjs } from '../utils/dates.js';
import { ownEmployee } from '../middleware/auth.js';
import {
  transaction,
  lockEmployee,
  lockSettings,
  settings,
  assertMonthOpen,
  audit,
} from '../services/core.js';
import { employeeFilter, dateFilter } from '../services/filters.js';
async function canRecord(employee, date, config, session) {
  if (date > today(config)) throw new AppError(400, 'Attendance cannot be recorded in the future');
  if (date < employee.joiningDate || (employee.endDate && date > employee.endDate))
    throw new AppError(400, 'Date is outside employment dates');
  await assertMonthOpen(employee._id, [date], session);
  if (
    await Leave.exists({
      employee: employee._id,
      status: 'Approved',
      workDates: date,
    }).session(session)
  )
    throw new AppError(409, 'This date has approved leave');
}
export async function list(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const filter = { ...(await employeeFilter(req)), ...dateFilter(req.query) };
  if (req.query.status) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    Attendance.find(filter)
      .populate('employee', 'name employeeId')
      .sort({ date: -1, _id: -1 })
      .skip(skip)
      .limit(limit),
    Attendance.countDocuments(filter),
  ]);
  ok(res, { items, total, page, pages: Math.ceil(total / limit) });
}
export async function current(req, res) {
  const employee = await ownEmployee(req);
  const config = await settings();
  const date = today(config);
  const [attendance, leave] = await Promise.all([
    Attendance.findOne({ employee: employee._id, date }),
    Leave.findOne({
      employee: employee._id,
      status: 'Approved',
      workDates: date,
    }),
  ]);
  ok(res, {
    attendance,
    date,
    isWorkday: isWorkday(date, config),
    onLeave: Boolean(leave),
    timezone: config.timezone,
    officeStart: config.officeStart,
    officeEnd: config.officeEnd,
  });
}
export async function checkIn(req, res) {
  const own = await ownEmployee(req);
  const attendance = await transaction(async (session) => {
    const config = await lockSettings(session);
    const employee = await lockEmployee(own._id, session);
    const date = today(config);
    if (employee.status !== 'Active') throw new AppError(403, 'Your employee profile is inactive');
    await canRecord(employee, date, config, session);
    if (!isWorkday(date, config)) throw new AppError(400, 'Today is a weekend or holiday');
    if (await Attendance.exists({ employee: employee._id, date }).session(session))
      throw new AppError(409, 'Attendance already recorded for today');
    const now = new Date();
    const [record] = await Attendance.create(
      [
        {
          employee: employee._id,
          date,
          checkIn: now,
          status: isLate(now, date, config) ? 'Late' : 'Present',
          updatedBy: req.user._id,
        },
      ],
      { session },
    );
    await audit(req, 'attendance.check_in', 'Attendance', record._id, { date }, session);
    return record;
  });
  ok(res, attendance, 'Checked in');
}
export async function checkOut(req, res) {
  const own = await ownEmployee(req);
  const attendance = await transaction(async (session) => {
    const config = await lockSettings(session);
    const employee = await lockEmployee(own._id, session);
    const date = today(config);
    await assertMonthOpen(employee._id, [date], session);
    const record = await Attendance.findOne({
      employee: employee._id,
      date,
    }).session(session);
    if (!record?.checkIn || !['Present', 'Late'].includes(record.status))
      throw new AppError(400, 'Check in before checking out');
    if (record.checkOut) throw new AppError(409, 'Already checked out today');
    record.checkOut = new Date();
    await record.save({ session });
    await audit(req, 'attendance.check_out', 'Attendance', record._id, { date }, session);
    return record;
  });
  ok(res, attendance, 'Checked out');
}
export async function manual(req, res) {
  const attendance = await transaction(async (session) => {
    const config = await lockSettings(session);
    const employee = await lockEmployee(req.body.employee, session, { includeArchived: true });
    const { date, status } = req.body;
    await canRecord(employee, date, config, session);
    if (status === 'Holiday' && isWorkday(date, config))
      throw new AppError(400, 'Configure this date as a holiday in Settings first');
    if (status !== 'Holiday' && !isWorkday(date, config))
      throw new AppError(400, 'This date is a weekly day off or a holiday.');
    let checkIn = null;
    let checkOut = null;
    if (['Present', 'Late'].includes(status)) {
      if (!req.body.checkIn) throw new AppError(400, 'A check-in time is required');
      checkIn = dayjs
        .tz(`${date} ${req.body.checkIn}`, 'YYYY-MM-DD HH:mm', config.timezone)
        .toDate();
      if (req.body.checkOut)
        checkOut = dayjs
          .tz(`${date} ${req.body.checkOut}`, 'YYYY-MM-DD HH:mm', config.timezone)
          .toDate();
      if (checkIn > new Date() || (checkOut && checkOut > new Date()))
        throw new AppError(400, 'Attendance times cannot be in the future');
      if (checkOut && checkOut <= checkIn)
        throw new AppError(400, 'Check-out must be after check-in');
    }
    const record = await Attendance.findOneAndUpdate(
      { employee: employee._id, date },
      {
        $set: {
          ...pick(req.body, ['status', 'notes']),
          checkIn,
          checkOut,
          source: 'Manual',
          updatedBy: req.user._id,
        },
      },
      { session, new: true, upsert: true, runValidators: true },
    );
    await audit(
      req,
      'attendance.manual_entry',
      'Attendance',
      record._id,
      { date, status, employee: employee.employeeId },
      session,
    );
    return record;
  });
  ok(res, attendance, 'Attendance saved');
}
