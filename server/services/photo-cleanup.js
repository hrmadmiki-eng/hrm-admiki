import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from '../config/env.js';
import { Employee } from '../models/index.js';
import { deleteProfilePhoto } from './cloudinary.js';

// Persist cleanup alongside the employee change so outages/restarts cannot lose old assets.
export const PhotoCleanup = mongoose.model(
  'PhotoCleanup',
  new mongoose.Schema({
    publicId: String,
    filename: String,
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    attempts: { type: Number, default: 0 },
  }),
  'admiki_photo_cleanup',
);

export async function queuePhotoDeletion(photo, session, delay = 0) {
  if (!photo) return null;
  const target =
    typeof photo === 'string' ? { filename: path.basename(photo) } : { publicId: photo.public_id };
  const [job] = await PhotoCleanup.create(
    [{ ...target, nextAttemptAt: new Date(Date.now() + delay) }],
    { session },
  );
  return job._id;
}

export async function processPhotoDeletion(id) {
  if (!id) return true;
  try {
    // A lease prevents API requests and workers from processing the same job together.
    const job = await PhotoCleanup.findOneAndUpdate(
      { _id: id, nextAttemptAt: { $lte: new Date() } },
      { $set: { nextAttemptAt: new Date(Date.now() + 60000) }, $inc: { attempts: 1 } },
      { new: true },
    );
    if (!job) return !(await PhotoCleanup.exists({ _id: id }));
    const referenced = await Employee.exists(
      job.publicId ? { 'photo.public_id': job.publicId } : { photo: job.filename },
    );
    // Also protects uploads if a transaction committed but its acknowledgement was lost.
    if (!referenced) {
      if (job.publicId) await deleteProfilePhoto(job.publicId);
      else if (job.filename) {
        await fs
          .unlink(path.join(root, 'server/uploads', path.basename(job.filename)))
          .catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          });
      }
    }
    await PhotoCleanup.deleteOne({ _id: job._id });
    return true;
  } catch {
    // Do not leak provider errors or misreport an already committed employee change as failed.
    console.warn('Photo cleanup deferred; the persisted job will be retried.');
    return false;
  }
}

export async function drainPhotoCleanup() {
  const jobs = await PhotoCleanup.find({ nextAttemptAt: { $lte: new Date() } })
    .sort({ nextAttemptAt: 1 })
    .limit(100)
    .select('_id');
  for (const job of jobs) await processPhotoDeletion(job._id);
}

export function startPhotoCleanup() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await drainPhotoCleanup();
    } catch {
      console.warn('Photo cleanup unavailable; retrying on the next interval.');
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(run, 60000);
  timer.unref();
  return () => clearInterval(timer);
}
