import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Pencil,
  Mail,
  Phone,
  MapPin,
  Building2,
  Briefcase,
  CalendarDays,
  Wallet,
  ArrowLeft,
} from 'lucide-react';
import { useResource } from '../hooks/useResource';
import { PageHeader, Spinner, ErrorState, Avatar, Badge } from '../components/UI';
import { formatDate, money } from '../lib/date';
import { EmployeeForm } from './Employees';
import ProfilePhotoControls from '../components/ProfilePhotoControls';
export default function Profile() {
  const { id } = useParams();
  const resource = useResource(id ? `/employees/${id}` : '/employees/me');
  const company = useResource('/company');
  const [editing, setEditing] = useState(false);
  if (resource.loading) return <Spinner />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.reload} />;
  const e = resource.data;
  return (
    <>
      {id && (
        <Link
          to="/employees"
          className="mb-4 inline-flex items-center gap-1 text-[13px] text-slate-600"
        >
          <ArrowLeft size={14} />
          Back to employees
        </Link>
      )}
      <PageHeader
        title={id ? 'Employee profile' : 'Your profile'}
        description="Contact details, job title, salary, and work dates."
      >
        {id && (
          <button className="btn-primary" onClick={() => setEditing(true)}>
            <Pencil size={15} />
            Edit profile
          </button>
        )}
      </PageHeader>
      <div className="card overflow-hidden">
        <div className="h-28 bg-gradient-to-r from-forest-900 to-forest-600" />
        <div className="px-6 pb-6 sm:px-8">
          <div className="relative flex flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="-mt-10 rounded-2xl border-4 border-white bg-white">
              <Avatar name={e.name} employee={e._id} photo={e.photo} size="lg" />
            </div>
            <div className="flex-1 sm:pb-1">
              <h2 className="text-[1.375rem] font-semibold">{e.name}</h2>
              <p className="mt-1 text-[15px] text-slate-500">
                {e.designation?.name || 'Job title not set'} · {e.employeeId}
              </p>
            </div>
            <Badge>{e.status}</Badge>
          </div>
          <ProfilePhotoControls employee={e} />
          <div className="mt-8 grid gap-x-10 gap-y-7 border-t border-slate-100 pt-7 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [Mail, 'Email address', e.email],
              [Phone, 'Phone number', e.phone || 'Not provided'],
              [Building2, 'Department', e.department?.name || 'Not set'],
              [Briefcase, 'Job title', e.designation?.name || 'Not set'],
              [CalendarDays, 'Start date', formatDate(e.joiningDate)],
              [Wallet, 'Full-month salary', money(e.salary, company.data?.currency)],
              [MapPin, 'Address', e.address || 'Not provided'],
              ...(e.endDate ? [[CalendarDays, 'Last day at work', formatDate(e.endDate)]] : []),
            ].map(([Icon, label, value]) => (
              <div key={label} className="flex gap-3">
                <Icon size={18} className="mt-0.5 shrink-0 text-slate-500" />
                <div>
                  <p className="eyebrow">{label}</p>
                  <p className="mt-2 break-words text-[15px] leading-relaxed text-slate-600">
                    {value}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {!id && (
        <p className="mt-4 text-[13px] text-slate-500">
          Need to update your details? Please contact your HR team.
        </p>
      )}
      {editing && (
        <EmployeeForm
          employee={e}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            resource.reload();
          }}
        />
      )}
    </>
  );
}
