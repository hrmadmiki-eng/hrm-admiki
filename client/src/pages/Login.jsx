import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Users, CalendarCheck, Wallet, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../lib/api';
import { Input } from '../components/UI';
export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  if (user) return <Navigate to={user.mustChangePassword ? '/account' : '/dashboard'} replace />;
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const user = await login(form);
      navigate(user.mustChangePassword ? '/account' : '/dashboard', {
        replace: true,
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-forest-900 p-14 text-white lg:flex">
        <div className="text-3xl font-bold tracking-tight">
          admiki<span className="text-emerald-300">.</span>
          <span className="ml-3 text-[11px] font-medium uppercase tracking-[.25em] text-emerald-100/60">
            HRM
          </span>
        </div>
        <div className="relative z-10 max-w-lg">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-[11px] font-medium uppercase tracking-widest text-emerald-100">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> A better everyday
          </span>
          <h1 className="text-5xl font-semibold leading-[1.15] tracking-tight xl:text-6xl">
            Great work starts
            <br />
            with your people.
          </h1>
          <p className="mt-6 max-w-sm text-[15px] leading-7 text-emerald-50/60">
            Keep employee details, work hours, leave, and pay together. Everything that makes your
            company work.
          </p>
          <div className="mt-10 flex gap-4">
            {[
              [Users, 'People'],
              [CalendarCheck, 'Attendance'],
              [Wallet, 'Pay'],
            ].map(([Icon, label]) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/5 px-5 py-4">
                <Icon size={21} className="mb-3 text-emerald-200" />
                <span className="text-[13px] text-emerald-50/70">{label}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[13px] text-emerald-100/40">Less administration. More possibilities.</p>
        <div className="pointer-events-none absolute -bottom-60 -right-64 h-[650px] w-[650px] rounded-full border-[80px] border-white/[.025]" />
      </div>
      <div className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-12 text-3xl font-bold text-forest-800 lg:hidden">admiki.</div>
          <span className="eyebrow text-forest-600">Welcome to your workspace</span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Good to see you again.</h2>
          <p className="mb-8 mt-3 text-[15px] text-slate-500">Sign in to get your workday started.</p>
          <form onSubmit={submit} className="space-y-5">
            <Input
              label="Email address"
              type="email"
              required
              autoComplete="username"
              placeholder="you@company.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <div className="relative">
              <Input
                label="Password"
                type={visible ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="pr-12"
              />
              <button
                type="button"
                className="absolute right-3 top-9 text-slate-500"
                aria-label={visible ? 'Hide password' : 'Show password'}
                onClick={() => setVisible((v) => !v)}
              >
                {visible ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-[13px] text-red-700">
                {error}
              </p>
            )}
            <div className="text-right">
              <Link
                to="/forgot-password"
                className="text-[15px] font-semibold text-forest-700 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <button disabled={busy} className="btn-primary w-full">
              {busy ? 'Signing in…' : 'Sign in'}
              <ArrowRight size={16} />
            </button>
          </form>
          <p className="mt-6 text-center text-[13px] text-slate-500">
            Need an account? Contact your Admin.
          </p>
          <div className="mt-12 flex items-center justify-center gap-2 border-t border-slate-100 pt-6 text-[11px] text-slate-500">
            <ShieldCheck size={14} /> Secure access to your employee workspace
          </div>
        </div>
      </div>
    </div>
  );
}
