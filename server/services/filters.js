import { Employee } from '../models/index.js';
import { AppError } from '../utils/http.js';
import { dayjs } from '../utils/dates.js';
export async function employeeFilter(req) {
  if (req.user.role === 'Employee') {
    if (!req.user.employee) throw new AppError(404, 'No employee profile is linked');
    if (req.query.employee && req.query.employee !== String(req.user.employee))
      throw new AppError(403, 'You can only access your own records');
    if (req.query.department) throw new AppError(403, 'Department filtering is restricted');
    return { employee: req.user.employee };
  }
  if (req.query.department) {
    const ids = await Employee.find({
      department: req.query.department,
      ...(req.query.employee ? { _id: req.query.employee } : {}),
    }).distinct('_id');
    return { employee: { $in: ids } };
  }
  return req.query.employee ? { employee: req.query.employee } : {};
}
export function dateFilter(query, field = 'date') {
  let start = query.startDate;
  let end = query.endDate;
  if (query.month) {
    start = `${query.month}-01`;
    end = dayjs.utc(start).endOf('month').format('YYYY-MM-DD');
  }
  if (start && end && start > end) throw new AppError(400, 'Start date must be before end date');
  return start || end
    ? { [field]: { ...(start ? { $gte: start } : {}), ...(end ? { $lte: end } : {}) } }
    : {};
}
