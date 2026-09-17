import { useEffect, useLayoutEffect, useRef, useState, useId } from 'react';
import { useDebounce, useResource } from '../hooks/useResource';
import { Input } from './UI';
export default function EmployeePicker({
  value,
  onChange,
  required = false,
  label = 'Employee',
  selectedLabel = '',
  includeArchived = false,
}) {
  const [search, setSearch] = useState('');
  const query = useDebounce(search.trim());
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState({ id: value, label: selectedLabel });
  const root = useRef();
  const listId = useId();
  const [position, setPosition] = useState({});
  const knownLabel = selection.id === value ? selection.label : selectedLabel;
  const selected = useResource(value && !knownLabel ? '/employees' : null, {
    employee: value,
    limit: 1,
    ...(includeArchived ? { includeArchived: 'true' } : {}),
  });
  const person = selected.data?.items.find((employee) => employee._id === value);
  const name = knownLabel || (person ? `${person.name} · ${person.employeeId}` : '');
  const visible = open && search.trim().length > 0;
  const ready = visible && query === search.trim();
  const { data, loading, error } = useResource(ready ? '/employees' : null, {
    search: query,
    limit: 20,
    ...(includeArchived ? { includeArchived: 'true' } : {}),
  });
  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      if (!root.current.contains(event.target)) {
        setOpen(false);
        setEditing(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useLayoutEffect(() => {
    if (!visible) return;
    const place = () => {
      const rect = root.current.querySelector('input').getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const height = Math.min(240, Math.max(below, above));
      const next = {
        left: rect.left,
        width: rect.width,
        height,
        top: below >= height ? rect.bottom + 4 : rect.top - height - 4,
      };
      setPosition((previous) =>
        Object.keys(next).every((key) => previous[key] === next[key]) ? previous : next,
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [visible]);
  return (
    <div
      ref={root}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setEditing(false);
        }
      }}
    >
      <Input
        label={label}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={visible ? listId : undefined}
        autoComplete="off"
        value={editing ? search : value ? name || 'Employee selected' : search}
        placeholder={
          required ? 'Search by name or employee ID' : 'All employees — search to select'
        }
        onFocus={() => {
          setEditing(true);
          setSearch('');
          setOpen(false);
        }}
        onChange={(event) => {
          setSearch(event.target.value);
          setEditing(true);
          setOpen(event.target.value.trim().length > 0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && visible) {
            event.stopPropagation();
            setOpen(false);
          }
          if (event.key === 'ArrowDown' && visible) {
            event.preventDefault();
            root.current.querySelector('[role="option"]')?.focus();
          }
        }}
      />
      <input type="hidden" value={value || ''} />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange('');
            setSelection({ id: '', label: '' });
            setSearch('');
            setOpen(false);
          }}
          className="mt-1 text-[13px] text-slate-600"
        >
          Clear selection
        </button>
      )}
      {visible && (
        <div
          id={listId}
          role="listbox"
          aria-label="Employee suggestions"
          aria-busy={!ready || loading}
          style={position}
          className="fixed z-[60] overflow-y-auto overscroll-contain rounded-lg border bg-white p-1 shadow-lg [scrollbar-gutter:stable]"
        >
          {!ready || loading ? (
            <p className="p-3 text-[13px] text-slate-600">Searching…</p>
          ) : error ? (
            <p className="p-3 text-[13px] text-red-600">{error}</p>
          ) : !data?.items.length ? (
            <p className="p-3 text-[13px] text-slate-600">No employees found</p>
          ) : (
            data.items.map((employee) => (
              <button
                type="button"
                role="option"
                aria-selected={employee._id === value}
                key={employee._id}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    root.current.querySelector('input').focus();
                  }
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    (event.key === 'ArrowDown'
                      ? event.currentTarget.nextElementSibling
                      : event.currentTarget.previousElementSibling
                    )?.focus();
                  }
                }}
                onClick={() => {
                  onChange(employee._id);
                  setSelection({
                    id: employee._id,
                    label: `${employee.name} · ${employee.employeeId}`,
                  });
                  setOpen(false);
                  setEditing(false);
                  setSearch('');
                }}
                className="block w-full rounded px-3 py-2 text-left text-[15px] hover:bg-forest-50"
              >
                {employee.name}
                <span className="ml-2 text-[13px] text-slate-600">{employee.employeeId}</span>
                {employee.deleted && (
                  <span className="ml-2 text-[13px] text-slate-600">Former employee</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
