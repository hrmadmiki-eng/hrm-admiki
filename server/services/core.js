import mongoose from 'mongoose';
import { AuditLog, Counter, Employee, Payroll, Settings } from '../models/index.js';
import { AppError } from '../utils/http.js';
export const settings = () => Settings.findById('company');
export async function transaction(callback) {
  return mongoose.connection.transaction(callback);
}
export async function lockSettings(session) {
  return Settings.findOneAndUpdate(
    { _id: 'company' },
    { $inc: { revision: 1 } },
    { new: true, session },
  );
}
export async function lockEmployee(id, session, { includeArchived = false } = {}) {
  const employee = await Employee.findOneAndUpdate(
    { _id: id, ...(includeArchived ? {} : { deleted: false }) },
    { $inc: { revision: 1 } },
    { new: true, session },
  );
  if (!employee) throw new AppError(404, 'Employee not found');
  return employee;
}
export async function nextEmployeeId(session) {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'employee' },
    [{ $set: { value: { $add: [{ $max: [{ $ifNull: ['$value', 1000] }, 1000] }, 1] } } }],
    { upsert: true, new: true, session },
  );
  return String(counter.value);
}
export async function audit(req, action, entity, entityId, metadata = {}, session) {
  await AuditLog.create(
    [
      {
        actor: req.user?._id,
        actorName: req.user?.name || 'System',
        action,
        entity,
        entityId: String(entityId || ''),
        metadata,
        ip: req.ip,
      },
    ],
    { session },
  );
}
export async function assertMonthOpen(employee, dates, session) {
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  if (await Payroll.exists({ employee, month: { $in: months } }).session(session))
    throw new AppError(
      409,
      'Pay has already been saved for this month. Its attendance and leave can no longer be changed.',
    );
}
