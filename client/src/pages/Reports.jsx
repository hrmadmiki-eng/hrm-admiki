import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Users,
  CalendarCheck,
  CalendarDays,
  Wallet,
  Download,
  FileText,
  Sheet,
} from 'lucide-react';
import { useResource } from '../hooks/useResource';
import { useToast } from '../context/ToastContext';
import { download, errorMessage } from '../lib/api';
import { dayjs } from '../lib/date';
import { PageHeader, Input, Select, ErrorState } from '../components/UI';
import EmployeePicker from '../components/EmployeePicker';
const types = [
  [
    'employees',
    'Employee report',
    'Employee names, departments, job titles, and start dates.',
    Users,
  ],
  [
    'attendance',
    'Attendance report',
    'Daily check-ins, absences, holidays, and leave.',
    CalendarCheck,
  ],
  ['leave', 'Leave report', 'Leave requests, decisions, and days with pay.', CalendarDays],
  ['payroll', 'Pay report', 'Monthly pay, money added or taken off, and payment dates.', Wallet],
];
export default function Reports() {
  const [params] = useSearchParams();
  const [type, setType] = useState(
    types.some((t) => t[0] === params.get('type')) ? params.get('type') : 'employees',
  );
  const [form, setForm] = useState({
    month: '',
    startDate: '',
    endDate: '',
    employee: '',
    department: '',
  });
  const [busy, setBusy] = useState('');
  const notify = useToast();
  const departments = useResource('/departments');
  async function generate(format) {
    setBusy(format);
    try {
      const filters = Object.fromEntries(Object.entries(form).filter(([, v]) => v));
      await download(
        `/reports/${type}`,
        { ...filters, format },
        `${type}-report-${dayjs().format('YYYY-MM-DD')}.${format === 'pdf' ? 'pdf' : 'xlsx'}`,
      );
      notify('Report downloaded');
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <PageHeader
        title="Reports"
        description="Download employee, attendance, leave, and pay records."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {types.map(([key, title, description, Icon]) => (
          <button
            key={key}
            onClick={() => setType(key)}
            className={`card p-5 text-left transition ${type === key ? 'border-forest-600 bg-forest-50/50 ring-1 ring-forest-600' : 'hover:border-forest-600/40'}`}
            aria-pressed={type === key}
          >
            <div
              className={`mb-4 inline-flex rounded-lg p-2.5 ${type === key ? 'bg-forest-100 text-forest-700' : 'bg-slate-50 text-slate-500'}`}
            >
              <Icon size={21} />
            </div>
            <h2 className="text-[15px] font-semibold">{title}</h2>
            <p className="mt-2 text-[13px] leading-5 text-slate-500">{description}</p>
          </button>
        ))}
      </div>
      <section className="card p-6">
        <h2 className="text-[15px] font-semibold">Choose what to include</h2>
        <p className="mb-6 mt-2 text-[13px] text-slate-500">
          Choose a month or start and end dates, then choose employees.
        </p>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            label="Month"
            type="month"
            value={form.month}
            onChange={(e) =>
              setForm({ ...form, month: e.target.value, startDate: '', endDate: '' })
            }
          />
          <Input
            label="From date"
            type="date"
            disabled={!!form.month}
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          />
          <Input
            label="To date"
            type="date"
            disabled={!!form.month}
            min={form.startDate}
            value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
          />
          <Select
            label="Department"
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
          >
            <option value="">All departments</option>
            {departments.data?.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </Select>
          <EmployeePicker
            includeArchived={type !== 'employees'}
            value={form.employee}
            onChange={(employee) => setForm({ ...form, employee })}
          />
        </div>
        {departments.error && <ErrorState message={departments.error} retry={departments.reload} />}
        <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-6">
          <p className="max-w-xl text-[13px] leading-5 text-slate-500">
            {type === 'employees'
              ? 'These dates select employees by their start date.'
              : type === 'attendance'
                ? 'Defaults to this month through today. Includes unrecorded absences, weekends, holidays and approved leave.'
                : type === 'leave'
                  ? 'Includes leave requests overlapping your selected dates.'
                  : 'Shows pay for the months within your selected dates.'}{' '}
            Reports are limited to 10,000 rows.
          </p>
          <div className="flex gap-2">
            <button disabled={!!busy} className="btn-secondary" onClick={() => generate('pdf')}>
              <FileText size={16} />
              {busy === 'pdf' ? 'Preparing…' : 'Download PDF'}
            </button>
            <button disabled={!!busy} className="btn-primary" onClick={() => generate('excel')}>
              <Sheet size={16} />
              {busy === 'excel' ? 'Preparing…' : 'Download Excel'}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
