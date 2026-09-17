import { Employee, Attendance, Leave } from '../models/index.js';
import { isWorkday } from '../utils/dates.js';

// Counts and drill-down lists share the same eligible team and daily attendance rules.
export async function dashboardTeam(date, config) {
  const employees = await Employee.find({
    deleted: false,
    status: 'Active',
    joiningDate: { $lte: date },
  }).select('_id department');
  const ids = employees.map((employee) => employee._id);
  const [present, onLeave] = await Promise.all([
    Attendance.find({
      employee: { $in: ids },
      date,
      status: { $in: ['Present', 'Late'] },
    }).distinct('employee'),
    Leave.find({ employee: { $in: ids }, status: 'Approved', workDates: date }).distinct(
      'employee',
    ),
  ]);
  const accounted = new Set([...present, ...onLeave].map(String));
  return {
    employees,
    groups: {
      active: ids,
      present,
      absent: isWorkday(date, config) ? ids.filter((id) => !accounted.has(String(id))) : [],
      'on-leave': onLeave,
    },
  };
}
