import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, KeyRound, Mail } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Input } from '../components/UI';

export default function PasswordRecovery({ reset = false }) {
  const { setUser } = useAuth();
  const [token] = useState(() => (reset ? window.location.hash.slice(1) : ''));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const validToken = /^[a-f0-9]{64}$/.test(token);
  useEffect(() => {
    if (reset) window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [reset]);
  async function submit(event) {
    event.preventDefault();
    setError('');
    if (reset && password !== confirm) return setError('New passwords do not match');
    setBusy(true);
    try {
      const response = await api.post(
        reset ? '/auth/reset-password' : '/auth/forgot-password',
        reset ? { token, newPassword: password } : { email },
      );
      setMessage(response.data.message);
      if (reset) {
        setUser(null);
        setPassword('');
        setConfirm('');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-6 sm:p-10">
      <div className="w-full max-w-md">
        <Link to="/login" className="mb-8 inline-block text-2xl font-bold text-forest-700">
          admiki.
        </Link>
        <div className="card p-6 sm:p-8">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-forest-50 text-forest-700">
            {reset ? <KeyRound size={24} /> : <Mail size={24} />}
          </div>
          <h1 className="text-[1.65rem] font-semibold">
            {reset ? 'Reset password' : 'Forgot password?'}
          </h1>
          <p className="mb-6 mt-2 text-[15px] leading-6 text-slate-600">
            {reset
              ? 'Choose a new password for your account.'
              : 'Enter your account email and we’ll send you a link to reset your password.'}
          </p>
          {message ? (
            <div role="status" className="space-y-4">
              <p className="rounded-lg bg-forest-50 p-4 text-[15px] leading-6 text-forest-800">
                {message}
              </p>
              {!reset && (
                <p className="text-[15px] text-slate-600">
                  Check your inbox and spam folder. The link expires in 15 minutes. Use the newest
                  reset email.
                </p>
              )}
            </div>
          ) : reset && !validToken ? (
            <p role="alert" className="rounded-lg bg-red-50 p-4 text-[15px] text-red-700">
              This reset link is missing or invalid. Open the link from your email or request a new
              one.
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              {reset ? (
                <>
                  <Input
                    label="New password"
                    type="password"
                    required
                    minLength={4}
                    maxLength={72}
                    autoComplete="new-password"
                    hint="Employees: at least 4 characters. Admin/HR: at least 6 characters. Letters, numbers or symbols are allowed; no combination is required."
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <Input
                    label="Confirm new password"
                    type="password"
                    required
                    minLength={4}
                    maxLength={72}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </>
              ) : (
                <Input
                  label="Email address"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              )}
              {error && (
                <p role="alert" className="rounded-lg bg-red-50 p-3 text-[15px] text-red-700">
                  {error}
                </p>
              )}
              <button disabled={busy} className="btn-primary w-full">
                {busy ? 'Please wait…' : reset ? 'Reset password' : 'Send reset link'}
              </button>
            </form>
          )}
          {reset && !message && (
            <Link
              to="/forgot-password"
              className="mt-5 block text-[15px] font-semibold text-forest-700 hover:underline"
            >
              Request a new reset link
            </Link>
          )}
          <Link to="/login" className="btn-secondary mt-6 w-full">
            <ArrowLeft size={18} aria-hidden="true" /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
