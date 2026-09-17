import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext';

export default function NotificationBell() {
  const { data, error } = useNotifications();
  const count = data?.unreadCount || 0;
  return (
    <Link
      to="/notifications"
      className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-50"
      aria-label={error ? 'Notifications, refresh unavailable' : `Notifications, ${count} unread`}
    >
      <Bell size={20} />
      {(count > 0 || error) && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 min-w-4 rounded-full bg-forest-700 px-1 text-center text-[11px] text-white"
        >
          {error ? '!' : count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
