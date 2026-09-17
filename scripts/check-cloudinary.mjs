import '../server/config/env.js';
import { createRequire } from 'node:module';
import https from 'node:https';
import {
  uploadProfilePhoto,
  deleteProfilePhoto,
  PhotoStorageError,
  profilePhotoId,
} from '../server/services/cloudinary.js';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const sharp = require('sharp');
const { v2: cloudinary } = require('cloudinary');

const values = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].map(
  (key) => process.env[key],
);
cloudinary.config({
  cloud_name: values[0],
  api_key: values[1],
  api_secret: values[2],
  secure: true,
});
const publicId = profilePhotoId('diagnostic');
function safeReason(value) {
  const message = String(value);
  if (/missing permissions/i.test(message)) {
    const actions = message.match(/actions=\[([^\]]*)\]/)?.[1] || '';
    const allowed = actions.match(/\b(create|read|update|delete)\b/g) || [];
    return `Request forbidden due to missing permissions${allowed.length ? ` (${allowed.join(', ')})` : ''}`;
  }
  if (/signature/i.test(message)) return 'Request signature rejected';
  if (/api.?key|authentication|credentials/i.test(message)) return 'Credentials rejected';
  return 'Provider rejected the request; raw response omitted to protect credentials';
}
// The SDK drops response bodies for unexpected status codes (including 403).
const originalRequest = https.request;
https.request = function (...args) {
  const request = originalRequest.apply(this, args);
  request.on('response', (response) => {
    if (response.statusCode < 400) return;
    let body = '';
    response.on('data', (chunk) => {
      if (body.length < 8000) body += chunk;
    });
    response.on('end', () => {
      let reason;
      try {
        reason = JSON.parse(body).error?.message;
      } catch {
        reason = body
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .slice(0, 600);
      }
      console.error(JSON.stringify({ status: response.statusCode, reason: safeReason(reason) }));
    });
  });
  return request;
};
let uploaded = false;
try {
  if (!process.argv.includes('--upload')) {
    console.log(
      'Cloudinary authentication:',
      (await cloudinary.api.ping({ timeout: 20000 })).status,
    );
  } else {
    const buffer = await sharp({
      create: { width: 400, height: 400, channels: 3, background: '#176b51' },
    })
      .webp({ quality: 85 })
      .toBuffer();
    const result = await uploadProfilePhoto(buffer, 'diagnostic', publicId);
    uploaded = true;
    console.log(
      'Cloudinary upload:',
      result.url && result.public_id ? 'ok' : 'incomplete response',
    );
  }
} catch (error) {
  const message =
    error instanceof PhotoStorageError
      ? error.message
      : safeReason(error.error?.message || error.message);
  console.error(
    JSON.stringify({
      operation: 'Cloudinary diagnostic',
      status: error.status || error.error?.http_code || error.http_code,
      message,
    }),
  );
  process.exitCode = 1;
} finally {
  if (uploaded) {
    try {
      await deleteProfilePhoto(publicId);
      console.log('Diagnostic image cleanup: ok');
    } catch {
      console.error('Diagnostic image cleanup failed. Remove asset:', publicId);
      process.exitCode = 1;
    }
  }
}
