import { useEffect, useLayoutEffect, useRef, useId } from 'react';
import { Link } from 'react-router-dom';
import { statusLabel } from '../../../shared/language.mjs';
import {
  LoaderCircle,
  X,
  Inbox,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  AlertCircle,
} from 'lucide-react';
export function Spinner({ full = false }) {
  return (
    <div
      className={`flex items-center justify-center gap-2 text-[15px] text-slate-600 ${full ? 'min-h-screen' : 'min-h-32'}`}
      role="status"
    >
      <LoaderCircle className="animate-spin" size={20} /> Loading…
    </div>
  );
}
export function ErrorState({ message, retry }) {
  return (
    <div role="alert" className="card flex flex-col items-center gap-3 p-8 text-center">
      <AlertCircle className="text-red-500" />
      <p className="max-w-xl text-[15px] text-slate-600">{message}</p>
      {retry && (
        <button className="btn-secondary" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function PageHeader({ title, description, children }) {
  return (
    <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-[1.65rem] font-semibold tracking-tight text-slate-800">{title}</h1>
        <p className="mt-1.5 text-[15px] text-slate-600">{description}</p>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
export function Field({ label, required, children, hint }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-red-500">
            *
          </span>
        )}
      </label>
      {typeof children === 'function' ? children(id) : children}
      {hint && <p className="mt-1.5 text-[13px] text-slate-500">{hint}</p>}
    </div>
  );
}
export function Input({ label, hint, ...props }) {
  return (
    <Field label={label} required={props.required} hint={hint}>
      {(id) => <input id={id} {...props} />}
    </Field>
  );
}
export function Select({ label, children, ...props }) {
  return (
    <Field label={label} required={props.required}>
      {(id) => (
        <select id={id} {...props}>
          {children}
        </select>
      )}
    </Field>
  );
}
export function Textarea({ label, ...props }) {
  return (
    <Field label={label} required={props.required}>
      {(id) => <textarea id={id} rows={3} {...props} />}
    </Field>
  );
}
export function Badge({ children }) {
  const value = String(children);
  const styles = ['Active', 'Present', 'Approved', 'Paid', 'Admin'].includes(value)
    ? 'bg-forest-50 text-forest-700'
    : ['Pending', 'Late', 'HR', 'Unpaid'].includes(value)
      ? 'bg-amber-50 text-amber-700'
      : ['Absent', 'Rejected', 'Terminated', 'Inactive'].includes(value)
        ? 'bg-red-50 text-red-600'
        : 'bg-slate-100 text-slate-600';
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${styles}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {statusLabel(children)}
    </span>
  );
}
export function Avatar({ name = '?', employee, photo, size = 'md' }) {
  const sizing =
    size === 'lg' ? 'h-20 w-20 text-2xl' : size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm';
  const photoVersion = typeof photo === 'object' ? photo?.public_id : photo;
  return photo ? (
    <img
      className={`${sizing} shrink-0 rounded-xl object-cover`}
      src={`/api/employees/${employee}/photo?v=${encodeURIComponent(photoVersion)}`}
      alt={`${name}'s profile`}
    />
  ) : (
    <div
      className={`${sizing} flex shrink-0 items-center justify-center rounded-xl bg-forest-50 font-semibold text-forest-700`}
    >
      {name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()}
    </div>
  );
}
export function Stat({ label, value, icon: Icon, detail, tone = 'green', to }) {
  const Container = to ? Link : 'div';
  return (
    <Container
      {...(to ? { to, 'aria-label': `${label}: ${value ?? 0}. View details` } : {})}
      className={`card block p-5 ${to ? 'transition hover:border-forest-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 focus-visible:ring-offset-2' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-slate-600">{label}</span>
        <span
          className={`rounded-lg p-2 ${tone === 'amber' ? 'bg-amber-50 text-amber-600' : tone === 'blue' ? 'bg-blue-50 text-blue-600' : 'bg-forest-50 text-forest-700'}`}
        >
          <Icon size={18} />
        </span>
      </div>
      <p className="mt-3 truncate text-[2rem] font-semibold tracking-tight">{value ?? '—'}</p>
      <p className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
        {detail}
        {to && <ArrowUpRight size={14} aria-hidden="true" className="shrink-0 text-forest-600" />}
      </p>
    </Container>
  );
}
export function Empty({ title = 'No records yet', description = 'Saved items will appear here.' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-5 py-14 text-center">
      <div className="mb-2 rounded-full bg-slate-50 p-3">
        <Inbox size={25} className="text-slate-500" />
      </div>
      <p className="text-[15px] font-medium text-slate-600">{title}</p>
      <p className="max-w-sm text-[13px] leading-relaxed text-slate-500">{description}</p>
    </div>
  );
}
export function DataTable({ columns, rows = [], loading, empty, keyField = '_id' }) {
  rows = rows || [];
  const container = useRef();
  const height = useRef(0);
  useLayoutEffect(() => {
    if (!loading && rows.length) {
      height.current = Math.max(height.current, container.current.getBoundingClientRect().height);
      container.current.style.minHeight = `${height.current}px`;
    }
  }, [loading, rows]);
  return (
    <div ref={container} className="relative overflow-x-auto" aria-busy={loading}>
      {loading && rows.length > 0 && (
        <span
          role="status"
          className="absolute right-3 top-2 rounded bg-white px-2 py-1 text-xs text-slate-600 shadow-sm"
        >
          Updating…
        </span>
      )}
      {!rows.length ? (
        loading ? (
          <Spinner />
        ) : (
          <Empty {...empty} />
        )
      ) : (
        <table className="w-full whitespace-nowrap text-[15px]">
          <thead className="table-head">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="px-5 py-3.5">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr key={row[keyField] || i} className="hover:bg-slate-50/60">
                {columns.map((c) => (
                  <td key={c.key} className="px-5 py-4 text-sm text-slate-600">
                    {c.render ? c.render(row) : (row[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
export function Pagination({ data, page, setPage }) {
  if (!data) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-[13px] text-slate-500">
      <span>
        {data.total} records · Page {page} of {Math.max(1, data.pages)}
      </span>
      <div className="flex gap-2">
        <button
          className="rounded-md border p-1.5"
          disabled={page <= 1}
          aria-label="Previous page"
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          className="rounded-md border p-1.5"
          disabled={page >= data.pages}
          aria-label="Next page"
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
export function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef();
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => [
      ...ref.current.querySelectorAll(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]',
      ),
    ];
    focusable()[0]?.focus();
    function key(event) {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`max-h-[90dvh] w-full overflow-auto rounded-2xl bg-white shadow-xl ${wide ? 'max-w-2xl' : 'max-w-lg'}`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-5">
          <h2 id={titleId} className="text-[17px] font-semibold">
            {title}
          </h2>
          <button
            aria-label="Close dialog"
            onClick={onClose}
            className="rounded p-1 text-slate-500"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </section>
    </div>
  );
}
