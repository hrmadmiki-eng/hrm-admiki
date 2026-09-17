import '../server/config/env.js';
import mongoose from '../server/node_modules/mongoose/index.js';
import { connectDB } from '../server/config/db.js';
import { normalizeRecords } from '../server/services/normalize-records.js';
import { Employee, Payroll, Settings } from '../server/models/index.js';
try {
  await connectDB();
  if (process.argv.includes('--check')) {
    console.log(
      JSON.stringify({
        employees: await Employee.countDocuments(),
        legacyEmployeeIds: await Employee.countDocuments({ employeeId: { $not: /^[1-9]\d{3,}$/ } }),
        companyCurrencies: await Settings.distinct('currency'),
        payrollCurrencies: await Payroll.distinct('currency'),
      }),
    );
  } else console.log(JSON.stringify(await normalizeRecords()));
} catch (error) {
  console.error('Record normalization failed:', error.name, error.code || '');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
