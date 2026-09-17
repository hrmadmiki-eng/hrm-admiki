import { useState } from 'react';
import { Clock3, LogIn, LogOut, Plus, Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useResource } from '../hooks/useResource';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../lib/api';
import { dayjs, formatDate, formatTime, officeTime } from '../lib/date';
import {
  PageHeader,
  DataTable,
  Pagination,
  Badge,
  Modal,
  Input,
  Select,
  Textarea,
  ErrorState,
  Spinner,
} from '../components/UI';
import EmployeePicker from '../components/EmployeePicker';
export default function Attendance() {
  const { user } = useAuth();
  const manager = user.role !== 'Employee';
  const notify = useToast();
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const [selectedDate, setSelectedDate] = useState('');
  const [status, setStatus] = useState('');
  const [employee, setEmployee] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    employee: '',
    date: dayjs().format('YYYY-MM-DD'),
    status: 'Present',
    checkIn: '09:00',
    checkOut: '',
    notes: '',
  });
  const current = useResource('/attendance/today');
  const resource = useResource('/attendance', {
    ...(selectedDate ? { startDate: selectedDate, endDate: selectedDate } : { month }),
    ...(status ? { status } : {}),
    ...(employee ? { employee } : {}),
    page,
  });
  async function check(action) {
    setBusy(true);
    try {
      await api.post(`/attendance/${action}`);
      notify(
        action === 'check-in'
          ? 'You’re checked in. Have a good workday!'
          : 'You’re checked out. See you next time!',
      );
      current.reload();
      resource.reload();
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function manual(e) {
    e.preventDefault();
    if (!form.employee) return setError('Select an employee');
    setBusy(true);
    setError('');
    try {
      await api.put('/attendance/manual', form);
      notify('Attendance saved');
      setModal(false);
      resource.reload();
      current.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Attendance"
        description={
          manager
            ? 'See when employees arrived, left, or missed work.'
            : 'See when you arrived, left, and how long you worked.'
        }
      >
        {manager && (
          <>
            <Link className="btn-secondary" to="/reports?type=attendance">
              <Download size={15} />
              Monthly report
            </Link>
            <button
              className="btn-primary"
              onClick={() => {
                setError('');
                setModal(true);
              }}
            >
              <Plus size={16} />
              Add or correct attendance
            </button>
          </>
        )}
      </PageHeader>
      <div className="card mb-6 p-6">
        {current.loading ? (
          <Spinner />
        ) : current.error ? (
          <ErrorState message={current.error} retry={current.reload} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex items-center gap-4">
              <div className="rounded-xl bg-forest-50 p-3 text-forest-700">
                <Clock3 size={27} />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold">
                  Your attendance today{' '}
                  <span className="ml-2 text-[13px] font-normal text-slate-500">
                    {formatDate(current.data.date)}
                  </span>
                </h2>
                <p className="mt-2 text-[13px] text-slate-500">
                  Office hours {officeTime(current.data.officeStart)} –{' '}
                  {officeTime(current.data.officeEnd)} · {current.data.timezone}
                </p>
                <div className="mt-3 flex flex-wrap gap-3 text-[13px] text-slate-600">
                  <span>
                    In:{' '}
                    <strong>
                      {formatTime(current.data.attendance?.checkIn, current.data.timezone)}
                    </strong>
                  </span>
                  <span>
                    Out:{' '}
                    <strong>
                      {formatTime(current.data.attendance?.checkOut, current.data.timezone)}
                    </strong>
                  </span>
                  {current.data.attendance && <Badge>{current.data.attendance.status}</Badge>}
                </div>
              </div>
            </div>
            {current.data.onLeave ? (
              <Badge>Leave</Badge>
            ) : !current.data.isWorkday ? (
              <Badge>Holiday</Badge>
            ) : current.data.attendance?.checkOut ? (
              <Badge>Workday complete</Badge>
            ) : current.data.attendance && !current.data.attendance.checkIn ? (
              <Badge>{current.data.attendance.status}</Badge>
            ) : (
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => check(current.data.attendance?.checkIn ? 'check-out' : 'check-in')}
              >
                {current.data.attendance?.checkIn ? <LogOut size={16} /> : <LogIn size={16} />}
                {busy ? 'Updating…' : current.data.attendance?.checkIn ? 'Check out' : 'Check in'}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="card">
        <div className="grid items-end gap-4 border-b border-slate-100 p-5 sm:grid-cols-3">
          <Input
            label="Month"
            type="month"
            required
            value={month}
            onChange={(e) => {
              if (e.target.value) {
                setMonth(e.target.value);
                setSelectedDate('');
                setPage(1);
              }
            }}
          />
          <Input
            label="Single day (optional)"
            type="date"
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              setPage(1);
            }}
          />
          <Select
            label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {['Present', 'Late', 'Absent', 'Holiday'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          {manager && (
            <EmployeePicker
              includeArchived
              value={employee}
              onChange={(id) => {
                setEmployee(id);
                setPage(1);
              }}
            />
          )}
        </div>
        {resource.error ? (
          <ErrorState message={resource.error} retry={resource.reload} />
        ) : (
          <DataTable
            loading={resource.loading}
            rows={resource.data?.items}
            columns={[
              ...(manager
                ? [
                    {
                      key: 'employee',
                      label: 'Employee',
                      render: (r) => (
                        <div>
                          {r.employee?.name}
                          <p className="mt-1 text-xs text-slate-500">
                            {r.employee?.employeeId}
                          </p>
                        </div>
                      ),
                    },
                  ]
                : []),
              { key: 'date', label: 'Date', render: (r) => formatDate(r.date) },
              {
                key: 'checkIn',
                label: 'Check-in',
                render: (r) => formatTime(r.checkIn, current.data?.timezone),
              },
              {
                key: 'checkOut',
                label: 'Check-out',
                render: (r) => formatTime(r.checkOut, current.data?.timezone),
              },
              {
                key: 'hours',
                label: 'Hours',
                render: (r) =>
                  r.checkIn && r.checkOut
                    ? `${(dayjs(r.checkOut).diff(dayjs(r.checkIn), 'minute') / 60).toFixed(1)} h`
                    : '—',
              },
              { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
              {
                key: 'source',
                label: 'Added by',
                render: (r) => (r.source === 'Self' ? 'Employee' : 'Admin or HR'),
              },
            ]}
          />
        )}
        <Pagination data={resource.data} page={page} setPage={setPage} />
      </div>
      <p className="mt-4 text-[13px] leading-5 text-slate-500">
        This list shows saved attendance only. Reports and pay calculations also include days
        without a check-in, weekly days off, holidays, and approved leave.
      </p>
      {modal && (
        <Modal title="Add or correct attendance" onClose={() => !busy && setModal(false)}>
          <form onSubmit={manual} className="space-y-4">
            <EmployeePicker
              includeArchived
              required
              value={form.employee}
              onChange={(employee) => setForm({ ...form, employee })}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Date"
                type="date"
                required
                max={current.data?.date}
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
              <Select
                label="Status"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {['Present', 'Late', 'Absent', 'Holiday'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
              {['Present', 'Late'].includes(form.status) && (
                <>
                  <Input
                    label="Check-in"
                    type="time"
                    required
                    value={form.checkIn}
                    onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
                  />
                  <Input
                    label="Check-out"
                    type="time"
                    value={form.checkOut}
                    onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
                  />
                </>
              )}
            </div>
            <p className="text-[13px] text-slate-500">
              Times use {current.data?.timezone || 'the company timezone'}. Saving replaces any
              existing entry for this date.
            </p>
            <Textarea
              label="Notes"
              maxLength={1000}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save attendance'}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
