import { leaveTypeLabel, statusLabel } from '../../../shared/language.mjs';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, CalendarDays, Check, X, Ban } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useResource } from '../hooks/useResource';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../lib/api';
import { dayjs, formatDate } from '../lib/date';
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
  Stat,
} from '../components/UI';
import EmployeePicker from '../components/EmployeePicker';
export default function Leave() {
  const { user } = useAuth();
  const manager = user.role !== 'Employee';
  const notify = useToast();
  const [params, setParams] = useSearchParams();
  const [ownStatus, setOwnStatus] = useState('');
  const status = manager ? params.get('status') || '' : ownStatus;
  const setStatus = (value) => {
    if (!manager) return setOwnStatus(value);
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set('status', value);
      else next.delete('status');
      return next;
    });
  };
  const [employee, setEmployee] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status]);
  const [month, setMonth] = useState('');
  const [modal, setModal] = useState(false);
  const [review, setReview] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    type: 'Casual',
    startDate: dayjs().format('YYYY-MM-DD'),
    endDate: dayjs().format('YYYY-MM-DD'),
    reason: '',
  });
  const resource = useResource('/leave', {
    ...(status ? { status } : {}),
    ...(employee ? { employee } : {}),
    ...(month ? { month } : {}),
    page,
  });
  const balance = useResource('/leave/balance');
  async function apply(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/leave', form);
      notify('Leave request sent');
      setModal(false);
      resource.reload();
      setForm({ ...form, reason: '' });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function decide(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.patch(`/leave/${review.record._id}/review`, {
        status: review.status,
        reviewNote: note,
      });
      notify(`Leave ${statusLabel(review.status).toLowerCase()}`);
      setReview(null);
      resource.reload();
      balance.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function cancelRequest() {
    setBusy(true);
    try {
      await api.patch(`/leave/${cancel._id}/cancel`);
      notify('Leave request cancelled');
      setCancel(null);
      resource.reload();
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  function openReview(record, status) {
    setReview({ record, status });
    setNote('');
    setError('');
  }
  return (
    <>
      <PageHeader
        title="Leave"
        description={
          manager
            ? 'See who wants leave and approve or decline their requests.'
            : 'Request leave and see how many paid days you have left.'
        }
      >
        <button
          className="btn-primary"
          onClick={() => {
            setError('');
            setModal(true);
          }}
        >
          <Plus size={16} />
          Request leave
        </button>
      </PageHeader>
      {balance.error ? (
        <ErrorState message={balance.error} retry={balance.reload} />
      ) : (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          {balance.data?.balances.map((b, i) => (
            <Stat
              key={b.type}
              label={`${leaveTypeLabel(b.type)} left`}
              value={`${b.remaining} days`}
              icon={CalendarDays}
              tone={i === 1 ? 'amber' : i === 2 ? 'blue' : 'green'}
              detail={`${b.used} of ${b.allowance} paid days used · ${balance.data.year}`}
            />
          ))}
        </div>
      )}
      <div className="card">
        <div className="grid items-end gap-4 border-b border-slate-100 p-5 sm:grid-cols-3">
          <Select
            label="Request decision"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All requests</option>
            {['Pending', 'Approved', 'Rejected', 'Cancelled'].map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
          <Input
            label="Month (optional)"
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setPage(1);
            }}
          />
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
              {
                key: 'type',
                label: 'Type of leave',
                render: (r) => (
                  <div>
                    {leaveTypeLabel(r.type)}
                    <p
                      className="mt-1 max-w-44 truncate text-xs text-slate-500"
                      title={r.reason}
                    >
                      {r.reason}
                    </p>
                  </div>
                ),
              },
              {
                key: 'dates',
                label: 'Date range',
                render: (r) => (
                  <div>
                    {formatDate(r.startDate)}
                    <p className="mt-1 text-xs text-slate-500">to {formatDate(r.endDate)}</p>
                  </div>
                ),
              },
              {
                key: 'days',
                label: 'Days',
                render: (r) => (
                  <div>
                    {r.workDates.length} workdays
                    {r.status === 'Approved' && (
                      <p className="mt-1 text-xs text-slate-500">
                        {r.paidDates.length} paid · {r.workDates.length - r.paidDates.length}{' '}
                        without pay
                      </p>
                    )}
                  </div>
                ),
              },
              {
                key: 'status',
                label: 'Status',
                render: (r) => (
                  <div>
                    <Badge>{r.status}</Badge>
                    {r.reviewNote && (
                      <p className="mt-1 max-w-40 truncate text-xs" title={r.reviewNote}>
                        {r.reviewNote}
                      </p>
                    )}
                  </div>
                ),
              },
              {
                key: 'actions',
                label: 'Actions',
                render: (r) => (
                  <div className="flex gap-2">
                    {r.status === 'Pending' && manager && r.employee?._id !== user.employee && (
                      <>
                        <button
                          aria-label={`Approve leave for ${r.employee?.name}`}
                          className="rounded bg-forest-50 p-1.5 text-forest-700"
                          onClick={() => openReview(r, 'Approved')}
                        >
                          <Check size={15} />
                        </button>
                        <button
                          aria-label={`Decline leave for ${r.employee?.name}`}
                          className="rounded bg-red-50 p-1.5 text-red-600"
                          onClick={() => openReview(r, 'Rejected')}
                        >
                          <X size={15} />
                        </button>
                      </>
                    )}
                    {r.status === 'Pending' && r.employee?._id === user.employee && (
                      <button className="text-[13px] text-slate-600" onClick={() => setCancel(r)}>
                        Cancel
                      </button>
                    )}
                    {r.status !== 'Pending' && (
                      <span className="text-[13px] text-slate-500">{r.reviewedBy?.name || '—'}</span>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
        <Pagination data={resource.data} page={page} setPage={setPage} />
      </div>
      <p className="mt-4 text-[13px] leading-5 text-slate-500">
        Leave counts workdays only. If you have no paid days left, extra days off are without pay
        when approved. All requested days must be in the same year. Your own request must be
        reviewed by another HR or Admin.
      </p>
      {modal && (
        <Modal title="Request leave" onClose={() => !busy && setModal(false)}>
          <form onSubmit={apply} className="space-y-4">
            <Select
              label="Type of leave"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              {['Casual', 'Sick', 'Annual', 'Unpaid'].map((t) => (
                <option key={t} value={t}>
                  {leaveTypeLabel(t)}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Start date"
                type="date"
                required
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
              <Input
                label="End date"
                type="date"
                required
                min={form.startDate}
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </div>
            <Textarea
              label="Reason"
              required
              minLength={3}
              maxLength={2000}
              placeholder="Let your team know why you need leave…"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
            <p className="rounded-lg bg-amber-50 p-3 text-[13px] leading-5 text-amber-800">
              If you have no paid days left, extra days off will reduce your pay.
            </p>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button className="btn-primary" disabled={busy}>
              {busy ? 'Submitting…' : 'Submit request'}
            </button>
          </form>
        </Modal>
      )}
      {review && (
        <Modal
          title={`${review.status === 'Approved' ? 'Approve' : 'Decline'} leave request`}
          onClose={() => !busy && setReview(null)}
        >
          <form onSubmit={decide} className="space-y-4">
            <p className="text-[15px] text-slate-600">
              <strong>{review.record.employee?.name}</strong> · {leaveTypeLabel(review.record.type)}{' '}
              · {review.record.workDates.length} workdays
            </p>
            <p className="rounded-lg bg-slate-50 p-3 text-[15px] leading-6">{review.record.reason}</p>
            {review.status === 'Approved' && (
              <p className="text-[13px] text-amber-700">
                If the employee has no paid days left, any extra days off will be without pay.
              </p>
            )}
            <Textarea
              label="Note about this decision"
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button
              className={review.status === 'Approved' ? 'btn-primary' : 'btn-danger'}
              disabled={busy}
            >
              {busy
                ? 'Saving…'
                : `Confirm ${review.status === 'Approved' ? 'approval' : 'declined request'}`}
            </button>
          </form>
        </Modal>
      )}
      {cancel && (
        <Modal title="Cancel leave request" onClose={() => !busy && setCancel(null)}>
          <p className="text-[15px] text-slate-600">
            Cancel your request for {formatDate(cancel.startDate)} to {formatDate(cancel.endDate)}?
          </p>
          <button className="btn-danger mt-6" disabled={busy} onClick={cancelRequest}>
            {busy ? 'Cancelling…' : 'Cancel request'}
          </button>
        </Modal>
      )}
    </>
  );
}
