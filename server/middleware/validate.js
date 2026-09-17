import { body, param, query, validationResult } from 'express-validator';
import { validDate, validMonth } from '../utils/dates.js';
import { AppError } from '../utils/http.js';
import { passwordError } from '../utils/password.js';
export { body, param, query };
export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    throw new AppError(
      400,
      'Please check the supplied values',
      errors.array().map((e) => ({ field: e.path, message: e.msg })),
    );
  next();
};
export const id = (name) => param(name).isMongoId().withMessage('Invalid identifier');
export const date = (name) =>
  body(name).custom(validDate).withMessage('Use a valid YYYY-MM-DD date');
export const month = (name) =>
  body(name).custom(validMonth).withMessage('Use a valid YYYY-MM month');
export const password = (name, role = (req) => req.user?.role) =>
  body(name).custom((value, { req }) => {
    const message = passwordError(value, typeof role === 'function' ? role(req) : role);
    if (message) throw new Error(message);
    return true;
  });
export const filters = [
  query('employee').optional().isMongoId(),
  query('department').optional().isMongoId(),
  query('month').optional().custom(validMonth),
  query('startDate').optional().custom(validDate),
  query('endDate').optional().custom(validDate),
  query('page').optional().isInt({ min: 1, max: 100000 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().isString().isLength({ max: 100 }),
  query('status').optional().isString().isLength({ max: 30 }),
  query('endDate')
    .optional()
    .custom((end, { req }) => !req.query.startDate || end >= req.query.startDate)
    .withMessage('End date must not precede start date'),
  validate,
];
