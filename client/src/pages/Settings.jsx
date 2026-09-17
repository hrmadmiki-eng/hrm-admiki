import { leaveTypeLabel, statusLabel } from '../../../shared/language.mjs';
import { useState } from 'react';
import { Save, Plus, Trash2, Building2, Clock3, CalendarDays } from 'lucide-react';
import { useResource } from '../hooks/useResource';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../lib/api';
import { officeTime } from '../lib/date';
import { PageHeader, Spinner, ErrorState, Input, Select, Textarea } from '../components/UI';
function TimeSelect({ label, value, onChange }) {
  const [hours, minutes] = value.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour = hours % 12 || 12;
  function update(h, m, p) {
    onChange(
      `${String((Number(h) % 12) + (p === 'PM' ? 12 : 0)).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    );
  }
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="flex gap-2">
        <select
          aria-label={`${label} hour`}
          value={hour}
          onChange={(e) => update(e.target.value, minutes, period)}
        >
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {String(i + 1).padStart(2, '0')}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label} minute`}
          value={minutes}
          onChange={(e) => update(hour, e.target.value, period)}
        >
          {Array.from({ length: 60 }, (_, i) => (
            <option key={i} value={i}>
              {String(i).padStart(2, '0')}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label} AM or PM`}
          value={period}
          onChange={(e) => update(hour, minutes, e.target.value)}
        >
          <option>AM</option>
          <option>PM</option>
        </select>
      </div>
    </fieldset>
  );
}
function SettingsForm({ initial }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const notify = useToast();
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.put('/settings', form);
      setForm(res.data.data);
      notify('Company settings saved');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="space-y-6">
      <PageHeader
        title="Company settings"
        description="Set company details, office hours, and paid days off."
      >
        <button className="btn-primary" disabled={busy}>
          <Save size={16} />
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </PageHeader>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-600">
          {error}
        </p>
      )}
      <section className="card p-6">
        <h2 className="mb-6 flex items-center gap-2 text-[15px] font-semibold">
          <Building2 size={18} className="text-forest-700" />
          Company details
        </h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Input
            label="Company name"
            required
            maxLength={150}
            value={form.companyName}
            onChange={(e) => set('companyName', e.target.value)}
          />
          <Input
            label="Company email"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
          />
          <Input
            label="Phone"
            maxLength={30}
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
          <Select
            label="Currency"
            value={form.currency}
            onChange={(e) => set('currency', e.target.value)}
          >
            {['BDT'].map((c) => (
              <option key={c} value={c}>
                {c} (৳)
              </option>
            ))}
          </Select>
          <div className="sm:col-span-2">
            <Textarea
              label="Address"
              maxLength={1000}
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
            />
          </div>
        </div>
      </section>
      <section className="card p-6">
        <h2 className="mb-6 flex items-center gap-2 text-[15px] font-semibold">
          <Clock3 size={18} className="text-forest-700" />
          Office hours
        </h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <TimeSelect
            label="Office starts"
            value={form.officeStart}
            onChange={(v) => set('officeStart', v)}
          />
          <TimeSelect
            label="Office ends"
            value={form.officeEnd}
            onChange={(v) => set('officeEnd', v)}
          />
          <Input
            label="Minutes allowed before someone is marked late"
            type="number"
            required
            min="0"
            max="120"
            value={form.graceMinutes}
            onChange={(e) => set('graceMinutes', Number(e.target.value))}
          />
          <Input
            label="Timezone"
            required
            value={form.timezone}
            onChange={(e) => set('timezone', e.target.value)}
            hint="Enter your city as Asia/Dhaka or Europe/London."
          />
        </div>
        <p className="mt-5 text-[13px] text-slate-500">
          Office hours: {officeTime(form.officeStart)} – {officeTime(form.officeEnd)}. Overnight
          shifts are not supported.
        </p>
        <fieldset className="mt-6">
          <legend className="label">Weekly days off</legend>
          <div className="flex flex-wrap gap-2">
            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
              (name, i) => (
                <label
                  key={name}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${form.weekends.includes(i) ? 'border-forest-600 bg-forest-50 text-forest-700' : 'border-slate-200'}`}
                >
                  <input
                    type="checkbox"
                    checked={form.weekends.includes(i)}
                    onChange={(e) =>
                      set(
                        'weekends',
                        e.target.checked
                          ? [...form.weekends, i]
                          : form.weekends.filter((d) => d !== i),
                      )
                    }
                  />
                  {name}
                </label>
              ),
            )}
          </div>
          <p className="mt-3 text-[13px] leading-5 text-slate-500">
            Choose your time zone and weekly days off before adding attendance or leave. After that,
            these settings cannot change because past pay and days off depend on them.
          </p>
        </fieldset>
      </section>
      <section className="card p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <CalendarDays size={18} className="text-forest-700" />
            Company holidays
          </h2>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => set('holidays', [...form.holidays, { date: '', name: '' }])}
          >
            <Plus size={15} />
            Add holiday
          </button>
        </div>
        {!form.holidays.length && <p className="text-[15px] text-slate-500">No holidays added yet.</p>}
        <div className="space-y-4">
          {form.holidays.map((h, i) => (
            <div key={i} className="flex items-end gap-3">
              <div className="flex-1">
                <Input
                  label="Holiday name"
                  required
                  maxLength={150}
                  value={h.name}
                  onChange={(e) =>
                    set(
                      'holidays',
                      form.holidays.map((v, j) => (j === i ? { ...v, name: e.target.value } : v)),
                    )
                  }
                />
              </div>
              <div className="w-40 sm:w-48">
                <Input
                  label="Date"
                  required
                  type="date"
                  value={h.date}
                  onChange={(e) =>
                    set(
                      'holidays',
                      form.holidays.map((v, j) => (j === i ? { ...v, date: e.target.value } : v)),
                    )
                  }
                />
              </div>
              <button
                type="button"
                className="mb-2.5 text-slate-500 hover:text-red-600"
                aria-label={`Remove holiday ${h.name || i + 1}`}
                onClick={() =>
                  set(
                    'holidays',
                    form.holidays.filter((_, j) => j !== i),
                  )
                }
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[13px] text-slate-500">
          Past holidays cannot be changed. You can change a future holiday only if no attendance or
          waiting or approved leave requests use that day.
        </p>
      </section>
      <section className="card p-6">
        <h2 className="mb-2 text-[15px] font-semibold">Paid days off each year</h2>
        <p className="mb-6 text-[13px] text-slate-500">
          These are the paid days off available from January to December. Unused days expire at the
          end of the year. Changing these numbers does not change leave already approved.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {['Casual', 'Sick', 'Annual'].map((type) => (
            <Input
              key={type}
              label={`${leaveTypeLabel(type)} (days per year)`}
              type="number"
              required
              min="0"
              max="366"
              step="1"
              value={form.leavePolicy[type]}
              onChange={(e) =>
                set('leavePolicy', { ...form.leavePolicy, [type]: Number(e.target.value) })
              }
            />
          ))}
        </div>
      </section>
      <button className="btn-primary" disabled={busy}>
        <Save size={16} />
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
export default function Settings() {
  const resource = useResource('/settings');
  if (resource.loading) return <Spinner />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.reload} />;
  return <SettingsForm initial={resource.data} />;
}
