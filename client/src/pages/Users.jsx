import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, UserPlus, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useResource, useSearchPage } from '../hooks/useResource';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../lib/api';
import { passwordMinimum, passwordHint } from '../lib/password';
import {
  PageHeader,
  DataTable,
  Pagination,
  Badge,
  Modal,
  Input,
  Select,
  ErrorState,
  Avatar,
} from '../components/UI';
export default function Users() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const { query, page, setPage } = useSearchPage(search);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ role: 'Employee', active: true, password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const notify = useToast();

  const resource = useResource('/users', { search: query, page });
  function edit(record) {
    setEditing(record);
    setError('');
    setForm({ role: record.role, active: record.active, password: '' });
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.patch(`/users/${editing._id}`, {
        role: form.role,
        active: form.active,
        ...(form.password ? { password: form.password } : {}),
      });
      notify('Account updated. This person must sign in again.');
      setEditing(null);
      resource.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader title="Accounts" description="Choose who can sign in and what they can do.">
        <Link className="btn-primary" to="/employees?new=1">
          <UserPlus size={16} />
          Create employee account
        </Link>
      </PageHeader>
      <div className="mb-6 rounded-xl border border-forest-100 bg-forest-50 p-4 text-[13px] leading-6 text-forest-800">
        Adding an employee also creates their sign-in account. Choose HR or Admin access here. HR
        can manage employees and pay. Only Admins can change accounts and company settings or see
        activity history.
      </div>
      <div className="card">
        <div className="border-b border-slate-100 p-5">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-3 text-slate-500" size={16} />
            <input
              aria-label="Search users"
              className="pl-9"
              placeholder="Search users…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
          </div>
        </div>
        {resource.error ? (
          <ErrorState message={resource.error} retry={resource.reload} />
        ) : (
          <DataTable
            loading={resource.loading}
            rows={resource.data?.items}
            columns={[
              {
                key: 'name',
                label: 'User',
                render: (r) => (
                  <div className="flex items-center gap-3">
                    <Avatar name={r.name} />
                    <div>
                      <p className="font-medium">
                        {r.name}
                        {r._id === user._id && (
                          <span className="ml-2 text-[13px] text-slate-500">(you)</span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{r.email}</p>
                    </div>
                  </div>
                ),
              },
              {
                key: 'employee',
                label: 'Employee ID',
                render: (r) => r.employee?.employeeId || '—',
              },
              { key: 'role', label: 'Account type', render: (r) => <Badge>{r.role}</Badge> },
              {
                key: 'active',
                label: 'Access',
                render: (r) => <Badge>{r.active ? 'Active' : 'Inactive'}</Badge>,
              },
              {
                key: 'password',
                label: 'Password',
                render: (r) => (r.mustChangePassword ? 'Change required' : 'Personal password set'),
              },
              {
                key: 'actions',
                label: 'Actions',
                render: (r) => (
                  <button
                    disabled={r._id === user._id}
                    aria-label={`Manage ${r.name}`}
                    onClick={() => edit(r)}
                    className="text-slate-600"
                  >
                    <Pencil size={16} />
                  </button>
                ),
              },
            ]}
          />
        )}
        <Pagination data={resource.data} page={page} setPage={setPage} />
      </div>
      {editing && (
        <Modal title={`Manage ${editing.name}`} onClose={() => !busy && setEditing(null)}>
          <form onSubmit={save} className="space-y-5">
            <Select
              label="Account type"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {['Admin', 'HR', 'Employee'].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
            <Select
              label="Account access"
              value={String(form.active)}
              onChange={(e) => setForm({ ...form, active: e.target.value === 'true' })}
            >
              <option value="true">Active</option>
              <option value="false">Disabled</option>
            </Select>
            <Input
              label="Reset password (optional)"
              type="password"
              minLength={passwordMinimum(form.role)}
              maxLength={72}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              hint={`${passwordHint(form.role)} Leave blank to keep the current password. A reset requires the user to change it at their next login.`}
            />
            <p className="text-[13px] leading-5 text-amber-700">
              After saving, this person must sign in again on every device. Share a temporary
              password privately.
            </p>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save account'}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
