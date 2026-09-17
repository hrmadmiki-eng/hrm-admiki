import jwt from 'jsonwebtoken';
import { User, Employee } from '../models/index.js';
import { AppError } from '../utils/http.js';
import { configuredClientOrigin } from '../config/env.js';
export async function authenticate(req, res, next) {
  const token = req.cookies?.admiki_session;
  if (!token) throw new AppError(401, 'Please sign in to continue');
  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'admiki-hrms',
      audience: 'admiki-web',
    });
  } catch {
    throw new AppError(401, 'Your session has expired. Please sign in again.');
  }
  const user = await User.findById(claims.sub).select('+tokenVersion');
  if (!user || !user.active || user.tokenVersion !== claims.version)
    throw new AppError(401, 'Session is no longer valid');
  req.user = user;
  next();
}
export const allow =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role))
      throw new AppError(403, 'You do not have permission to perform this action');
    next();
  };
export function requirePasswordChange(req, res, next) {
  if (req.user.mustChangePassword)
    throw new AppError(403, 'Please change your temporary password first');
  next();
}
export function allowPhotoEdit(req, res, next) {
  if (
    !['Admin', 'HR'].includes(req.user.role) &&
    String(req.user.employee) !== req.params.id.toLowerCase()
  )
    throw new AppError(403, 'You can only change your own profile picture');
  next();
}
export async function ownEmployee(req) {
  if (!req.user.employee) throw new AppError(404, 'No employee profile is linked to your account');
  const employee = await Employee.findOne({ _id: req.user.employee, deleted: false });
  if (!employee) throw new AppError(404, 'Employee profile not found');
  return employee;
}
export function allowedOrigin(req, origin) {
  if (!origin || origin === 'null') return false;
  const configured = configuredClientOrigin();
  if (configured) return origin === configured;
  // Keep same-origin deployments and the default Vite dev UI usable without CLIENT_URL.
  // Never reflect an arbitrary Origin or use this fallback for emailed reset links.
  if (origin === `${req.protocol}://${req.get('host')}`) return true;
  return (
    process.env.NODE_ENV !== 'production' &&
    ['http://localhost:5173', 'http://127.0.0.1:5173'].includes(origin)
  );
}
export function verifyOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('Origin');
  if (!allowedOrigin(req, origin)) throw new AppError(403, 'Request origin is not allowed');
  next();
}
