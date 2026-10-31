import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getSession, onSessionChange, setSession } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState(() => {
    const s = getSession();
    return { user: s ? s.user : null, permissions: s ? s.permissions : [], customer: s ? s.customer : null, ready: !s };
  });

  // Re-validate a stored session on load (the server may have restarted/reset).
  useEffect(() => {
    if (!getSession()) return;
    api.get('/auth/me')
      .then((r) => {
        setSession({ ...getSession(), ...r.data });
        setState({ user: r.data.user, permissions: r.data.permissions, customer: r.data.customer || null, ready: true });
      })
      .catch(() => { setSession(null); setState({ user: null, permissions: [], customer: null, ready: true }); });
  }, []);

  useEffect(() => onSessionChange((s) => {
    if (!s) setState({ user: null, permissions: [], customer: null, ready: true });
  }), []);

  const login = useCallback(async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    const { accessToken, refreshToken, user, permissions, customer } = r.data;
    setSession({ accessToken, refreshToken, user, permissions, customer });
    setState({ user, permissions, customer: customer || null, ready: true });
    return user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* session may already be gone */ }
    setSession(null);
  }, []);

  const refreshMe = useCallback(async () => {
    const r = await api.get('/auth/me');
    setSession({ ...getSession(), ...r.data });
    setState((s) => ({ ...s, user: r.data.user, permissions: r.data.permissions, customer: r.data.customer || null }));
  }, []);

  const value = useMemo(() => ({
    ...state,
    login,
    logout,
    refreshMe,
    can: (...perms) => perms.some((p) => state.permissions.includes(p)),
    role: state.user ? state.user.role : null,
    isCustomer: state.user && state.user.role === 'customer',
    isStaff: state.user && state.user.role !== 'customer',
  }), [state, login, logout, refreshMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
