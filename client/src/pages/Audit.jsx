import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useResource, useSearchPage } from '../hooks/useResource';
import { formatDate, formatTime } from '../lib/date';
import { PageHeader, DataTable, Pagination, Input, ErrorState, Modal } from '../components/UI';
import {
  activityLabel,
  plainLabel,
  leaveTypeLabel,
  statusLabel,
} from '../../../shared/language.mjs';
function ActivityValue({ value }) {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value))
    return value.length
      ? value.map((item, i) => (
          <div key={i}>
            <ActivityValue value={item} />
          </div>
        ))
      : 'None';
  if (typeof value === 'object')
    return (
      <dl className="space-y-2">
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt className="font-medium">{plainLabel(key)}</dt>
            <dd className="pl-3">
              <ActivityValue value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return statusLabel(leaveTypeLabel(String(value)));
}
export default function Audit() {
  const [search, setSearch] = useState('');
  const [startDate, setStart] = useState('');
  const [endDate, setEnd] = useState('');
  const { query, page, setPage } = useSearchPage(search);
  const [selected, setSelected] = useState(null);

  const resource = useResource('/audit', {
    search: query,
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    page,
  });
  const company = useResource('/company');
  return (
    <>
      <PageHeader title="Activity history" description="See who changed what and when." />
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <ShieldCheck className="text-forest-700" size={20} />
        <p className="text-[13px] text-slate-600">
          Past activity cannot be edited or deleted. Only Admins can see this history.
        </p>
      </div>
      <div className="card">
        <div className="grid gap-4 border-b border-slate-100 p-5 sm:grid-cols-3">
          <Input
            label="Action"
            placeholder="Search activity, such as pay or leave"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
          <Input
            label={`From date (${company.data?.timezone || 'company timezone'})`}
            type="date"
            value={startDate}
            onChange={(e) => {
              setStart(e.target.value);
              setPage(1);
            }}
          />
          <Input
            label={`To date (${company.data?.timezone || 'company timezone'})`}
            type="date"
            min={startDate}
            value={endDate}
            onChange={(e) => {
              setEnd(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {resource.error ? (
          <ErrorState message={resource.error} retry={resource.reload} />
        ) : (
          <DataTable
            loading={resource.loading}
            rows={resource.data?.items}
            columns={[
              {
                key: 'createdAt',
                label: 'When',
                render: (r) => (
                  <div>
                    {formatDate(r.createdAt, company.data?.timezone)}
                    <p className="mt-1 text-xs text-slate-500">
                      {formatTime(r.createdAt, company.data?.timezone)}
                    </p>
                  </div>
                ),
              },
              { key: 'actorName', label: 'Who' },
              {
                key: 'action',
                label: 'Action',
                render: (r) => (
                  <span className="rounded-md bg-slate-50 px-2 py-1 text-[13px]">
                    {activityLabel(r.action)}
                  </span>
                ),
              },
              { key: 'entity', label: 'Changed item', render: (r) => plainLabel(r.entity) },
              { key: 'ip', label: 'Device address' },
              {
                key: 'details',
                label: 'Details',
                render: (r) => (
                  <button
                    className="text-[13px] font-medium text-forest-700"
                    onClick={() => setSelected(r)}
                  >
                    View details
                  </button>
                ),
              },
            ]}
          />
        )}
        <Pagination data={resource.data} page={page} setPage={setPage} />
      </div>
      {selected && (
        <Modal title="Activity details" onClose={() => setSelected(null)}>
          <dl className="space-y-3 text-[15px]">
            <div>
              <dt className="label">Action</dt>
              <dd>{activityLabel(selected.action)}</dd>
            </div>
            <div>
              <dt className="label">Who</dt>
              <dd>{selected.actorName}</dd>
            </div>
            <div>
              <dt className="label">Record reference</dt>
              <dd className="break-all font-mono text-[13px]">{selected.entityId}</dd>
            </div>
            <div>
              <dt className="label">What changed</dt>
              <dd>
                <div className="break-words rounded-lg bg-slate-50 p-4 text-[15px]">
                  {Object.keys(selected.metadata || {}).length ? (
                    <ActivityValue value={selected.metadata} />
                  ) : (
                    'No extra details were saved.'
                  )}
                </div>
              </dd>
            </div>
          </dl>
        </Modal>
      )}
    </>
  );
}
