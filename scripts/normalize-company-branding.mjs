import '../server/config/env.js';
import dns from 'node:dns';
import mongoose from '../server/node_modules/mongoose/index.js';
import { Settings, Payroll } from '../server/models/index.js';

// Optional process-local DNS override for environments with unavailable SRV resolution.
if (process.env.DIAGNOSTIC_DNS_SERVERS)
  dns.setServers(process.env.DIAGNOSTIC_DNS_SERVERS.split(','));
const timeout = setTimeout(() => {
  console.error('Company branding update timed out.');
  process.exit(1);
}, 25000);
try {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    autoIndex: false,
  });
  const filter = { companyName: { $regex: /^admiki$/i, $ne: 'admiki' } };
  const counts = await mongoose.connection.transaction(async (session) => {
    const company = await Settings.updateOne(
      { _id: 'company', ...filter },
      { $set: { companyName: 'admiki' } },
      { session, timestamps: false },
    );
    const payroll = await Payroll.updateMany(
      filter,
      { $set: { companyName: 'admiki' } },
      { session, timestamps: false },
    );
    return { companySettings: company.modifiedCount, payslipCompanyNames: payroll.modifiedCount };
  });
  console.log('Normalized company branding:', counts);
  console.log(
    'Stored company name:',
    (await Settings.findById('company').select('companyName'))?.companyName,
  );
  const remaining = await Payroll.countDocuments(filter);
  if (remaining) throw new Error(`${remaining} payslip company names still need normalization.`);
} catch (error) {
  console.error(
    'Company branding update failed:',
    error.name,
    error.code || '',
    error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[database URI redacted]'),
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
  clearTimeout(timeout);
}
