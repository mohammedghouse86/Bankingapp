// Thin fetch wrapper: base URL resolution, bearer auth, single-flight token
// refresh, structured errors and file downloads.
const runtime = (typeof window !== 'undefined' && window.__KESTREL_CONFIG__) || {};
export const API_URL = (runtime.apiUrl || import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/+$/, '');
const PREFIX = `${API_URL}/api/v1`;
const STORE_KEY = 'kestrel.session';

export class ApiError extends Error {
  constructor(status, body) {
    const err = (body && body.error) || {};
    super(err.message || (status === 0 ? 'Cannot reach the server. Check your connection or the API URL.' : `Request failed (${status})`));
    this.status = status;
    this.code = err.code || (status === 0 ? 'NETWORK_ERROR' : 'ERROR');
    this.details = err.details;
    this.requestId = err.requestId;
  }

  /** Field-level messages from validation errors, keyed by field path. */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(this.details.filter((d) => d && d.field).map((d) => [d.field, d.message]));
  }
}

let session = null;
try { session = JSON.parse(sessionStorage.getItem(STORE_KEY)); } catch { session = null; }
const listeners = new Set();

export function getSession() { return session; }
export function setSession(next) {
  session = next;
  try {
    if (next) sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(STORE_KEY);
  } catch { /* storage unavailable (private mode) - keep in memory */ }
  listeners.forEach((fn) => fn(next));
}
export function onSessionChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let refreshing = null;
async function refreshTokens() {
  if (!session || !session.refreshToken) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${PREFIX}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: session.refreshToken }) });
        if (!res.ok) return false;
        const body = await res.json();
        setSession({ ...session, accessToken: body.data.accessToken, refreshToken: body.data.refreshToken });
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => { refreshing = null; }, 0);
      }
    })();
  }
  return refreshing;
}

function qs(params) {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
}

async function raw(method, path, { body, params, headers = {}, retry = true } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (session && session.accessToken) h.Authorization = `Bearer ${session.accessToken}`;
  let res;
  try {
    res = await fetch(`${PREFIX}${path}${qs(params)}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, null);
  }
  if (res.status === 401 && retry && session && path !== '/auth/login') {
    if (await refreshTokens()) return raw(method, path, { body, params, headers, retry: false });
    setSession(null);
  }
  return res;
}

async function request(method, path, opts) {
  const res = await raw(method, path, opts);
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (path, params, opts = {}) => request('GET', path, { ...opts, params }),
  post: (path, body = {}, opts = {}) => request('POST', path, { ...opts, body }),
  put: (path, body = {}, opts = {}) => request('PUT', path, { ...opts, body }),
  patch: (path, body = {}, opts = {}) => request('PATCH', path, { ...opts, body }),
  del: (path, opts = {}) => request('DELETE', path, opts),
  /** Download a binary/text response (CSV, HTML) and trigger a save dialog. */
  async download(path, params, fallbackName, opts = {}) {
    const res = await raw('GET', path, { ...opts, params });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new ApiError(res.status, data);
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const match = cd.match(/filename="?([^";]+)"?/);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = match ? match[1] : fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
