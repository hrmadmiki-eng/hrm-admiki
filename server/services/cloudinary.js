import { randomUUID } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { AppError } from '../utils/http.js';

let configuredFor;

export class PhotoStorageError extends AppError {}

function storageFailure(error, operation) {
  if (error instanceof PhotoStorageError) return error;
  const upstreamStatus = Number(error?.http_code || error?.error?.http_code) || undefined;
  let status = 502;
  let code = 'PHOTO_STORAGE_UNAVAILABLE';
  let message = 'Photo storage is temporarily unavailable. Please try again.';
  if (upstreamStatus === 403) {
    status = 503;
    code = 'PHOTO_STORAGE_PERMISSION_DENIED';
    message = `Photo storage denied the ${operation}. Ask an administrator to enable Cloudinary asset ${operation === 'upload' ? 'create/upload' : 'delete'} permissions.`;
  } else if (upstreamStatus === 401) {
    status = 503;
    code = 'PHOTO_STORAGE_AUTHENTICATION_FAILED';
    message = 'Photo storage authentication failed. Check the backend Cloudinary credentials.';
  } else if (upstreamStatus === 499 || ['ETIMEDOUT', 'ECONNRESET'].includes(error?.code)) {
    code = 'PHOTO_STORAGE_TIMEOUT';
    message = 'Photo storage did not respond in time. Please try again.';
  }
  // Provider messages may contain API keys, signatures, or signed request parameters.
  // Log only known categories and numeric status codes; never the raw error object.
  console.error('Cloudinary request failed:', { operation, upstreamStatus, code });
  const failure = new PhotoStorageError(status, message);
  failure.code = code;
  return failure;
}

function client() {
  const values = [
    process.env.CLOUDINARY_CLOUD_NAME,
    process.env.CLOUDINARY_API_KEY,
    process.env.CLOUDINARY_API_SECRET,
  ];
  if (values.some((value) => !value))
    throw new PhotoStorageError(
      503,
      'Photo storage is not configured. Check the backend Cloudinary credentials.',
    );

  const signature = values.join(':');
  if (configuredFor !== signature) {
    cloudinary.config({
      cloud_name: values[0],
      api_key: values[1],
      api_secret: values[2],
      secure: true,
    });
    configuredFor = signature;
  }
  return cloudinary;
}

export const profilePhotoId = (employeeId) =>
  `admiki-hrms/profile-pictures/${employeeId}-${randomUUID()}`;

export async function uploadProfilePhoto(
  buffer,
  employeeId,
  publicId = profilePhotoId(employeeId),
) {
  try {
    const result = await new Promise((resolve, reject) => {
      const stream = client().uploader.upload_stream(
        {
          resource_type: 'image',
          public_id: publicId,
          format: 'webp',
          overwrite: false,
          backup: false,
          timeout: 20000,
        },
        (error, uploaded) => (error ? reject(error) : resolve(uploaded)),
      );
      stream.on('error', reject);
      stream.end(buffer);
    });
    if (!result?.secure_url || !result?.public_id) throw new Error('Incomplete upload response');
    return { url: result.secure_url, public_id: result.public_id };
  } catch (error) {
    throw storageFailure(error, 'upload');
  }
}

export async function deleteProfilePhoto(publicId) {
  if (!publicId) return;
  try {
    const result = await client().uploader.destroy(publicId, {
      resource_type: 'image',
      invalidate: true,
      timeout: 20000,
    });
    if (!['ok', 'not found'].includes(result?.result))
      throw new Error('Cloudinary deletion failed');
  } catch (error) {
    throw storageFailure(error, 'delete');
  }
}
