import './config/env.js';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './config/env.js';
import { api } from './routes/index.js';
import { allowedOrigin, verifyOrigin } from './middleware/auth.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { ok } from './utils/http.js';
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Set only when running behind the documented number of trusted reverse proxies.
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:', 'blob:'],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'connect-src': ["'self'"],
        },
      },
    }),
  );
  app.use(
    cors((req, callback) =>
      callback(null, {
        origin: allowedOrigin(req, req.get('Origin')) ? req.get('Origin') : false,
        credentials: true,
      }),
    ),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  if (process.env.NODE_ENV !== 'test') app.use(morgan(':method :url :status :response-time ms'));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', (req, res) => {
    if (mongoose.connection.readyState !== 1)
      return res.status(503).json({
        success: false,
        message: 'Database unavailable',
        data: null,
        error: { code: 503, details: null },
      });
    ok(res, { status: 'healthy' });
  });
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 1000,
      skip: (req) => req.method === 'GET' && /^\/notifications\/?$/i.test(req.path),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        success: false,
        message: 'Too many requests. Please try again later.',
        data: null,
        error: { code: 429, details: null },
      },
    }),
    verifyOrigin,
    api,
  );
  app.use('/api', notFound);
  const build = path.join(root, 'client/dist');
  if (process.env.NODE_ENV === 'production' && fs.existsSync(path.join(build, 'index.html'))) {
    app.use(express.static(build, { maxAge: '1h', index: false }));
    app.get('/{*path}', (req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(build, 'index.html'));
    });
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
