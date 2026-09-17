import { createContext, useContext, useRef, useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
const Context = createContext(null);
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  function notify(message, type = 'success') {
    const id = crypto.randomUUID();
    setToasts((t) => [...t, { id, message, type }]);
    timers.current.push(setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000));
  }
  return (
    <Context.Provider value={notify}>
      {children}
      <div
        className="fixed bottom-5 right-5 z-[100] flex w-[min(420px,calc(100%-40px))] flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-lg"
          >
            {t.type === 'error' ? (
              <AlertCircle className="shrink-0 text-red-600" size={20} />
            ) : (
              <CheckCircle2 className="shrink-0 text-forest-700" size={20} />
            )}
            <span className="flex-1">{t.message}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setToasts((v) => v.filter((x) => x.id !== t.id))}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </Context.Provider>
  );
}
export const useToast = () => useContext(Context);
