import { AppError } from '../utils/http.js';
import { PhotoStorageError } from '../services/cloudinary.js';
import { MailConfigurationError } from '../services/mail.js';
export const notFound = (req, res, next) =>
  next(new AppError(404, 'This item could not be found.'));
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let status = err.status || 500;
  let message = err.message || 'Something went wrong';
  let details = err.details || null;
  if (err.code === 11000) {
    status = 409;
    message = 'These details are already used by another record.';
    details = Object.keys(err.keyPattern || {});
  }
  if (err.name === 'ValidationError') {
    status = 400;
    message = 'Please check the details you entered.';
    details = Object.values(err.errors).map((e) => e.message);
  }
  if (err.name === 'CastError') {
    status = 400;
    message = 'The selected item or value is not valid.';
  }
  if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Your request could not be read. Refresh the page and try again.';
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    status = 400;
    message = 'Photo must be at most 3 MB';
  }
  if (err.name === 'MulterError') {
    status = 400;
    message = 'Invalid file upload';
  }
  if (status >= 500) {
    console.error('Request error:', err.name, err.code || '', err.message);
    message =
      err instanceof PhotoStorageError || err instanceof MailConfigurationError
        ? err.message
        : 'Something went wrong. Please try again.';
    details = null;
  }
  res.status(status).json({
    success: false,
    message,
    data: null,
    error: { code: status, details },
  });
}
