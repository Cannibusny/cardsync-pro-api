import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost } from './api';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    apiGet('/api/auth/me')
      .then((d) => setUser(d.user || null))
      .catch(() => setUser(null))
      .finally(() => setLoaded(true));
  }, []);

  const login = useCallback(async (email, password) => {
    const out = await apiPost('/api/auth/login', { email, password });
    setUser(out.user);
    return out.user;
  }, []);

  const logout = useCallback(async () => {
    try { await apiPost('/api/auth/logout'); } catch (_e) { /* noop */ }
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, login, logout, loaded }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

const ROLE_RANK = { owner: 4, manager: 3, employee: 2, view_only: 1 };
export function hasRole(user, min) {
  if (!user) return false;
  return (ROLE_RANK[user.role] || 0) >= (ROLE_RANK[min] || 99);
}
