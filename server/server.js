import { validateEnv } from './config/env.js';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import { Settings } from './models/index.js';
import { createApp } from './app.js';
import { startPhotoCleanup } from './services/photo-cleanup.js';
import { startPasswordEmails } from './services/password-reset.js';
import { normalizeRecords } from './services/normalize-records.js';
async function start() {
  validateEnv();
  await connectDB();
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid')
    throw new Error('MongoDB must be a replica set or Atlas cluster to support transactions.');
  await Settings.updateOne(
    { _id: 'company' },
    { $setOnInsert: { companyName: 'admiki' } },
    { upsert: true },
  );
  // Create validation/unique indexes before accepting traffic, including first production boot.
  for (const Model of Object.values(mongoose.models)) await Model.createIndexes();
  await normalizeRecords();
  const stopPhotoCleanup = startPhotoCleanup();
  const stopPasswordEmails = startPasswordEmails();
  const port = Number(process.env.PORT || 5000);
  const server = createApp().listen(port, () =>
    console.log(`admiki HRM API listening on port ${port}`),
  );
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    stopPhotoCleanup();
    stopPasswordEmails();
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  server.on('error', (error) => {
    console.error('HTTP server failed:', error.code);
    shutdown();
  });
}
start().catch(async (error) => {
  console.error(
    'Startup failed:',
    error.name,
    error.code || '',
    error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[database URI redacted]'),
  );
  await mongoose.disconnect();
  process.exitCode = 1;
});
