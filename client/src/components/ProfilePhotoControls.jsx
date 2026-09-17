import { useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { notifyPhotoChanged } from '../lib/photoEvents';
import { useToast } from '../context/ToastContext';
import { Modal } from './UI';

export default function ProfilePhotoControls({ employee }) {
  const input = useRef();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const notify = useToast();
  async function upload(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 3 * 1024 * 1024
    ) {
      setError('Choose a JPEG, PNG or WebP image up to 3 MB.');
      return;
    }
    setBusy(true);
    try {
      const data = new FormData();
      data.append('photo', file);
      await api.post(`/employees/${employee._id}/photo`, data);
      notify('Profile picture updated');
      notifyPhotoChanged(employee._id);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError('');
    try {
      const response = await api.delete(`/employees/${employee._id}/photo`);
      setConfirming(false);
      notify(response.data.message);
      notifyPhotoChanged(employee._id);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-4 space-y-2">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Choose profile picture"
        className="sr-only"
        disabled={busy}
        onChange={upload}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => input.current.click()}
        >
          <Camera size={15} />{' '}
          {busy ? 'Updating picture...' : employee.photo ? 'Change picture' : 'Add picture'}
        </button>
        {employee.photo && (
          <button
            type="button"
            className="btn-secondary text-red-600"
            disabled={busy}
            onClick={() => {
              setError('');
              setConfirming(true);
            }}
          >
            <Trash2 size={15} /> Delete picture
          </button>
        )}
      </div>
      <p className="text-[13px] text-slate-500">JPEG, PNG or WebP, up to 3 MB.</p>
      {error && !confirming && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {confirming && (
        <Modal
          title="Delete profile picture?"
          onClose={() => {
            if (!busy) setConfirming(false);
          }}
        >
          <p className="text-[15px] text-slate-600">
            This will remove the picture from the app and delete its stored image. Your initials
            will appear instead.
          </p>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary bg-red-600 hover:bg-red-700"
              disabled={busy}
              onClick={remove}
            >
              {busy ? 'Deleting...' : 'Delete picture'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
