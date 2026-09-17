import '../server/config/env.js';
import mongoose from '../server/node_modules/mongoose/index.js';
try {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    autoIndex: false,
  });
  const collections = await mongoose.connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();
  console.log(
    'Existing collection names:',
    collections
      .map((c) => c.name)
      .sort()
      .join(', '),
  );
  for (const name of ['users', 'employees', 'admiki_users', 'admiki_employees']) {
    if (collections.some((c) => c.name === name))
      console.log(
        `${name}: ${await mongoose.connection.db.collection(name).countDocuments()} records`,
      );
  }
} catch (error) {
  console.error('Database inspection failed:', error.name, error.code || '');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
