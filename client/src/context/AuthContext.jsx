import { createContext, useContext, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
const Context = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/auth/me');
      setUser(response.data.data);
    } catch (err) {
      setUser(null);
      if (err.response?.status !== 401) setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
    const expire = () => setUser(null);
    window.addEventListener('auth:expired', expire);
    return () => window.removeEventListener('auth:expired', expire);
  }, []);
  async function login(values) {
    const res = await api.post('/auth/login', values);
    setUser(res.data.data);
    return res.data.data;
  }
  async function logout() {
    await api.post('/auth/logout');
    setUser(null);
  }
  return (
    <Context.Provider value={{ user, loading, error, refresh, login, logout, setUser }}>
      {children}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
