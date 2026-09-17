import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';

const Context = createContext(null);
export function NotificationProvider({ children }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [unread, setUnread] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef(null);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    try {
      const response = await api.get('/notifications', {
        params: { page, limit: 20, unread },
        signal: request.signal,
      });
      if (request.signal.aborted || !mounted.current) return;
      setData(response.data.data);
      setError('');
      if (page > Math.max(1, response.data.data.pages))
        setPage(Math.max(1, response.data.data.pages));
    } catch (err) {
      if (!request.signal.aborted && mounted.current) setError(errorMessage(err));
    }
  }, [page, unread]);

  useEffect(() => {
    mounted.current = true;
    setData(null);
    refresh();
    const poll = () => {
      if (!document.hidden) refresh();
    };
    const timer = setInterval(poll, 30000);
    document.addEventListener('visibilitychange', poll);
    window.addEventListener('focus', poll);
    return () => {
      mounted.current = false;
      controller.current?.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
      window.removeEventListener('focus', poll);
    };
  }, [refresh]);

  async function markRead(id) {
    setBusy(true);
    try {
      await api.patch(id ? `/notifications/${id}/read` : '/notifications/read-all');
      if (mounted.current) await refresh();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Context.Provider
      value={{ data, page, setPage, unread, setUnread, error, busy, refresh, markRead }}
    >
      {children}
    </Context.Provider>
  );
}
export const useNotifications = () => useContext(Context);
