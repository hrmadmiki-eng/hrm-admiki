import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useResource } from '../hooks/useResource';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../lib/api';
import { DataTable, Modal, Input, Select, Textarea, ErrorState } from '../components/UI';
export default function Catalogs({ type, onChanged }) {
  const resource = useResource(`/${type}`);
  const departments = useResource('/departments');
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [form, setForm] = useState({ name: '', department: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const notify = useToast();
  const designation = type === 'designations';
  function edit(record) {
    setForm({
      name: record?.name || '',
      department: record?.department?._id || '',
      description: record?.description || '',
    });
    setError('');
    setEditing(record || {});
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (editing._id) await api.put(`/${type}/${editing._id}`, form);
      else await api.post(`/${type}`, form);
      notify('Saved successfully');
      setEditing(null);
      resource.reload();
      departments.reload();
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/${type}/${removing._id}`);
      notify('Deleted successfully');
      setRemoving(null);
      resource.reload();
      departments.reload();
      onChanged?.();
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[15px] text-slate-600">
          Organize your team’s {designation ? 'job titles' : 'departments'}.
        </p>
        <button className="btn-primary" onClick={() => edit()}>
          <Plus size={16} />
          Add {designation ? 'job title' : 'department'}
        </button>
      </div>
      <div className="card">
        {resource.error ? (
          <ErrorState message={resource.error} retry={resource.reload} />
        ) : (
          <DataTable
            loading={resource.loading}
            rows={resource.data}
            columns={[
              { key: 'name', label: 'Name' },
              {
                key: 'detail',
                label: designation ? 'Department' : 'Description',
                render: (r) => (designation ? r.department?.name : r.description || '—'),
              },
              {
                key: 'actions',
                label: 'Actions',
                render: (r) => (
                  <div className="flex gap-4">
                    <button aria-label={`Edit ${r.name}`} onClick={() => edit(r)}>
                      <Pencil size={15} />
                    </button>
                    <button aria-label={`Delete ${r.name}`} onClick={() => setRemoving(r)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>
      {editing && (
        <Modal
          title={`${editing._id ? 'Edit' : 'Add'} ${designation ? 'job title' : 'department'}`}
          onClose={() => !busy && setEditing(null)}
        >
          <form onSubmit={save} className="space-y-4">
            <Input
              label="Name"
              required
              maxLength={150}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            {designation ? (
              <Select
                label="Department"
                required
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              >
                <option value="">Select a department</option>
                {departments.data?.map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Textarea
                label="Description"
                maxLength={1000}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            )}
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </form>
        </Modal>
      )}
      {removing && (
        <Modal title="Delete record" onClose={() => !busy && setRemoving(null)}>
          <p className="text-[15px] text-slate-600">
            Delete <strong>{removing.name}</strong>? Items still used by an employee or job title
            cannot be deleted.
          </p>
          <button className="btn-danger mt-6" disabled={busy} onClick={remove}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </Modal>
      )}
    </>
  );
}
