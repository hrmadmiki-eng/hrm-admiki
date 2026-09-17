import { validateEnv } from './config/env.js';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import { User, Employee, Settings } from './models/index.js';
import { nextEmployeeId, transaction, lockSettings, audit } from './services/core.js';
import { today } from './utils/dates.js';
import { passwordError } from './utils/password.js';
import { normalizeRecords } from './services/normalize-records.js';
async function seed() {
  validateEnv();
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('INITIAL_ADMIN_EMAIL is required. Set it in .env before seeding.');
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  const error = passwordError(password, 'Admin');
  if (error) throw new Error(`INITIAL_ADMIN_PASSWORD: ${error}`);
  await connectDB();
  for (const Model of Object.values(mongoose.models)) await Model.createIndexes();
  await Settings.updateOne(
    { _id: 'company' },
    { $setOnInsert: { companyName: 'admiki' } },
    { upsert: true },
  );
  await normalizeRecords();
  const hash = await bcrypt.hash(password, Number(process.env.BCRYPT_SALT_ROUNDS || 10));
  const created = await transaction(async (session) => {
    const config = await lockSettings(session);
    if (await User.exists({ role: 'Admin' }).session(session)) return false;
    const [user] = await User.create(
      [
        {
          name: 'System Administrator',
          email,
          password: hash,
          role: 'Admin',
          mustChangePassword: true,
        },
      ],
      { session },
    );
    const [employee] = await Employee.create(
      [
        {
          user: user._id,
          name: user.name,
          email,
          employeeId: await nextEmployeeId(session),
          joiningDate: today(config),
          salary: 0,
        },
      ],
      { session },
    );
    user.employee = employee._id;
    await user.save({ session });
    await audit({ user, ip: 'seed' }, 'admin.seeded', 'User', user._id, {}, session);
    return true;
  });
  console.log(
    created
      ? `Initial Admin created: ${email}. Change the temporary password on first login.`
      : 'An Admin already exists. No accounts were changed.',
  );
}
seed()
  .catch((error) => {
    console.error(
      'Seed failed:',
      error.name,
      error.code || '',
      error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[database URI redacted]'),
    );
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
