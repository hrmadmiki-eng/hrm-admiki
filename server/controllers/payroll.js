import { Payroll, Employee, Attendance, Leave } from '../models/index.js';
import { AppError, ok, pagination } from '../utils/http.js';
import { dayjs, today, workDates, calculatePayroll } from '../utils/dates.js';
import { employeeFilter, dateFilter } from '../services/filters.js';
import { transaction, lockSettings, lockEmployee, audit } from '../services/core.js';
export async function list(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const filter = await employeeFilter(req);
  if (req.query.currency) filter.currency = req.query.currency;
  const range = dateFilter(req.query).date;
  if (range)
    filter.month = {
      ...(range.$gte ? { $gte: range.$gte.slice(0, 7) } : {}),
      ...(range.$lte ? { $lte: range.$lte.slice(0, 7) } : {}),
    };
  const [items, total] = await Promise.all([
    Payroll.find(filter).sort({ month: -1, employeeName: 1 }).skip(skip).limit(limit),
    Payroll.countDocuments(filter),
  ]);
  ok(res, { items, total, page, pages: Math.ceil(total / limit) });
}
export async function generate(req, res) {
  const result = await transaction(async (session) => {
    const config = await lockSettings(session);
    const { month } = req.body;
    if (month >= today(config).slice(0, 7))
      throw new AppError(400, 'Choose a past month to prepare pay.');
    const start = `${month}-01`;
    const end = dayjs.utc(start).endOf('month').format('YYYY-MM-DD');
    const employees = await Employee.find({
      joiningDate: { $lte: end },
      $or: [
        { endDate: { $exists: false } },
        { endDate: null },
        { endDate: '' },
        { endDate: { $gte: start } },
      ],
      ...(req.body.employee ? { _id: req.body.employee } : {}),
    })
      .session(session)
      .populate('department designation');
    if (!employees.length) throw new AppError(400, 'No employees worked here during this month.');
    if (employees.length > 500)
      throw new AppError(
        400,
        'For a team of more than 500 people, prepare pay for one employee at a time.',
      );
    const calendar = workDates(start, end, config);
    let created = 0;
    let skipped = 0;
    for (const employee of employees) {
      await lockEmployee(employee._id, session, { includeArchived: true });
      if (await Payroll.exists({ employee: employee._id, month }).session(session)) {
        skipped++;
        continue;
      }
      if (
        await Leave.exists({
          employee: employee._id,
          status: 'Pending',
          startDate: { $lte: end },
          endDate: { $gte: start },
        }).session(session)
      )
        throw new AppError(
          409,
          `Decide the waiting leave requests for ${employee.name} before preparing pay.`,
        );
      const eligible = calendar.filter(
        (d) => d >= employee.joiningDate && (!employee.endDate || d <= employee.endDate),
      );
      const attendance = await Attendance.find({
        employee: employee._id,
        date: { $in: eligible },
        status: { $in: ['Present', 'Late'] },
      }).session(session);
      const leaves = await Leave.find({
        employee: employee._id,
        status: 'Approved',
        startDate: { $lte: end },
        endDate: { $gte: start },
      }).session(session);
      const present = new Set(attendance.map((a) => a.date));
      const paid = new Set(leaves.flatMap((l) => l.paidDates));
      const leaveDates = new Set(leaves.flatMap((l) => l.workDates));
      let absentDays = 0;
      let paidDays = 0;
      let unpaidDays = 0;
      let presentDays = 0;
      for (const date of eligible) {
        if (present.has(date)) presentDays++;
        else if (paid.has(date)) paidDays++;
        else if (leaveDates.has(date)) unpaidDays++;
        else absentDays++;
      }
      const amounts = calculatePayroll({
        salary: employee.salary,
        allowance: req.body.allowance,
        bonus: req.body.bonus,
        deduction: req.body.deduction,
        workingDays: calendar.length,
        eligibleDays: eligible.length,
        absentDays,
        unpaidDays,
      });
      await Payroll.create(
        [
          {
            employee: employee._id,
            month,
            employeeName: employee.name,
            employeeCode: employee.employeeId,
            departmentName: employee.department?.name || '',
            designationName: employee.designation?.name || '',
            companyName: config.companyName,
            currency: config.currency,
            salary: employee.salary,
            ...amounts,
            workingDays: calendar.length,
            eligibleDays: eligible.length,
            presentDays,
            absentDays,
            paidDays,
            unpaidDays,
            generatedBy: req.user._id,
          },
        ],
        { session },
      );
      created++;
    }
    await audit(req, 'payroll.generated', 'Payroll', month, { created, skipped }, session);
    return { created, skipped };
  });
  ok(
    res,
    result,
    `Prepared pay for ${result.created} employees; ${result.skipped} already had saved pay details.`,
  );
}
export async function markPaid(req, res) {
  const payroll = await transaction(async (session) => {
    const record = await Payroll.findOneAndUpdate(
      { _id: req.params.id, paidAt: null },
      { $set: { paidAt: new Date() } },
      { new: true, session },
    );
    if (!record)
      throw new AppError(
        409,
        'Pay details were not found, or this payment is already marked as paid.',
      );
    await audit(req, 'payroll.marked_paid', 'Payroll', record._id, {}, session);
    return record;
  });
  ok(res, payroll, 'Marked as paid');
}
