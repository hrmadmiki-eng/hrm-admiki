import { useEffect, useState } from 'react';
import { statusLabel } from '../../../shared/language.mjs';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, Pencil, Archive, ArrowUpRight } from 'lucide-react';
import { useResource, useSearchPage } from '../hooks/useResource';
import { api, errorMessage } from '../lib/api';
import { passwordMinimum, passwordHint } from '../lib/password';
import { notifyPhotoChanged } from '../lib/photoEvents';
import { money, formatDate, dayjs } from '../lib/date';
import { useToast } from '../context/ToastContext';
import {
  PageHeader,
  Avatar,
  Badge,
  DataTable,
  Pagination,
  Modal,
  Input,
  Select,
  Textarea,
  ErrorState,
} from '../components/UI';
import Catalogs from './Catalogs';
export function EmployeeForm({ employee, onSaved, onClose }) {
  const departments = useResource('/departments');
  const designations = useResource('/designations');
  const notify = useToast();
  const [form, setForm] = useState({
    name: employee?.name || '',
    email: employee?.email || '',
    phone: employee?.phone || '',
    address: employee?.address || '',
    department: employee?.department?._id || '',
    designation: employee?.designation?._id || '',
    joiningDate: employee?.joiningDate || dayjs().format('YYYY-MM-DD'),
    salary: employee?.salary ?? '',
    status: employee?.status || 'Active',
    endDate: employee?.endDate || '',
    password: '',
  });
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {
        ...form,
        salary: Number(form.salary),
        department: form.department || null,
        designation: form.designation || null,
      };
      if (employee) delete payload.password;
      const response = employee
        ? await api.put(`/employees/${employee._id}`, payload)
        : await api.post('/employees', payload);
      if (photo) {
        try {
          const data = new FormData();
          data.append('photo', photo);
          await api.post(`/employees/${response.data.data._id}/photo`, data);
          notifyPhotoChanged(response.data.data._id);
        } catch (e) {
          notify(`Employee saved, but photo upload failed: ${errorMessage(e)}`, 'error');
        }
      }
      notify(employee ? 'Employee updated' : 'Employee and login account created');
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={employee ? 'Edit employee' : 'Add an employee'}
      onClose={() => !busy && onClose()}
      wide
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Full name"
            required
            maxLength={150}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
          <Input
            label="Email address"
            type="email"
            maxLength={254}
            required
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
          />
          <Input
            label="Phone number"
            type="tel"
            maxLength={30}
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
          <Input
            label="Start date"
            type="date"
            required
            value={form.joiningDate}
            onChange={(e) => set('joiningDate', e.target.value)}
          />
          <Select
            label="Department"
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value, designation: '' })}
          >
            <option value="">Not set</option>
            {departments.data?.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select
            label="Job title"
            value={form.designation}
            onChange={(e) => set('designation', e.target.value)}
          >
            <option value="">Not set</option>
            {designations.data
              ?.filter((d) => d.department?._id === form.department)
              .map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
          </Select>
          <Input
            label="Full-month salary"
            type="number"
            min="0"
            max="100000000"
            step="0.01"
            required
            value={form.salary}
            onChange={(e) => set('salary', e.target.value)}
          />
          <Select
            label="Status"
            value={form.status}
            onChange={(e) => set('status', e.target.value)}
          >
            {['Active', 'Inactive', 'Terminated'].map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
          {form.status !== 'Active' && (
            <Input
              label="Last day at work"
              type="date"
              required
              min={form.joiningDate}
              value={form.endDate}
              onChange={(e) => set('endDate', e.target.value)}
            />
          )}
          {!employee && (
            <Input
              label="Temporary login password"
              type="password"
              required
              minLength={passwordMinimum('Employee')}
              maxLength={72}
              autoComplete="new-password"
              hint={`${passwordHint('Employee')} Share privately. The employee must change it on first login.`}
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
            />
          )}
          <Input
            label="Profile photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hint="JPEG, PNG or WebP · up to 3 MB"
            onChange={(e) => setPhoto(e.target.files[0] || null)}
          />
        </div>
        <Textarea
          label="Address"
          maxLength={1000}
          value={form.address}
          onChange={(e) => set('address', e.target.value)}
        />
        {(departments.error || designations.error) && (
          <p role="alert" className="text-[13px] text-red-600">
            Could not load departments or job titles. Close this form and try again.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t pt-5">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={
              busy ||
              departments.loading ||
              designations.loading ||
              !!departments.error ||
              !!designations.error
            }
          >
            {busy ? 'Saving…' : employee ? 'Save changes' : 'Create employee'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export default function Employees() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'employees';
  const dashboardGroup = params.get('dashboard');
  const dashboardDate = params.get('date');
  const dashboardLabels = {
    active: 'Active team members',
    present: 'Present employees, including late arrivals',
    absent: 'Absent employees, excluding approved leave',
    'on-leave': 'Employees on approved leave',
  };
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const { query, page, setPage } = useSearchPage(search);
  useEffect(() => setPage(1), [dashboardGroup, dashboardDate]);
  const [editing, setEditing] = useState(null);
  const [archiving, setArchiving] = useState(null);
  const [busy, setBusy] = useState(false);
  const notify = useToast();

  const resource = useResource('/employees', {
    ...(dashboardGroup ? { dashboard: dashboardGroup } : {}),
    ...(dashboardDate ? { date: dashboardDate } : {}),
    search: query,
    ...(department ? { department } : {}),
    ...(status ? { status } : {}),
    page,
  });
  const departments = useResource('/departments');
  const company = useResource('/company');
  const close = () => {
    setEditing(null);
    if (params.has('new')) setParams(tab === 'employees' ? {} : { tab });
  };
  async function archive() {
    setBusy(true);
    try {
      await api.delete(`/employees/${archiving._id}`);
      notify('Employee removed from the current team');
      setArchiving(null);
      if (resource.data?.items.length === 1 && page > 1) setPage(page - 1);
      resource.reload();
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader title="Your people" description="Find employees and update their details.">
        {tab === 'employees' && (
          <button className="btn-primary" onClick={() => setEditing({})}>
            <Plus size={16} /> Add employee
          </button>
        )}
      </PageHeader>
      <div className="mb-6 flex gap-6 border-b border-slate-200">
        {[
          ['employees', 'All employees'],
          ['departments', 'Departments'],
          ['designations', 'Job titles'],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setParams(key === 'employees' ? {} : { tab: key })}
            className={`border-b-2 pb-3 text-[13px] font-semibold ${tab === key ? 'border-forest-700 text-forest-700' : 'border-transparent text-slate-500'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab !== 'employees' ? (
        <Catalogs
          key={tab}
          type={tab === 'departments' ? 'departments' : 'designations'}
          onChanged={() => {
            resource.reload();
            departments.reload();
          }}
        />
      ) : (
        <>
          {dashboardGroup && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-forest-50 p-4 text-[15px] text-forest-800">
              <p>
                {dashboardLabels[dashboardGroup] || 'Dashboard selection'}
                {dashboardDate && ` · ${formatDate(dashboardDate)}`}
              </p>
              <button
                className="btn-secondary"
                onClick={() => {
                  setParams({});
                  setSearch('');
                  setDepartment('');
                  setStatus('');
                  setPage(1);
                }}
              >
                Show all employees
              </button>
            </div>
          )}
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-5">
              <div className="relative min-w-48 flex-1">
                <label htmlFor="employee-search" className="sr-only">
                  Search employees
                </label>
                <Search size={16} className="absolute left-3 top-3 text-slate-500" />
                <input
                  id="employee-search"
                  placeholder="Search by name, email or employee ID…"
                  className="pl-9"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                  }}
                />
              </div>
              <select
                aria-label="Filter by department"
                className="w-auto"
                value={department}
                onChange={(e) => {
                  setDepartment(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All departments</option>
                {departments.data?.map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by status"
                className="w-auto"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                {['Active', 'Inactive', 'Terminated'].map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
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
                    label: 'Employee',
                    render: (e) => (
                      <Link to={`/employees/${e._id}`} className="flex items-center gap-3">
                        <Avatar name={e.name} employee={e._id} photo={e.photo} />
                        <div>
                          <p className="font-semibold text-slate-700">{e.name}</p>
                          <p className="mt-1 text-xs text-slate-500">{e.email}</p>
                        </div>
                      </Link>
                    ),
                  },
                  { key: 'employeeId', label: 'Employee ID' },
                  {
                    key: 'department',
                    label: 'Department',
                    render: (e) => (
                      <div>
                        {e.department?.name || 'Not set'}
                        <p className="mt-1 text-xs text-slate-500">
                          {e.designation?.name || '—'}
                        </p>
                      </div>
                    ),
                  },
                  { key: 'joiningDate', label: 'Joined', render: (e) => formatDate(e.joiningDate) },
                  { key: 'status', label: 'Status', render: (e) => <Badge>{e.status}</Badge> },
                  {
                    key: 'actions',
                    label: 'Actions',
                    render: (e) => (
                      <div className="flex gap-3">
                        <button
                          aria-label={`Edit ${e.name}`}
                          className="text-slate-500 hover:text-forest-700"
                          onClick={() => setEditing(e)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          aria-label={`Remove ${e.name}`}
                          className="text-slate-500 hover:text-red-600"
                          onClick={() => setArchiving(e)}
                        >
                          <Archive size={15} />
                        </button>
                        <Link
                          aria-label={`View ${e.name}`}
                          to={`/employees/${e._id}`}
                          className="text-slate-500 hover:text-forest-700"
                        >
                          <ArrowUpRight size={16} />
                        </Link>
                      </div>
                    ),
                  },
                ]}
                empty={{
                  title: 'No employees found',
                  description:
                    search || department || status
                      ? 'Try adjusting your search or filters.'
                      : 'Add your first employee to start building your team.',
                }}
              />
            )}
            <Pagination data={resource.data} page={page} setPage={setPage} />
          </div>
        </>
      )}
      {(editing || params.get('new') === '1') && (
        <EmployeeForm
          employee={editing?._id ? editing : null}
          onClose={close}
          onSaved={() => {
            close();
            resource.reload();
          }}
        />
      )}
      {archiving && (
        <Modal title="Remove from current team" onClose={() => !busy && setArchiving(null)}>
          <p className="text-[15px] leading-6 text-slate-600">
            Remove <strong>{archiving.name}</strong> from the current team? They will no longer be
            able to sign in. Their past attendance, leave, and pay records will be kept.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button className="btn-secondary" disabled={busy} onClick={() => setArchiving(null)}>
              Cancel
            </button>
            <button className="btn-danger" disabled={busy} onClick={archive}>
              {busy ? 'Removing…' : 'Remove from current team'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
