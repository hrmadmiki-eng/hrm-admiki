import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { authenticate, allow, allowPhotoEdit, requirePasswordChange } from '../middleware/auth.js';
import {
  body,
  query,
  id,
  date,
  month,
  password,
  validate,
  filters,
} from '../middleware/validate.js';
import * as auth from '../controllers/auth.js';
import * as employees from '../controllers/employees.js';
import * as catalogs from '../controllers/catalogs.js';
import * as attendance from '../controllers/attendance.js';
import * as leaves from '../controllers/leaves.js';
import * as payroll from '../controllers/payroll.js';
import * as admin from '../controllers/admin.js';
import * as reports from '../controllers/reports.js';
import * as notifications from '../controllers/notifications.js';
import { dashboard } from '../controllers/dashboard.js';
import { validDate } from '../utils/dates.js';
import { hashResetToken } from '../services/password-reset.js';
const all = ['Admin', 'HR', 'Employee'];
const managers = ['Admin', 'HR'];
export const api = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many sign-in attempts. Try again in 15 minutes.',
    data: null,
    error: { code: 429, details: null },
  },
});
api.post(
  '/auth/login',
  loginLimiter,
  body('email').isEmail().isLength({ max: 254 }),
  body('password').isString().isLength({ min: 1, max: 72 }),
  validate,
  auth.login,
);
const recoveryLimit = (message) => ({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message, data: null, error: { code: 429, details: null } },
});
api.post(
  '/auth/forgot-password',
  rateLimit(recoveryLimit('Too many reset requests. Please try again in 15 minutes.')),
  body('email').isString().bail().trim().toLowerCase().isEmail().isLength({ max: 254 }),
  validate,
  rateLimit({
    ...recoveryLimit('Too many reset requests for this email. Please try again in an hour.'),
    windowMs: 60 * 60 * 1000,
    limit: 3,
    keyGenerator: (req) => hashResetToken(req.body.email),
  }),
  auth.forgotPassword,
);
api.post(
  '/auth/reset-password',
  rateLimit(recoveryLimit('Too many reset attempts. Please try again in 15 minutes.')),
  body('token')
    .isString()
    .bail()
    .matches(/^[a-f0-9]{64}$/)
    .withMessage('Invalid reset link'),
  // The controller enforces the account's role after resolving the reset token.
  password('newPassword', 'Employee'),
  validate,
  auth.resetPassword,
);
api.use(authenticate);
api.get('/auth/me', allow(...all), auth.me);
api.post('/auth/logout', allow(...all), auth.logout);
api.put(
  '/auth/password',
  allow(...all),
  body('currentPassword').isString().isLength({ min: 1, max: 72 }),
  password('newPassword'),
  validate,
  auth.changePassword,
);
api.use(requirePasswordChange);
// Per-user polling allowance avoids exhausting a shared office IP's request limit.
api.use(
  '/notifications',
  allow(...all),
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 180,
    keyGenerator: (req) => String(req.user._id),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      success: false,
      message: 'Too many notification requests. Please try again later.',
      data: null,
      error: { code: 429, details: null },
    },
  }),
);
api.get(
  '/notifications',
  query('page').optional().isInt({ min: 1, max: 100000 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('unread').optional().isIn(['true', 'false']),
  validate,
  notifications.list,
);
api.patch('/notifications/read-all', notifications.markAllRead);
api.patch('/notifications/:id/read', id('id'), validate, notifications.markRead);
api.post(
  '/announcements',
  allow(...managers),
  body('title').isString().trim().isLength({ min: 1, max: 150 }),
  body('message').isString().trim().isLength({ min: 1, max: 2000 }),
  validate,
  notifications.announce,
);
api.get('/company', allow(...all), admin.publicConfig);
api.get(
  '/dashboard',
  allow(...all),
  query('currency').optional().isIn(['BDT']),
  validate,
  dashboard,
);
api.get('/employees/me', allow(...all), employees.profile);
api.get('/employees/:id/photo', allow(...all), id('id'), validate, employees.photo);
const employeeRules = () => [
  body('name').isString().trim().isLength({ min: 1, max: 150 }),
  body('email').isEmail().isLength({ max: 254 }).trim().toLowerCase(),
  body('phone').optional().isString().isLength({ max: 30 }),
  body('address').optional().isString().isLength({ max: 1000 }),
  body('department').optional({ values: 'null' }).isMongoId(),
  body('designation').optional({ values: 'null' }).isMongoId(),
  date('joiningDate'),
  body('endDate').optional({ values: 'falsy' }).custom(validDate),
  body('salary').isFloat({ min: 0, max: 100000000 }).toFloat(),
  body('status').optional().isIn(['Active', 'Inactive', 'Terminated']),
];
api.get(
  '/employees',
  allow(...managers),
  query('includeArchived').optional().isIn(['true', 'false']),
  query('dashboard').optional().isIn(['active', 'present', 'absent', 'on-leave']),
  query('date').optional().custom(validDate),
  filters,
  employees.list,
);
api.post(
  '/employees',
  allow(...managers),
  employeeRules(),
  password('password', 'Employee'),
  validate,
  employees.create,
);
api.get('/employees/:id', allow(...managers), id('id'), validate, employees.profile);
api.put(
  '/employees/:id',
  allow(...managers),
  id('id'),
  employeeRules(),
  validate,
  employees.update,
);
api.delete('/employees/:id', allow(...managers), id('id'), validate, employees.remove);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 0 },
});
api.post(
  '/employees/:id/photo',
  allow(...all),
  id('id'),
  validate,
  allowPhotoEdit,
  upload.single('photo'),
  employees.uploadPhoto,
);
api.delete(
  '/employees/:id/photo',
  allow(...all),
  id('id'),
  validate,
  allowPhotoEdit,
  employees.removePhoto,
);
for (const path of ['departments', 'designations']) {
  const router = Router();
  router.use(allow(...managers));
  const rules = () => [
    body('name').isString().trim().isLength({ min: 1, max: 150 }),
    ...(path === 'departments'
      ? [body('description').optional().isString().isLength({ max: 1000 })]
      : [body('department').isMongoId()]),
  ];
  router.get('/', catalogs.list);
  router.post('/', rules(), validate, catalogs.save);
  router.put('/:id', id('id'), rules(), validate, catalogs.save);
  router.delete('/:id', id('id'), validate, catalogs.remove);
  api.use(`/${path}`, router);
}
api.get('/attendance', allow(...all), filters, attendance.list);
api.get('/attendance/today', allow(...all), attendance.current);
api.post('/attendance/check-in', allow(...all), attendance.checkIn);
api.post('/attendance/check-out', allow(...all), attendance.checkOut);
api.put(
  '/attendance/manual',
  allow(...managers),
  body('employee').isMongoId(),
  date('date'),
  body('status').isIn(['Present', 'Late', 'Absent', 'Holiday']),
  body('checkIn')
    .optional({ values: 'falsy' })
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/),
  body('checkOut')
    .optional({ values: 'falsy' })
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/),
  body('notes').optional().isString().isLength({ max: 1000 }),
  validate,
  attendance.manual,
);
api.get('/leave', allow(...all), filters, leaves.list);
api.get(
  '/leave/balance',
  allow(...all),
  query('year').optional().isInt({ min: 2000, max: 2200 }),
  validate,
  leaves.balance,
);
api.get('/leave/:id', allow(...all), id('id'), validate, leaves.detail);
api.post(
  '/leave',
  allow(...all),
  date('startDate'),
  date('endDate'),
  body('type').isIn(['Casual', 'Sick', 'Annual', 'Unpaid']),
  body('reason').isString().trim().isLength({ min: 3, max: 2000 }),
  validate,
  leaves.apply,
);
api.patch(
  '/leave/:id/review',
  allow(...managers),
  id('id'),
  body('status').isIn(['Approved', 'Rejected']),
  body('reviewNote').optional().isString().isLength({ max: 1000 }),
  validate,
  leaves.review,
);
api.patch('/leave/:id/cancel', allow(...all), id('id'), validate, leaves.cancel);
api.get(
  '/payroll',
  allow(...all),
  query('currency').optional().isIn(['BDT']),
  filters,
  payroll.list,
);
api.post(
  '/payroll/generate',
  allow(...managers),
  month('month'),
  body('employee').optional({ values: 'falsy' }).isMongoId(),
  ...['allowance', 'bonus', 'deduction'].map((f) =>
    body(f).optional().isFloat({ min: 0, max: 100000000 }).toFloat(),
  ),
  validate,
  payroll.generate,
);
api.patch('/payroll/:id/paid', allow(...managers), id('id'), validate, payroll.markPaid);
api.get(
  '/payroll/:id/payslip',
  allow(...all),
  id('id'),
  query('format').optional().isIn(['pdf', 'excel']),
  validate,
  reports.payslip,
);
api.get(
  '/reports/:type',
  allow(...managers),
  filters,
  query('format').optional().isIn(['pdf', 'excel']),
  validate,
  reports.report,
);
api.get('/users', allow('Admin'), filters, admin.users);
api.patch(
  '/users/:id',
  allow('Admin'),
  id('id'),
  body('role').optional().isIn(all),
  body('active').optional().isBoolean().toBoolean(),
  // The controller validates against the target user's resulting role.
  password('password', 'Employee').optional(),
  validate,
  admin.updateUser,
);
api.get('/settings', allow('Admin'), admin.getSettings);
api.put(
  '/settings',
  allow('Admin'),
  body('companyName').optional().isString().trim().isLength({ min: 1, max: 150 }),
  body('email').optional({ values: 'falsy' }).isEmail(),
  body('phone').optional().isString().isLength({ max: 30 }),
  body('address').optional().isString().isLength({ max: 1000 }),
  body('currency').optional().isIn(['BDT']),
  body('timezone').optional().isString().isLength({ max: 100 }),
  body('officeStart')
    .optional()
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/),
  body('officeEnd')
    .optional()
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/),
  body('graceMinutes').optional().isInt({ min: 0, max: 120 }).toInt(),
  body('weekends').optional().isArray({ max: 6 }),
  body('weekends.*').isInt({ min: 0, max: 6 }).toInt(),
  body('holidays').optional().isArray({ max: 366 }),
  body('holidays.*.date').isDate({ format: 'YYYY-MM-DD', strictMode: true }),
  body('holidays.*.name').isString().trim().isLength({ min: 1, max: 150 }),
  body('leavePolicy').optional().isObject(),
  ...['Casual', 'Sick', 'Annual'].map((t) =>
    body(`leavePolicy.${t}`).optional().isInt({ min: 0, max: 366 }).toInt(),
  ),
  validate,
  admin.updateSettings,
);
api.get('/audit', allow('Admin'), filters, admin.auditLogs);
