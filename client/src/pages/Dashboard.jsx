import { leaveTypeLabel, statusLabel } from '../../../shared/language.mjs';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  UserCheck,
  UserMinus,
  CalendarDays,
  ArrowUpRight,
  ArrowRight,
  Wallet,
  Clock3,
  Plus,
  CalendarCheck,
  Leaf,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import { useResource } from '../hooks/useResource';
import { dayjs, money, formatDate, formatTime } from '../lib/date';
import {
  PageHeader,
  Stat,
  Spinner,
  ErrorState,
  Badge,
  Avatar,
  Empty,
  DataTable,
  Select,
} from '../components/UI';
function SectionTitle({ title, to, link = 'View all' }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {to && (
        <Link to={to} className="flex items-center gap-1 text-xs font-medium text-forest-700">
          {link}
          <ArrowUpRight size={13} />
        </Link>
      )}
    </div>
  );
}
export default function Dashboard() {
  const { user } = useAuth();
  const [selectedCurrency, setSelectedCurrency] = useState('');
  const { data, loading, error, reload } = useResource(
    '/dashboard',
    selectedCurrency ? { currency: selectedCurrency } : {},
  );
  const company = useResource('/company');
  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} retry={reload} />;
  const employee = user.role === 'Employee';
  const currency = data.payrollCurrency || company.data?.currency || 'BDT';
  const teamLink = (group) => `/employees?dashboard=${group}&date=${data.date}`;
  const payrollMonth = data.lastPayroll?._id || data.month;
  const payrollLink = `/payroll?month=${payrollMonth}&currency=${currency}`;
  return (
    <>
      <PageHeader
        title={`Good ${dayjs().hour() < 12 ? 'morning' : dayjs().hour() < 17 ? 'afternoon' : 'evening'}, ${user.name.split(' ')[0]} ☀`}
        description={
          employee
            ? 'Here’s your workday at a glance.'
            : 'Here’s what’s happening with your team today.'
        }
      >
        <span className="btn-secondary text-[13px]">
          <CalendarDays size={15} />
          {formatDate(data.date)}
        </span>
      </PageHeader>
      <div className="relative mb-6 flex flex-wrap items-center justify-between gap-5 overflow-hidden rounded-xl border border-[#dce9df] bg-[#edf4ec] px-6 py-6 sm:px-8">
        <div className="relative z-10">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.15em] text-forest-600">
            {employee ? 'Your work summary' : 'Your team at a glance'}
          </p>
          <h2 className="text-[1.375rem] font-semibold tracking-tight text-forest-900">
            {employee ? 'Your workday, in one place.' : 'See how your team is doing today.'}
          </h2>
          <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-forest-800/60">
            {employee
              ? 'See your work hours, days off, and pay.'
              : 'Check who is at work, who is off, and what needs your attention.'}
          </p>
        </div>
        <Link
          to={employee ? '/attendance' : '/employees'}
          className="btn-primary relative z-10 text-[13px]"
        >
          {employee ? 'Open attendance' : 'View your team'}
          <ArrowRight size={15} />
        </Link>
        <Leaf
          className="absolute -right-6 -top-8 rotate-[-25deg] text-forest-700/[.05]"
          size={220}
        />
      </div>
      <div
        className={`mb-6 grid gap-4 sm:grid-cols-2 ${employee ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}
      >
        {employee ? (
          <>
            <Stat
              label="Days at work"
              value={data.presentDays}
              icon={UserCheck}
              detail="This month · includes people who arrived late"
            />
            <Stat
              label="Days arrived late"
              value={data.lateDays}
              icon={Clock3}
              tone="amber"
              detail="This month"
            />
            <Stat
              label="Paid days off left"
              value={data.balances.reduce((n, b) => n + b.remaining, 0)}
              icon={CalendarDays}
              detail="Paid days off you can still use"
            />
            <Stat
              label="Latest pay amount"
              value={data.payslip ? money(data.payslip.netSalary, data.payslip.currency) : '—'}
              icon={Wallet}
              tone="blue"
              detail={
                data.payslip
                  ? dayjs(`${data.payslip.month}-01`).format('MMMM YYYY')
                  : 'No pay details yet'
              }
            />
          </>
        ) : (
          <>
            <Stat
              label="Total employees"
              to={teamLink('active')}
              value={data.totalEmployees}
              icon={Users}
              detail="Current employees who have started work"
            />
            <Stat
              label="At work today"
              to={teamLink('present')}
              value={data.presentToday}
              icon={UserCheck}
              detail="Checked in · including people who arrived late"
            />
            <Stat
              label="Not at work today"
              to={teamLink('absent')}
              value={data.absentToday}
              icon={UserMinus}
              tone="amber"
              detail={
                data.isWorkday
                  ? 'Not checked in · not counting approved leave'
                  : 'Today is a weekend or holiday'
              }
            />
            <Stat
              label="Off today"
              to={teamLink('on-leave')}
              value={data.onLeave}
              icon={CalendarDays}
              tone="blue"
              detail="Approved leave on a workday"
            />
            <Stat
              label="Leave requests to review"
              to="/leave?status=Pending"
              value={data.pendingLeave}
              icon={Clock3}
              tone="amber"
              detail="All requests awaiting review"
            />
            <Stat
              label="Monthly pay total"
              to={payrollLink}
              value={money(data.lastPayroll?.total || 0, currency)}
              icon={Wallet}
              tone="blue"
              detail={`${dayjs(`${payrollMonth}-01`).format('MMMM YYYY')} · ${currency}${data.lastPayroll ? ' · latest month prepared' : ' · no pay records yet'}`}
            />
          </>
        )}
      </div>
      {employee ? (
        <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
          <section className="card overflow-hidden">
            <SectionTitle title="Recent attendance" to="/attendance" />
            <DataTable
              rows={data.attendance}
              columns={[
                {
                  key: 'date',
                  label: 'Date',
                  render: (r) => formatDate(r.date),
                },
                {
                  key: 'checkIn',
                  label: 'Check-in',
                  render: (r) => formatTime(r.checkIn, company.data?.timezone),
                },
                {
                  key: 'checkOut',
                  label: 'Check-out',
                  render: (r) => formatTime(r.checkOut, company.data?.timezone),
                },
                {
                  key: 'status',
                  label: 'Status',
                  render: (r) => <Badge>{r.status}</Badge>,
                },
              ]}
            />
          </section>
          <section className="card">
            <SectionTitle title="Your paid days off" to="/leave" />
            <div className="space-y-6 p-6">
              {data.balances.map((b) => (
                <div key={b.type}>
                  <div className="mb-2 flex justify-between text-[13px]">
                    <span className="text-slate-600">{leaveTypeLabel(b.type)}</span>
                    <span className="font-semibold">
                      {b.remaining}{' '}
                      <span className="font-normal text-slate-500">/ {b.allowance} days</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-forest-600"
                      style={{
                        width: `${b.allowance ? (b.remaining / b.allowance) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mx-6 mb-6 rounded-lg bg-forest-50 p-4 text-[13px] text-forest-800">
              Need a little time away?{' '}
              <Link to="/leave" className="font-semibold underline">
                Request leave
              </Link>
            </div>
          </section>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
          <section className="card">
            <SectionTitle title="Pay over time" to={payrollLink} />
            <div className="px-6 pt-4">
              <Select
                label="Pay currency"
                value={currency}
                onChange={(e) => setSelectedCurrency(e.target.value)}
              >
                {['BDT'].map((code) => (
                  <option key={code} value={code}>
                    {code} (৳)
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-start justify-between px-6 pt-5">
              <Link
                to={payrollLink}
                className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 hover:text-forest-700"
              >
                <p className="text-[1.65rem] font-semibold tracking-tight">
                  {money(data.lastPayroll?.total || 0, currency)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {data.lastPayroll
                    ? `Latest month prepared · ${dayjs(`${data.lastPayroll._id}-01`).format('MMMM YYYY')}`
                    : 'No pay records in the last six months'}
                </p>
              </Link>
              <span className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600">
                Last 6 months
              </span>
            </div>
            <div className="h-56 px-3 pb-3 pt-6">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data.payrollSeries}
                  margin={{ left: 0, right: 15, top: 5, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="payrollFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#208062" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#208062" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#edf0ee" />
                  <XAxis
                    dataKey="month"
                    tickFormatter={(v) => dayjs(`${v}-01`).format('MMM')}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    dy={8}
                  />
                  <YAxis
                    tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    width={45}
                  />
                  <Tooltip
                    formatter={(v) => [money(v, currency), 'Total pay']}
                    labelFormatter={(v) => dayjs(`${v}-01`).format('MMMM YYYY')}
                    contentStyle={{
                      borderRadius: 12,
                      fontSize: 12,
                      borderColor: '#e2e8f0',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="#208062"
                    strokeWidth={2.5}
                    fill="url(#payrollFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="card">
            <SectionTitle title="Team by department" to="/employees?tab=departments" />
            {data.departments.length ? (
              <div className="space-y-5 p-6">
                {data.departments.slice(0, 6).map((d, i) => (
                  <div key={d.name}>
                    <div className="mb-2 flex justify-between text-[13px]">
                      <span className="text-slate-600">{d.name}</span>
                      <span className="font-semibold">
                        {d.count} <span className="font-normal text-slate-500">people</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${i % 2 ? 'bg-[#b4c9a8]' : 'bg-forest-600'}`}
                        style={{
                          width: `${data.totalEmployees ? (d.count / data.totalEmployees) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="Build your team structure"
                description="Create departments in Employees to organize your people."
              />
            )}
          </section>
        </div>
      )}
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <section className="card overflow-hidden">
          <SectionTitle
            title={employee ? 'Your recent leave requests' : 'Leave requests to review'}
            to={employee ? '/leave' : '/leave?status=Pending'}
          />
          <DataTable
            rows={data.recentLeave}
            columns={[
              ...(!employee
                ? [
                    {
                      key: 'employee',
                      label: 'Employee',
                      render: (r) => (
                        <div className="flex items-center gap-2">
                          <Avatar name={r.employee?.name} size="sm" />
                          <span>{r.employee?.name || 'Former employee'}</span>
                        </div>
                      ),
                    },
                  ]
                : []),
              { key: 'type', label: 'Type of leave', render: (r) => leaveTypeLabel(r.type) },
              {
                key: 'startDate',
                label: 'From',
                render: (r) => formatDate(r.startDate),
              },
              { key: 'days', label: 'Days', render: (r) => r.workDates.length },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge>{r.status}</Badge>,
              },
            ]}
            empty={{
              title: employee ? 'No leave requests yet' : 'You’re all caught up',
              description: employee
                ? 'Your leave requests will appear here.'
                : 'There are no pending leave requests to review.',
            }}
          />
        </section>
        <section className="card">
          <SectionTitle title="Quick actions" />
          <div className="space-y-2 p-4">
            {(employee
              ? [
                  [
                    '/attendance',
                    'Check your attendance',
                    CalendarCheck,
                    'Keep track of your workdays',
                  ],
                  ['/leave', 'Request leave', CalendarDays, 'Make room for a well-earned break'],
                  ['/payslip', 'View your pay details', Wallet, 'Your monthly salary, in detail'],
                ]
              : [
                  ['/employees?new=1', 'Add an employee', Users, 'Welcome someone new to the team'],
                  [
                    '/attendance',
                    'Manage attendance',
                    CalendarCheck,
                    'Review and update daily records',
                  ],
                  [
                    '/reports',
                    'Download a report',
                    FileBarChartIcon,
                    'The details you need, ready to share',
                  ],
                ]
            ).map(([to, title, Icon, description]) => (
              <Link
                to={to}
                key={to}
                className="flex items-center gap-3 rounded-lg p-3 hover:bg-slate-50"
              >
                <div className="rounded-lg bg-slate-50 p-2.5 text-forest-700">
                  <Icon size={17} />
                </div>
                <div className="flex-1">
                  <p className="text-[13px] font-semibold">{title}</p>
                  <p className="mt-1 text-[11px] text-slate-500">{description}</p>
                </div>
                <ArrowUpRight size={15} className="text-slate-500" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
const FileBarChartIcon = Wallet;
