import { leaveTypeLabel, statusLabel } from '../../../shared/language.mjs';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useResource } from '../hooks/useResource';
import { api, errorMessage } from '../lib/api';
import { formatDate } from '../lib/date';
import { PageHeader, Badge, Spinner, ErrorState, Modal, Textarea } from '../components/UI';

export default function LeaveRequest() {
  const { id } = useParams();
  const { user } = useAuth();
  const resource = useResource(`/leave/${id}`);
  const toast = useToast();
  const [action, setAction] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const leave = resource.data;
  const own = leave?.employee?._id === user.employee;
  function openAction(next) {
    setAction(next);
    setNote('');
    setError('');
  }
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.patch(
        `/leave/${id}/${action === 'Cancelled' ? 'cancel' : 'review'}`,
        action === 'Cancelled' ? {} : { status: action, reviewNote: note },
      );
      toast(`Leave request ${statusLabel(action).toLowerCase()}`);
      setAction(null);
      resource.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link to="/leave" className="btn-secondary mb-6">
        <ArrowLeft size={18} aria-hidden="true" /> Back to leave requests
      </Link>
      <PageHeader title="Leave request" description="Request details and review status." />
      {resource.loading ? (
        <Spinner />
      ) : resource.error ? (
        <ErrorState message={resource.error} retry={resource.reload} />
      ) : (
        leave && (
          <div className="card space-y-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{leave.employee?.name || 'Employee'}</h2>
                <p className="mt-1 text-[13px] text-slate-600">{leave.employee?.employeeId}</p>
              </div>
              <Badge>{leave.status}</Badge>
            </div>
            <dl className="grid gap-5 text-[15px] sm:grid-cols-3">
              <div>
                <dt className="text-slate-600">Type of leave</dt>
                <dd className="mt-1 font-medium">{leaveTypeLabel(leave.type)}</dd>
              </div>
              <div>
                <dt className="text-slate-600">Date range</dt>
                <dd className="mt-1 font-medium">
                  {formatDate(leave.startDate)} to {formatDate(leave.endDate)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-600">Workdays</dt>
                <dd className="mt-1 font-medium">
                  {leave.workDates.length}
                  {leave.status === 'Approved' &&
                    ` (${leave.paidDates.length} with pay, ${leave.workDates.length - leave.paidDates.length} without pay)`}
                </dd>
              </div>
            </dl>
            <div>
              <h3 className="text-[15px] font-semibold">Reason</h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-[15px] text-slate-600">
                {leave.reason}
              </p>
            </div>
            {leave.reviewedBy && (
              <p className="text-[15px] text-slate-600">Reviewed by {leave.reviewedBy.name}</p>
            )}
            {leave.reviewNote && (
              <div>
                <h3 className="text-[15px] font-semibold">Note about this decision</h3>
                <p className="mt-2 whitespace-pre-wrap break-words text-[15px] text-slate-600">
                  {leave.reviewNote}
                </p>
              </div>
            )}
            {leave.status === 'Pending' && (
              <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-5">
                {own ? (
                  <button className="btn-secondary" onClick={() => openAction('Cancelled')}>
                    Cancel request
                  </button>
                ) : (
                  ['Admin', 'HR'].includes(user.role) && (
                    <>
                      <button className="btn-primary" onClick={() => openAction('Approved')}>
                        <Check size={18} /> Approve leave
                      </button>
                      <button className="btn-danger" onClick={() => openAction('Rejected')}>
                        <X size={18} /> Decline leave
                      </button>
                    </>
                  )
                )}
              </div>
            )}
          </div>
        )
      )}
      {action && (
        <Modal
          title={
            action === 'Cancelled'
              ? 'Cancel leave request'
              : `${action === 'Approved' ? 'Approve' : 'Decline'} leave request`
          }
          onClose={() => !busy && setAction(null)}
        >
          <form onSubmit={submit} className="space-y-4">
            {action === 'Cancelled' ? (
              <p className="text-[15px] text-slate-600">Cancel this pending leave request?</p>
            ) : (
              <>
                {action === 'Approved' && (
                  <p className="text-[15px] text-amber-700">
                    If the employee has no paid days left, any extra days off will be without pay.
                  </p>
                )}
                <Textarea
                  label="Note about this decision"
                  maxLength={1000}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button
              className={action === 'Approved' ? 'btn-primary' : 'btn-danger'}
              disabled={busy}
            >
              {busy
                ? 'Saving…'
                : `Confirm ${action === 'Approved' ? 'approval' : action === 'Rejected' ? 'declined request' : 'cancellation'}`}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
