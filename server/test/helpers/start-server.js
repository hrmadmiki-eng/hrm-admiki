import dotenv from 'dotenv';

// Isolated startup tests load a temporary .env before the production entry point.
// Explicit blank values keep the developer's real .env from filling missing test settings.
dotenv.config({ path: process.env.STARTUP_TEST_ENV, quiet: true });
await import('../../server.js');
