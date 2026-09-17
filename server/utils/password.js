import { AppError } from './http.js';

export const passwordMinimum = (role) => (role === 'Employee' ? 4 : 6);

export function passwordError(value, role) {
  const minimum = passwordMinimum(role);
  if (typeof value !== 'string' || [...value].length < minimum)
    return `Password must contain at least ${minimum} characters`;
  if (Buffer.byteLength(value, 'utf8') > 72)
    return 'This password is too long. Try fewer letters or symbols.';
  return null;
}

export function validatePassword(value, role, field = 'password') {
  const message = passwordError(value, role);
  if (message) throw new AppError(400, 'Please check the supplied values', [{ field, message }]);
}
