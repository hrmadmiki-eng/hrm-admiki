import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../lib/api';
import { PageHeader, Input, Avatar, Badge } from '../components/UI';
import { useResource } from '../hooks/useResource';
import ProfilePhotoControls from '../components/ProfilePhotoControls';
import { passwordMinimum, passwordHint } from '../lib/password';
export default function Account() {
  const { user, setUser, logout } = useAuth();
  const profile = useResource(user.employee && !user.mustChangePassword ? '/employees/me' : null);
  const notify = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirm: '',
  });
  const [busy, setBusy] = useState(false);
  const [changingPassword, setChangingPassword] = useState(true);
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setError('New passwords do not match');
    setBusy(true);
    setError('');
    try {
      const res = await api.put('/auth/password', form);
      setUser(res.data.data);
      notify('Password changed successfully');
      if (user.mustChangePassword) navigate('/dashboard');
      else setChangingPassword(false);
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {!user.mustChangePassword && (
        <div className="mb-6">
          <button
            type="button"
            className="btn-primary min-h-11 gap-3 px-5 shadow-sm"
            disabled={busy}
            onClick={() => navigate('/dashboard')}
          >
            <ArrowLeft size={20} strokeWidth={2} aria-hidden="true" /> Back to home
          </button>
        </div>
      )}
      <PageHeader
        title={user.mustChangePassword ? 'Set your own password' : 'Your account'}
        description={
          user.mustChangePassword
            ? 'Replace your temporary password before opening your workspace.'
            : 'Keep your account details and access secure.'
        }
      />
      <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
        <div className="card self-start p-6">
          <Avatar
            name={user.name}
            employee={profile.data?._id}
            photo={profile.data?.photo}
            size="lg"
          />
          {profile.data && <ProfilePhotoControls employee={profile.data} />}
          <h2 className="mb-1 mt-4 font-semibold">{user.name}</h2>
          <p className="mb-4 break-all text-[15px] text-slate-500">{user.email}</p>
          <Badge>{user.role}</Badge>
          <button
            className="mt-6 flex items-center gap-2 text-[13px] text-slate-600"
            onClick={async () => {
              try {
                await logout();
              } catch (e) {
                notify(errorMessage(e), 'error');
              }
            }}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
        {changingPassword || user.mustChangePassword ? (
          <form onSubmit={submit} className="card space-y-5 p-6">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <KeyRound size={18} className="text-forest-700" /> Change password
            </h2>
            <Input
              label="Current password"
              type="password"
              required
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
            />
            <Input
              label="New password"
              type="password"
              required
              minLength={passwordMinimum(user.role)}
              maxLength={72}
              autoComplete="new-password"
              hint={passwordHint(user.role)}
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            />
            <Input
              label="Confirm new password"
              type="password"
              required
              minLength={passwordMinimum(user.role)}
              autoComplete="new-password"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            />
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </form>
        ) : (
          <div className="card self-start space-y-4 p-6">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <KeyRound size={18} className="text-forest-700" /> Account security
            </h2>
            <p className="text-[15px] text-slate-600">
              Manage your password to keep your account secure.
            </p>
            <button className="btn-primary" onClick={() => setChangingPassword(true)}>
              Change password
            </button>
          </div>
        )}
      </div>
    </>
  );
}
