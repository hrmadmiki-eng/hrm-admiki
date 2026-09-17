import { Employee, Attendance, Leave, Payroll } from '../models/index.js';
import { settings, audit } from '../services/core.js';
import { employeeFilter, dateFilter } from '../services/filters.js';
import { exportFile } from '../services/exports.js';
import { AppError } from '../utils/http.js';
import { dayjs, today, datesBetween, isWorkday } from '../utils/dates.js';
import { leaveTypeLabel, statusLabel } from '../../shared/language.mjs';
const columns = (labels) => labels.map(([key, label]) => ({ key, label }));
export async function report(req, res) {
  const config = await settings();
  const { type } = req.params;
  const format = req.query.format || 'pdf';
  let rows = [];
  let cols;
  const filter = await employeeFilter(req);
  const range = dateFilter(req.query).date;
  const employeeQuery = {
    ...(req.query.department ? { department: req.query.department } : {}),
    ...(req.query.employee ? { _id: req.query.employee } : {}),
  };
  if (type === 'employees') {
    if (range) employeeQuery.joiningDate = range;
    const employees = await Employee.find({ ...employeeQuery, deleted: false })
      .populate('department designation')
      .sort({ employeeId: 1 })
      .limit(10001);
    rows = employees.map((e) => ({
      id: e.employeeId,
      name: e.name,
      email: e.email,
      department: e.department?.name || '',
      designation: e.designation?.name || '',
      joined: e.joiningDate,
      salary: e.salary,
      status: statusLabel(e.status),
    }));
    cols = columns([
      ['id', 'Employee ID'],
      ['name', 'Name'],
      ['email', 'Email'],
      ['department', 'Department'],
      ['designation', 'Job title'],
      ['joined', 'Start date'],
      ['salary', `Salary (${config.currency})`],
      ['status', 'Status'],
    ]);
  } else if (type === 'attendance') {
    const requestedEnd = range?.$lte || today(config);
    const end = requestedEnd < today(config) ? requestedEnd : today(config);
    const start = range?.$gte || `${end.slice(0, 7)}-01`;
    if (dayjs.utc(end).diff(dayjs.utc(start), 'day') > 365 || end < start)
      throw new AppError(
        400,
        'Attendance reports require a range of up to one year ending today or earlier',
      );
    const dates = datesBetween(start, end);
    const employees = await Employee.find({
      ...employeeQuery,
      joiningDate: { $lte: end },
    })
      .sort({ employeeId: 1 })
      .limit(10001);
    if (employees.length * dates.length > 10000)
      throw new AppError(
        400,
        'This report has more than 10,000 entries. Choose fewer dates, departments, or employees.',
      );
    const ids = employees.map((e) => e._id);
    const records = await Attendance.find({
      employee: { $in: ids },
      date: { $gte: start, $lte: end },
    });
    const leaves = await Leave.find({
      employee: { $in: ids },
      status: 'Approved',
      endDate: { $gte: start },
      startDate: { $lte: end },
    });
    const attendanceMap = new Map(records.map((a) => [`${a.employee}:${a.date}`, a]));
    const leaveMap = new Map(
      leaves.flatMap((l) =>
        l.workDates.map((d) => [
          `${l.employee}:${d}`,
          l.paidDates.includes(d) ? 'Paid leave' : 'Unpaid leave',
        ]),
      ),
    );
    for (const employee of employees)
      for (const date of dates) {
        if (date < employee.joiningDate || (employee.endDate && date > employee.endDate)) continue;
        const key = `${employee._id}:${date}`;
        const record = attendanceMap.get(key);
        rows.push({
          id: employee.employeeId,
          name: employee.name,
          date,
          status:
            leaveMap.get(key) ||
            record?.status ||
            (!isWorkday(date, config)
              ? 'Holiday'
              : date === today(config)
                ? 'Not checked in'
                : 'Absent'),
          checkIn: record?.checkIn
            ? dayjs(record.checkIn).tz(config.timezone).format('hh:mm A')
            : '',
          checkOut: record?.checkOut
            ? dayjs(record.checkOut).tz(config.timezone).format('hh:mm A')
            : '',
        });
      }
    cols = columns([
      ['id', 'Employee ID'],
      ['name', 'Name'],
      ['date', 'Date'],
      ['status', 'Status'],
      ['checkIn', 'Check-in'],
      ['checkOut', 'Check-out'],
    ]);
  } else if (type === 'leave') {
    const query = {
      ...filter,
      ...(range?.$gte ? { endDate: { $gte: range.$gte } } : {}),
      ...(range?.$lte ? { startDate: { $lte: range.$lte } } : {}),
    };
    const leaves = await Leave.find(query)
      .populate('employee', 'name employeeId')
      .sort({ startDate: -1 })
      .limit(10001);
    rows = leaves.map((l) => ({
      id: l.employee?.employeeId,
      name: l.employee?.name,
      type: leaveTypeLabel(l.type),
      start: l.startDate,
      end: l.endDate,
      days: l.workDates.length,
      paid: l.paidDates.length,
      status: statusLabel(l.status),
    }));
    cols = columns([
      ['id', 'Employee ID'],
      ['name', 'Name'],
      ['type', 'Type'],
      ['start', 'From'],
      ['end', 'To'],
      ['days', 'Work days'],
      ['paid', 'Days off with pay'],
      ['status', 'Status'],
    ]);
  } else if (type === 'payroll') {
    const query = { ...filter };
    if (range)
      query.month = {
        ...(range.$gte ? { $gte: range.$gte.slice(0, 7) } : {}),
        ...(range.$lte ? { $lte: range.$lte.slice(0, 7) } : {}),
      };
    const records = await Payroll.find(query).sort({ month: -1, employeeCode: 1 }).limit(10001);
    rows = records.map((p) => ({
      id: p.employeeCode,
      name: p.employeeName,
      month: p.month,
      basic: p.basic,
      allowance: p.allowance,
      bonus: p.bonus,
      deductions: p.deduction + p.attendanceDeduction,
      net: p.netSalary,
      currency: p.currency,
      status: p.paidAt ? 'Paid' : 'Not paid yet',
    }));
    cols = columns([
      ['id', 'Employee ID'],
      ['name', 'Name'],
      ['month', 'Month'],
      ['basic', 'Base pay for this month'],
      ['allowance', 'Extra pay'],
      ['bonus', 'Bonus'],
      ['deductions', 'Pay reductions'],
      ['net', 'Final pay'],
      ['currency', 'Currency'],
      ['status', 'Payment'],
    ]);
  } else throw new AppError(404, 'Report type not found');
  if (rows.length > 10000)
    throw new AppError(
      400,
      'This report has more than 10,000 entries. Choose fewer dates or employees.',
    );
  await audit(req, 'report.downloaded', 'Report', type, {
    format,
    rows: rows.length,
  });
  await exportFile(res, {
    title: `${{ employees: 'employees', attendance: 'attendance', leave: 'leave', payroll: 'pay' }[type]} report`,
    columns: cols,
    rows,
    format,
    subtitle: `${config.companyName.replace(/\badmiki\b/gi, 'admiki')} · ${req.query.month || `${req.query.startDate || 'All dates'} to ${req.query.endDate || 'today'}`}`,
  });
}
export async function payslip(req, res) {
  const record = await Payroll.findById(req.params.id);
  if (!record) throw new AppError(404, 'Pay details not found');
  if (req.user.role === 'Employee' && String(record.employee) !== String(req.user.employee))
    throw new AppError(403, 'You can only download your own pay details');
  const rows = [
    ['Employee', `${record.employeeName} (${record.employeeCode})`],
    ['Department', record.departmentName],
    ['Job title', record.designationName],
    ['Month', record.month],
    ['Full-month salary', record.salary],
    ['Base pay for this month', record.basic],
    ['Extra pay', record.allowance],
    ['Bonus', record.bonus],
    ['Other pay reductions', record.deduction],
    ['Pay taken off for missed days', record.attendanceDeduction],
    ['Final pay', record.netSalary],
    ['Company workdays', record.workingDays],
    ['Workdays at the company', record.eligibleDays],
    ['Days at work', record.presentDays],
    ['Days missed', record.absentDays],
    ['Days off with pay', record.paidDays],
    ['Days off without pay', record.unpaidDays],
    [
      'How base pay is worked out',
      'Full-month salary, adjusted for workdays between the start date and last day at work.',
    ],
    [
      'How final pay is worked out',
      'Base pay plus extra pay and bonus, minus pay reductions. It cannot be less than zero.',
    ],
    [
      'Payment status',
      record.paidAt ? `Paid on ${dayjs(record.paidAt).format('DD MMM YYYY')}` : 'Not paid yet',
    ],
    ['Currency', 'BDT'],
    ['Currency', record.currency],
  ].map(([label, value]) => ({ label, value }));
  await audit(req, 'payslip.downloaded', 'Payroll', record._id);
  await exportFile(res, {
    title: `Pay details ${record.employeeCode} ${record.month}`,
    subtitle: `${record.companyName} · ${record.currency}`,
    columns: columns([
      ['label', 'Description'],
      ['value', 'Details'],
    ]),
    rows,
    format: req.query.format || 'pdf',
  });
}
