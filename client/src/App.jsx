import { lazy, Suspense, Component } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { Spinner, ErrorState } from './components/UI';
import Layout from './components/Layout';
const Login = lazy(() => import('./pages/Login'));
const PasswordRecovery = lazy(() => import('./pages/PasswordRecovery'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Employees = lazy(() => import('./pages/Employees'));
const Profile = lazy(() => import('./pages/Profile'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Leave = lazy(() => import('./pages/Leave'));
const Payroll = lazy(() => import('./pages/Payroll'));
const Reports = lazy(() => import('./pages/Reports'));
const Users = lazy(() => import('./pages/Users'));
const Settings = lazy(() => import('./pages/Settings'));
const Audit = lazy(() => import('./pages/Audit'));
const Account = lazy(() => import('./pages/Account'));
const Notifications = lazy(() => import('./pages/Notifications'));
const LeaveRequest = lazy(() => import('./pages/LeaveRequest'));
function Protected({ roles, account = false }) {
  const { user, loading, error, refresh } = useAuth();
  if (loading) return <Spinner full />;
  if (error)
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorState message={error} retry={refresh} />
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword && !account) return <Navigate to="/account" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
class ErrorBoundary extends Component {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="mx-auto max-w-xl p-10">
        <ErrorState
          message="The page could not be displayed. Reload to try again."
          retry={() => window.location.reload()}
        />
      </div>
    ) : (
      this.props.children
    );
  }
}
function LoginRoute() {
  const { loading } = useAuth();
  return loading ? <Spinner full /> : <Login />;
}
export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <Suspense fallback={<Spinner full />}>
              <Routes>
                <Route path="/login" element={<LoginRoute />} />
                <Route path="/forgot-password" element={<PasswordRecovery key="forgot" />} />
                <Route path="/reset-password" element={<PasswordRecovery key="reset" reset />} />
                <Route element={<Protected account />}>
                  <Route
                    path="/account"
                    element={
                      <div className="mx-auto max-w-5xl p-6 sm:p-10">
                        <Link
                          className="mb-6 inline-block text-xl font-bold text-forest-700"
                          to="/dashboard"
                        >
                          admiki.
                        </Link>
                        <Account />
                      </div>
                    }
                  />
                </Route>
                <Route element={<Protected />}>
                  <Route element={<Layout />}>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="dashboard" element={<Dashboard />} />
                    <Route path="notifications" element={<Notifications />} />
                    <Route path="attendance" element={<Attendance />} />
                    <Route path="leave" element={<Leave />} />
                    <Route path="leave/:id" element={<LeaveRequest />} />
                    <Route element={<Protected roles={['Employee']} />}>
                      <Route path="profile" element={<Profile />} />
                      <Route path="payslip" element={<Payroll />} />
                    </Route>
                    <Route element={<Protected roles={['Admin', 'HR']} />}>
                      <Route path="employees" element={<Employees />} />
                      <Route path="employees/:id" element={<Profile />} />
                      <Route path="payroll" element={<Payroll />} />
                      <Route path="reports" element={<Reports />} />
                    </Route>
                    <Route element={<Protected roles={['Admin']} />}>
                      <Route path="users" element={<Users />} />
                      <Route path="settings" element={<Settings />} />
                      <Route path="audit" element={<Audit />} />
                    </Route>
                    <Route
                      path="*"
                      element={
                        <div className="card p-10 text-center">
                          <h1 className="text-2xl font-semibold">Page not found</h1>
                          <Link to="/dashboard" className="btn-primary mt-6">
                            Go to dashboard
                          </Link>
                        </div>
                      }
                    />
                  </Route>
                </Route>
              </Routes>
            </Suspense>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
