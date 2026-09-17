import test from 'node:test';
import assert from 'node:assert/strict';
import { v2 as cloudinary } from 'cloudinary';
import { deleteProfilePhoto, PhotoStorageError } from '../services/cloudinary.js';

process.env.CLOUDINARY_CLOUD_NAME = 'isolated-test-cloud';
process.env.CLOUDINARY_API_KEY = 'isolated-test-key';
process.env.CLOUDINARY_API_SECRET = 'isolated-test-secret';

for (const [http_code, status, code, message] of [
  [401, 503, 'PHOTO_STORAGE_AUTHENTICATION_FAILED', /credentials/],
  [403, 503, 'PHOTO_STORAGE_PERMISSION_DENIED', /asset delete permissions/],
  [499, 502, 'PHOTO_STORAGE_TIMEOUT', /respond in time/],
  [500, 502, 'PHOTO_STORAGE_UNAVAILABLE', /temporarily unavailable/],
]) {
  test(`Cloudinary ${http_code} is classified safely`, async (t) => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(cloudinary.uploader, 'destroy', async () => {
      throw { http_code, message: 'private-provider-details' };
    });
    await assert.rejects(deleteProfilePhoto('test-photo'), (error) => {
      assert.ok(error instanceof PhotoStorageError);
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      assert.match(error.message, message);
      assert.ok(!error.message.includes('private-provider-details'));
      return true;
    });
  });
}
