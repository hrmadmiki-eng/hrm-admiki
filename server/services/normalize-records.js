import mongoose from 'mongoose';
import { Counter, Employee, Payroll, Settings } from '../models/index.js';

// Run before accepting traffic. ObjectId relationships and monetary amounts stay intact.
export async function normalizeRecords() {
  return mongoose.connection.transaction(async (session) => {
    const counter = await Counter.findOneAndUpdate(
      { _id: 'employee' },
      { $max: { value: 1000 } },
      { upsert: true, new: true, session },
    );
    const employees = await Employee.find({}).sort({ createdAt: 1, _id: 1 }).session(session);
    const validId = (id) =>
      /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 1000;
    let last = Math.max(
      counter.value,
      ...employees.filter((e) => validId(e.employeeId)).map((e) => Number(e.employeeId)),
    );
    let changed = 0;
    for (const employee of employees) {
      if (!validId(employee.employeeId)) {
        employee.employeeId = String(++last);
        await employee.save({ session });
        changed++;
      }
      await Payroll.updateMany(
        { employee: employee._id, employeeCode: { $ne: employee.employeeId } },
        { $set: { employeeCode: employee.employeeId } },
        { session },
      );
    }
    await Counter.updateOne({ _id: 'employee' }, { $max: { value: last } }, { session });
    await Settings.updateMany(
      { currency: { $ne: 'BDT' } },
      { $set: { currency: 'BDT' } },
      { session },
    );
    const payroll = await Payroll.updateMany(
      { currency: { $ne: 'BDT' } },
      { $set: { currency: 'BDT' } },
      { session },
    );
    return {
      employeeIdsUpdated: changed,
      payrollCurrenciesUpdated: payroll.modifiedCount,
      lastEmployeeId: last,
    };
  });
}
