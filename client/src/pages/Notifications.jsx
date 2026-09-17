import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bell, Megaphone } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../lib/api';
import { dayjs } from '../lib/date';
import { PageHeader, Input, Textarea, Pagination, Spinner, ErrorState } from '../components/UI';

export default function Notifications() {
  const { user } = useAuth();
  const { data, page, setPage, unread, setUnread, error, busy, refresh, markRead } =
    useNotifications();
  const toast = useToast();
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ title: '', message: '' });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  async function read(id) {
    try {
      await markRead(id);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }
  async function announce(event) {
    event.preventDefault();
    setSending(true);
    setSendError('');
    try {
      const response = await api.post('/announcements', form);
      toast(`Announcement sent to ${response.data.data.recipients} employees`);
      setForm({ title: '', message: '' });
      setComposing(false);
    } catch (err) {
      setSendError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Your requests, decisions, and company announcements."
      >
        {['HR', 'Admin'].includes(user.role) && (
          <button className="btn-primary" onClick={() => setComposing(true)}>
            <Megaphone size={16} /> New announcement
          </button>
        )}
      </PageHeader>
      {composing && (
        <form onSubmit={announce} className="card mb-6 space-y-4 p-6">
          <h2 className="font-semibold">Announce to all employees</h2>
          <p className="text-[15px] text-slate-600">
            Everyone with an active Employee account will receive a private copy.
          </p>
          <Input
            label="Announcement title"
            required
            maxLength={150}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <Textarea
            label="Message"
            required
            maxLength={2000}
            rows={4}
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
          />
          {sendError && (
            <p role="alert" className="text-sm text-red-600">
              {sendError}
            </p>
          )}
          <div className="flex gap-3">
            <button className="btn-primary" disabled={sending}>
              {sending ? 'Sending…' : 'Send announcement'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={sending}
              onClick={() => setComposing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              className={unread === value ? 'btn-primary' : 'btn-secondary'}
              aria-pressed={unread === value}
              onClick={() => {
                setUnread(value);
                setPage(1);
              }}
            >
              {value ? 'Unread' : 'All'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={refresh}>
            Refresh
          </button>
          <button
            className="btn-secondary"
            disabled={busy || !data?.unreadCount}
            onClick={() => read()}
          >
            Mark all as read
          </button>
        </div>
      </div>
      {error && <ErrorState message={error} retry={refresh} />}
      {!data && !error && <Spinner />}
      {data && (
        <div className="card overflow-hidden">
          {!data.items.length && (
            <div className="p-10 text-center text-slate-600">
              <Bell className="mx-auto mb-3" size={24} />
              <p>{unread ? 'You’re all caught up.' : 'No notifications yet.'}</p>
            </div>
          )}
          <ul className="divide-y divide-slate-100">
            {data.items.map((item) => (
              <li key={item._id} className={item.readAt ? '' : 'bg-forest-50/50'}>
                {item.href ? (
                  <Link
                    to={item.href}
                    aria-label={`${item.title}: ${item.message}`}
                    className="group flex items-center gap-4 p-5 transition hover:bg-forest-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest-700 sm:p-6"
                    onClick={() => {
                      if (!item.readAt) read(item._id);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <NotificationContent item={item} />
                    </div>
                    <ArrowRight
                      size={20}
                      className="shrink-0 text-forest-700 transition-transform group-hover:translate-x-1"
                      aria-hidden="true"
                    />
                  </Link>
                ) : (
                  <div className="p-5 sm:p-6">
                    <NotificationContent item={item} />
                    {!item.readAt && (
                      <button
                        className="mt-3 text-[13px] font-semibold text-forest-700"
                        disabled={busy}
                        onClick={() => read(item._id)}
                      >
                        Mark as read
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Pagination data={data} page={page} setPage={setPage} />
        </div>
      )}
    </>
  );
}

function NotificationContent({ item }) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="break-words text-[15px] font-semibold">
          {item.title}
          {!item.readAt && <span className="ml-2 text-[13px] text-forest-700">Unread</span>}
        </h2>
        <time dateTime={item.createdAt} className="text-[13px] text-slate-500">
          {dayjs(item.createdAt).format('DD MMM YYYY, h:mm A')}
        </time>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-[15px] text-slate-600">{item.message}</p>
    </>
  );
}
