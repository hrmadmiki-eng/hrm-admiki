import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  CalendarDays,
  Wallet,
  FileBarChart,
  ShieldCheck,
  Settings,
  ScrollText,
  UserRound,
  Menu,
  X,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { errorMessage } from '../lib/api';
import { dayjs } from '../lib/date';
import { Avatar } from './UI';
import NotificationBell from './NotificationBell';
import { NotificationProvider } from '../context/NotificationContext';
const managerNav = [
  ['/dashboard', 'Dashboard', LayoutDashboard],
  ['/employees', 'Employees', Users],
  ['/attendance', 'Attendance', CalendarCheck],
  ['/leave', 'Leave', CalendarDays],
  ['/payroll', 'Payroll', Wallet],
  ['/reports', 'Reports', FileBarChart],
];
const adminNav = [
  ['/users', 'User Management', ShieldCheck],
  ['/settings', 'Settings', Settings],
  ['/audit', 'Activity History', ScrollText],
];
const employeeNav = [
  ['/dashboard', 'Dashboard', LayoutDashboard],
  ['/profile', 'Profile', UserRound],
  ['/attendance', 'Attendance', CalendarCheck],
  ['/leave', 'Leave', CalendarDays],
  ['/payslip', 'Payslip', Wallet],
];
export default function Layout() {
  const { user } = useAuth();
  return (
    <NotificationProvider key={user._id}>
      <Workspace />
    </NotificationProvider>
  );
}
function Workspace() {
  const { user, logout } = useAuth();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const location = useLocation();
  const sidebar = useRef();
  const nav =
    user.role === 'Employee'
      ? employeeNav
      : [...managerNav, ...(user.role === 'Admin' ? adminNav : [])];
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar.current.querySelector('button')?.focus();
    const key = (e) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'Tab') {
        const items = [...sidebar.current.querySelectorAll('a,button:not(:disabled)')];
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0].focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);
  async function signOut() {
    setLoggingOut(true);
    try {
      await logout();
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setLoggingOut(false);
    }
  }
  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:bg-white focus:p-3"
      >
        Skip to content
      </a>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        ref={sidebar}
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-40 flex w-[244px] flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${open ? 'translate-x-0 visible' : '-translate-x-full invisible lg:visible'}`}
      >
        <div className="flex h-24 shrink-0 items-center gap-3 px-7">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-forest-700 text-2xl font-bold text-white">
            a<span className="text-emerald-200">.</span>
          </div>
          <Link to="/dashboard">
            <span className="text-2xl font-bold tracking-tight text-forest-900">
              admiki<span className="text-forest-600">.</span>
            </span>
          </Link>
          <button
            className="ml-auto lg:hidden"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-4 py-4">
          <p className="eyebrow mb-3 px-3">Workspace</p>
          <div className="space-y-1">
            {nav.map(([path, label, Icon], index) => (
              <div key={path}>
                {user.role === 'Admin' && index === 6 && (
                  <p className="eyebrow mb-3 mt-7 px-3">Administration</p>
                )}
                <NavLink
                  to={path}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition ${isActive ? 'bg-forest-50 text-forest-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'}`
                  }
                >
                  <Icon size={19} strokeWidth={1.7} />
                  {label}
                </NavLink>
              </div>
            ))}
          </div>
        </nav>
        <div className="border-t border-slate-100 p-4">
          <button
            disabled={loggingOut}
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50"
          >
            <LogOut size={17} />
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>
      <div className="lg:pl-[244px]">
        <header className="flex h-[76px] items-center justify-between gap-4 border-b border-slate-200/80 bg-white px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <button
              className="rounded p-1 lg:hidden"
              aria-label="Open menu"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Menu size={22} />
            </button>
            <p className="text-[13px] text-slate-500">
              Workspace <span className="mx-2 text-slate-300">/</span>
              <span className="font-medium text-slate-600">
                {location.pathname === '/notifications'
                  ? 'Notifications'
                  : nav.find((n) => location.pathname.startsWith(n[0]))?.[1] || 'Account'}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-6">
            <NotificationBell />
            <span className="hidden text-[13px] text-slate-500 xl:block">
              {dayjs().format('dddd, DD MMM YYYY')}
            </span>
            <Link
              to="/account"
              className="flex items-center gap-3 border-slate-100 sm:border-l sm:pl-6"
            >
              <Avatar name={user.name} size="sm" />
              <div className="hidden sm:block">
                <p className="max-w-40 truncate text-[13px] font-semibold">{user.name}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{user.role}</p>
              </div>
              <ChevronDown className="hidden text-slate-500 sm:block" size={14} />
            </Link>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[1600px] p-5 sm:p-8">
          <Outlet />
        </main>
        <footer className="flex flex-wrap justify-between gap-2 px-8 pb-6 text-[11px] text-slate-500">
          <span>© {dayjs().year()} admiki HRM</span>
          <span>Made for a better workday.</span>
        </footer>
      </div>
    </div>
  );
}
