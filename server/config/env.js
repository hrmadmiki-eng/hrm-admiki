import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
// Optional configuration: callers can disable email without preventing API startup.
export function configuredClientOrigin() {
  try {
    const url = new URL(process.env.CLIENT_URL?.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
export function validateEnv() {
  for (const key of [
    'MONGO_URI',
    'JWT_SECRET',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ]) {
    if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
  }
  if (process.env.JWT_SECRET.length < 32 || /replace-with|change-me/i.test(process.env.JWT_SECRET))
    throw new Error('JWT_SECRET must be a unique secret of at least 32 characters.');
  const rounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
  if (!Number.isInteger(rounds) || rounds < 10 || rounds > 15)
    throw new Error('BCRYPT_SALT_ROUNDS must be between 10 and 15.');
}
