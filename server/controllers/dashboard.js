import { Attendance, Leave, Payroll, Department } from '../models/index.js';
import { ownEmployee } from '../middleware/auth.js';
import { settings } from '../services/core.js';
import { today, dayjs, isWorkday, workDates } from '../utils/dates.js';
import { balances } from './leaves.js';
import { ok } from '../utils/http.js';
import { dashboardTeam } from '../services/dashboard-team.js';
export async function dashboard(req, res) {
  const config = await settings();
  const date = today(config);
  const month = date.slice(0, 7);
  const start = `${month}-01`;
  const payrollCurrency = req.query.currency || config.currency;
  if (req.user.role === 'Employee') {
    const employee = await ownEmployee(req);
    const [attendance, recentLeave, payslip, balance, approved] = await Promise.all([
      Attendance.find({
        employee: employee._id,
        date: { $gte: start, $lte: date },
      }).sort({ date: -1 }),
      Leave.find({ employee: employee._id }).sort({ createdAt: -1 }).limit(5),
      Payroll.findOne({ employee: employee._id }).sort({ month: -1 }),
      balances(employee._id, date.slice(0, 4), config),
      Leave.find({
        employee: employee._id,
        status: 'Approved',
        endDate: { $gte: start },
        startDate: { $lte: date },
      }),
    ]);
    const presentDays = attendance.filter((a) => ['Present', 'Late'].includes(a.status)).length;
    const dates = workDates(
      employee.joiningDate > start ? employee.joiningDate : start,
      date,
      config,
    ).filter((d) => d < date);
    const accounted = new Set([
      ...attendance.filter((a) => ['Present', 'Late'].includes(a.status)).map((a) => a.date),
      ...approved.flatMap((l) => l.workDates),
    ]);
    return ok(res, {
      date,
      month,
      employee,
      presentDays,
      lateDays: attendance.filter((a) => a.status === 'Late').length,
      absentDays: dates.filter((d) => !accounted.has(d)).length,
      attendance: attendance.slice(0, 7),
      recentLeave,
      payslip,
      balances: balance,
    });
  }
  const { employees, groups } = await dashboardTeam(date, config);
  const [pendingLeave, recentLeave, payrollRows, departments] = await Promise.all([
    Leave.countDocuments({ status: 'Pending' }),
    Leave.find({ status: 'Pending' })
      .populate('employee', 'name employeeId')
      .sort({ createdAt: -1 })
      .limit(5),
    Payroll.aggregate([
      {
        $match: {
          currency: payrollCurrency,
          month: {
            $gte: dayjs.utc(start).subtract(5, 'month').format('YYYY-MM'),
          },
        },
      },
      {
        $group: {
          _id: '$month',
          total: { $sum: '$netSalary' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Department.find().select('name'),
  ]);
  const series = Array.from({ length: 6 }, (_, i) => {
    const m = dayjs
      .utc(start)
      .subtract(5 - i, 'month')
      .format('YYYY-MM');
    return {
      month: m,
      total: payrollRows.find((p) => p._id === m)?.total || 0,
    };
  });
  ok(res, {
    date,
    month,
    payrollCurrency,
    totalEmployees: groups.active.length,
    presentToday: groups.present.length,
    absentToday: groups.absent.length,
    onLeave: groups['on-leave'].length,
    pendingLeave,
    monthlyPayroll: payrollRows.find((p) => p._id === month)?.total || 0,
    lastPayroll: payrollRows.at(-1) || null,
    payrollSeries: series,
    departments: departments.map((d) => ({
      name: d.name,
      count: employees.filter((e) => String(e.department) === String(d._id)).length,
    })),
    recentLeave,
    isWorkday: isWorkday(date, config),
  });
}
