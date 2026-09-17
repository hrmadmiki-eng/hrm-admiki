import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Download, CheckCircle2, Eye } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useResource } from '../hooks/useResource';
import { useToast } from '../context/ToastContext';
import { api, errorMessage, download } from '../lib/api';
import { dayjs, money, formatDate } from '../lib/date';
import {
  PageHeader,
  DataTable,
  Pagination,
  Badge,
  Modal,
  Input,
  Select,
  ErrorState,
} from '../components/UI';
import EmployeePicker from '../components/EmployeePicker';
export default function Payroll() {
  const { user } = useAuth();
  const manager = user.role !== 'Employee';
  const notify = useToast();
  const [params, setParams] = useSearchParams();
  const [ownMonth, setOwnMonth] = useState('');
  const month = manager ? params.get('month') || '' : ownMonth;
  const currency = manager ? params.get('currency') || '' : '';
  const setFilter = (key, value) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  const setMonth = (value) => (manager ? setFilter('month', value) : setOwnMonth(value));
  const [employee, setEmployee] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [month, currency]);
  const [modal, setModal] = useState(false);
  const [detail, setDetail] = useState(null);
  const [paying, setPaying] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    month: dayjs().subtract(1, 'month').format('YYYY-MM'),
    employee: '',
    allowance: 0,
    bonus: 0,
    deduction: 0,
  });
  const resource = useResource('/payroll', {
    ...(currency ? { currency } : {}),
    ...(month ? { month } : {}),
    ...(employee ? { employee } : {}),
    page,
  });
  async function generate(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/payroll/generate', {
        ...form,
        allowance: Number(form.allowance),
        bonus: Number(form.bonus),
        deduction: Number(form.deduction),
      });
      notify(res.data.message);
      setModal(false);
      setMonth(form.month);
      setEmployee(form.employee);
      setPage(1);
      resource.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function exportSlip(record, format) {
    setBusy(true);
    try {
      await download(
        `/payroll/${record._id}/payslip`,
        { format },
        `payslip-${record.employeeCode}-${record.month}.${format === 'pdf' ? 'pdf' : 'xlsx'}`,
      );
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function paid() {
    setBusy(true);
    try {
      await api.patch(`/payroll/${paying._id}/paid`);
      notify('Payment saved');
      setPaying(null);
      resource.reload();
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title={manager ? 'Pay' : 'Your pay details'}
        description={
          manager
            ? 'Prepare monthly pay and keep track of payments.'
            : 'Your monthly salary and payment details, all in one place.'
        }
      >
        {manager && (
          <button
            className="btn-primary"
            onClick={() => {
              setError('');
              setModal(true);
            }}
          >
            <Plus size={16} />
            Prepare pay
          </button>
        )}
      </PageHeader>
      <div className="card">
        <div className="grid items-end gap-4 border-b border-slate-100 p-5 sm:grid-cols-3">
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
            <Select
              label="Currency"
              value={currency}
              onChange={(e) => setFilter('currency', e.target.value)}
            >
              <option value="">All pay (BDT)</option>
              {['BDT'].map((code) => (
                <option key={code} value={code}>
                  {code} (৳)
                </option>
              ))}
            </Select>
          )}
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
                      key: 'employeeName',
                      label: 'Employee',
                      render: (r) => (
                        <div>
                          {r.employeeName}
                          <p className="mt-1 text-xs text-slate-500">{r.employeeCode}</p>
                        </div>
                      ),
                    },
                  ]
                : []),
              {
                key: 'month',
                label: 'Month',
                render: (r) => dayjs(`${r.month}-01`).format('MMM YYYY'),
              },
              {
                key: 'basic',
                label: 'Base pay for this month',
                render: (r) => money(r.basic, r.currency),
              },
              {
                key: 'deductions',
                label: 'Pay reductions',
                render: (r) => money(r.deduction + r.attendanceDeduction, r.currency),
              },
              {
                key: 'netSalary',
                label: 'Final pay',
                render: (r) => (
                  <span className="font-semibold text-slate-700">
                    {money(r.netSalary, r.currency)}
                  </span>
                ),
              },
              {
                key: 'status',
                label: 'Payment',
                render: (r) => <Badge>{r.paidAt ? 'Paid' : 'Unpaid'}</Badge>,
              },
              {
                key: 'actions',
                label: 'Actions',
                render: (r) => (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setDetail(r)}
                      aria-label={`View pay details for ${r.month}`}
                    >
                      <Eye size={16} />
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => exportSlip(r, 'pdf')}
                      aria-label={`Download pay details PDF for ${r.month}`}
                      className="text-forest-700"
                    >
                      <Download size={16} />
                    </button>
                    {manager && !r.paidAt && (
                      <button
                        aria-label={`Mark ${r.employeeName}'s pay as paid`}
                        className="text-forest-700"
                        onClick={() => setPaying(r)}
                      >
                        <CheckCircle2 size={16} />
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
            empty={{
              title: 'No pay details found',
              description: manager
                ? 'Choose a past month and prepare pay to see the details here.'
                : 'Your pay details will appear here after HR prepares them.',
            }}
          />
        )}
        <Pagination data={resource.data} page={page} setPage={setPage} />
      </div>
      {manager && (
        <p className="mt-4 text-[13px] leading-5 text-slate-500">
          Saving monthly pay keeps the amounts fixed. You can no longer change attendance or time
          off for that employee and month. Mark a payment as paid only after paying the employee.
        </p>
      )}
      {modal && (
        <Modal title="Prepare monthly pay" onClose={() => !busy && setModal(false)}>
          <form onSubmit={generate} className="space-y-4">
            <Input
              label="Completed month"
              type="month"
              required
              max={dayjs().subtract(1, 'month').format('YYYY-MM')}
              value={form.month}
              onChange={(e) => setForm({ ...form, month: e.target.value })}
            />
            <EmployeePicker
              includeArchived
              value={form.employee}
              onChange={(employee) => setForm({ ...form, employee })}
            />
            <div className="grid grid-cols-3 gap-3">
              {['allowance', 'bonus', 'deduction'].map((key) => (
                <Input
                  key={key}
                  label={
                    { allowance: 'Extra pay', bonus: 'Bonus', deduction: 'Other pay reductions' }[
                      key
                    ]
                  }
                  type="number"
                  min="0"
                  max="100000000"
                  step="0.01"
                  required
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              ))}
            </div>
            <div className="rounded-lg bg-amber-50 p-4 text-[13px] leading-6 text-amber-800">
              {form.employee
                ? 'These amounts apply to the selected employee.'
                : 'The same amounts apply to each employee who worked here during that month.'}{' '}
              If someone joined or left during the month, base pay covers only their workdays at the
              company. Days without attendance and leave without pay reduce the final amount. Decide
              any waiting leave requests first. Pay already saved will stay the same.
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button className="btn-primary" disabled={busy}>
              {busy ? 'Preparing…' : 'Save monthly pay'}
            </button>
          </form>
        </Modal>
      )}
      {detail && (
        <Modal
          title={`Pay details · ${dayjs(`${detail.month}-01`).format('MMMM YYYY')}`}
          onClose={() => setDetail(null)}
          wide
        >
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h3 className="text-xl font-semibold">{detail.employeeName}</h3>
              <p className="mt-1 text-[13px] text-slate-500">
                {detail.employeeCode} · {detail.companyName}
              </p>
            </div>
            <Badge>{detail.paidAt ? 'Paid' : 'Unpaid'}</Badge>
          </div>
          <dl className="divide-y divide-slate-100">
            {[
              ['Full-month salary', detail.salary],
              ['Base pay for this month', detail.basic],
              ['Extra pay', detail.allowance],
              ['Bonus', detail.bonus],
              ['Pay taken off for missed days', -detail.attendanceDeduction],
              ['Other pay reductions', -detail.deduction],
              ['Final pay', detail.netSalary],
            ].map(([label, value]) => (
              <div
                key={label}
                className={`flex justify-between gap-3 py-3 text-[15px] ${label === 'Final pay' ? 'font-semibold text-forest-700' : 'text-slate-600'}`}
              >
                <dt>{label}</dt>
                <dd>{money(value, detail.currency)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 rounded-lg bg-slate-50 p-4 text-[13px] leading-6 text-slate-600">
            Workdays at the company are counted between the employee's start date and last day at
            work. Final pay adds extra pay and bonuses, then takes off pay reductions.
            <br />
            Company workdays: {detail.workingDays} · Workdays at the company: {detail.eligibleDays}
            <br />
            Days at work: {detail.presentDays} · Days missed: {detail.absentDays} · Days off with
            pay: {detail.paidDays} · Days off without pay: {detail.unpaidDays}
            {detail.paidAt && (
              <>
                <br />
                Paid on {formatDate(detail.paidAt)}
              </>
            )}
          </p>
          <div className="mt-6 flex gap-2">
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => exportSlip(detail, 'pdf')}
            >
              <Download size={15} />
              Download PDF
            </button>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => exportSlip(detail, 'excel')}
            >
              <Download size={15} />
              Download Excel
            </button>
          </div>
        </Modal>
      )}
      {paying && (
        <Modal title="Mark as paid" onClose={() => !busy && setPaying(null)}>
          <p className="text-[15px] leading-6 text-slate-600">
            Confirm that <strong>{money(paying.netSalary, paying.currency)}</strong> has been paid
            to <strong>{paying.employeeName}</strong> for {paying.month}. This records the payment;
            it does not send money.
          </p>
          <button className="btn-primary mt-6" disabled={busy} onClick={paid}>
            {busy ? 'Saving…' : 'Confirm already paid'}
          </button>
        </Modal>
      )}
    </>
  );
}
