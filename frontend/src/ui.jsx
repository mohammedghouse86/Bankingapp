import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Inbox, Info, Lock, RefreshCw, X } from 'lucide-react';
import { api, ApiError } from './api';

// --------------------------------------------------------------- format ----
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : usd.format(n));
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const label = (s) => (s ? String(s).replace(/_/g, ' ') : '—');
export const initials = (first = '', last = '') => `${first[0] || ''}${last[0] || ''}`.toUpperCase();
export const today = () => new Date().toISOString().slice(0, 10);
export const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
export function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(iso);
}

export function errorText(e) {
  if (!e) return '';
  if (e instanceof ApiError && Array.isArray(e.details) && e.details.length && e.details[0].message) {
    return `${e.message}: ${e.details.map((d) => (d.field ? `${d.field} - ${d.message}` : d.message)).join('; ')}`;
  }
  return e.message || 'Something went wrong';
}

// --------------------------------------------------------------- hooks -----
/** GET a resource; returns the response body ({data, pagination}). */
export function useApi(path, params, { skip = false, reloadKey = 0 } = {}) {
  const [state, setState] = useState({ body: null, loading: !skip && Boolean(path), error: null });
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(params || {});
  useEffect(() => {
    if (skip || !path) { setState({ body: null, loading: false, error: null }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(path, params)
      .then((body) => { if (alive) setState({ body, loading: false, error: null }); })
      .catch((error) => { if (alive) setState({ body: null, loading: false, error }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, tick, skip, reloadKey]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, data: state.body ? state.body.data : null, reload };
}

// --------------------------------------------------------------- toasts ----
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((type, title, message) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-3), { id, type, title, message }]);
    setTimeout(() => dismiss(id), type === 'error' ? 7000 : 4500);
  }, [dismiss]);
  const api_ = useRef({
    success: (title, message) => push('success', title, message),
    error: (title, message) => push('error', title, message),
    info: (title, message) => push('info', title, message),
  });
  return (
    <ToastCtx.Provider value={api_.current}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === 'success' ? <CheckCircle2 size={18} color="var(--accent)" /> : t.type === 'error' ? <AlertCircle size={18} color="var(--danger)" /> : <Info size={18} color="var(--info)" />}
            <div><b>{t.title}</b>{t.message && <p>{t.message}</p>}</div>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)}><X size={16} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ------------------------------------------------------------ primitives ---
export function Button({ variant = 'primary', size, loading, children, className = '', ...rest }) {
  return (
    <button type="button" className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading && <span className="spinner sm" />}
      {children}
    </button>
  );
}

export function Card({ title, subtitle, actions, children, flush, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          <div>{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className={`card-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

const BADGE = {
  green: ['active', 'completed', 'verified', 'approved', 'resolved', 'resolved_refunded', 'executed', 'success', 'credit', 'low'],
  amber: ['pending', 'pending_approval', 'pending_verification', 'pending_review', 'pending_activation', 'open', 'in_progress', 'under_review', 'dormant', 'medium', 'monitor', 'high_risk', 'high'],
  red: ['frozen', 'rejected', 'failed', 'suspended', 'inactive', 'locked', 'denied', 'failure', 'blocked', 'critical', 'debit', 'enforce'],
  gray: ['closed', 'cancelled', 'withdrawn', 'reversed', 'disabled', 'unverified', 'deleted', 'standard'],
};
export function StatusBadge({ status, tone }) {
  const color = tone || Object.keys(BADGE).find((k) => BADGE[k].includes(status)) || 'blue';
  return <span className={`badge ${color}`}>{label(status)}</span>;
}

export function Field({ label: text, error, hint, children, className = '', htmlFor }) {
  return (
    <div className={`field ${className}`}>
      {text && <label htmlFor={htmlFor}>{text}</label>}
      {children}
      {error ? <span className="error-text" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Alert({ type = 'error', children }) {
  if (!children) return null;
  return <div className={`alert ${type}`}>{type === 'error' ? <AlertCircle size={18} /> : <Info size={18} />}<div>{children}</div></div>;
}

export function Loading({ label: text = 'Loading…' }) {
  return <div className="loading-block" aria-busy="true"><div className="row"><div className="spinner" /><span className="muted">{text}</span></div></div>;
}

export function EmptyState({ icon: Icon = Inbox, title = 'Nothing here yet', message, action }) {
  return (
    <div className="empty">
      <Icon size={36} />
      <h3>{title}</h3>
      {message && <p className="muted" style={{ margin: '0 0 12px' }}>{message}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  const notFound = error && error.status === 404;
  const denied = error && error.status === 403;
  return (
    <div className="empty">
      {denied ? <Lock size={36} /> : <AlertCircle size={36} />}
      <h3>{notFound ? 'Not found' : denied ? 'Access denied' : 'Could not load data'}</h3>
      <p className="muted" style={{ margin: '0 0 12px' }}>{notFound ? 'This item does not exist or you do not have access to it.' : errorText(error)}</p>
      {onRetry && !notFound && !denied && <Button variant="secondary" onClick={onRetry}><RefreshCw size={15} />Try again</Button>}
    </div>
  );
}

/** Render loading / error / content for a useApi() result. */
export function Async({ q, children, loadingLabel }) {
  if (q.loading && !q.body) return <Loading label={loadingLabel} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.body) return null;
  return children(q.data, q.body);
}

export function PageHeader({ title, subtitle, actions, crumbs }) {
  return (
    <div className="page-header">
      <div>
        {crumbs && (
          <nav className="breadcrumb" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={c.label} className="row" style={{ gap: 6 }}>
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
                {i < crumbs.length - 1 && <ChevronRight size={12} />}
              </span>
            ))}
          </nav>
        )}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value} className={`tab ${value === t.value ? 'active' : ''}`} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ icon: Icon, label: text, value, sub, tone }) {
  return (
    <div className="card stat">
      {Icon && <div className={`stat-icon ${tone || ''}`}><Icon size={20} /></div>}
      <div style={{ minWidth: 0 }}>
        <div className="stat-label">{text}</div>
        <div className="stat-value">{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

export function Amount({ value, signed, direction }) {
  const neg = direction === 'debit' || (signed && value < 0);
  const pos = direction === 'credit' || (signed && value > 0);
  return <span className={`num ${neg ? 'neg' : pos ? 'pos' : ''}`}>{direction === 'debit' ? '−' : direction === 'credit' ? '+' : ''}{money(Math.abs(value))}</span>;
}

// ---------------------------------------------------------------- modal ----
export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const first = ref.current && ref.current.querySelector('input, select, textarea, button:not([aria-label="Close"])');
    if (first) first.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-header"><h2>{title}</h2><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Confirmation dialog for sensitive actions. `onConfirm(reason)` may throw;
 * the error is shown inline and the dialog stays open.
 */
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, reason, reasonLabel = 'Reason', onConfirm, onClose, children }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (reason && text.trim().length < 3) { setError(new Error(`${reasonLabel} is required (at least 3 characters)`)); return; }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(text.trim());
      onClose();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={busy ? () => {} : onClose}>
      <form className="form" onSubmit={submit}>
        {message && <p style={{ margin: 0 }} className="muted">{message}</p>}
        {children}
        {reason && (
          <Field label={reasonLabel} htmlFor="confirm-reason">
            <textarea id="confirm-reason" className="textarea" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
        <Alert>{error && errorText(error)}</Alert>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={busy}>{confirmLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

// -------------------------------------------------------------- step-up ----
const StepUpCtx = createContext(null);
export function StepUpProvider({ children }) {
  const [prompt, setPrompt] = useState(null);
  const run = useCallback(async (fn) => {
    try {
      return await fn({});
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 'STEP_UP_REQUIRED') throw e;
      return new Promise((resolve, reject) => setPrompt({ fn, resolve, reject }));
    }
  }, []);
  return (
    <StepUpCtx.Provider value={run}>
      {children}
      {prompt && <StepUpDialog prompt={prompt} onDone={() => setPrompt(null)} />}
    </StepUpCtx.Provider>
  );
}
function StepUpDialog({ prompt, onDone }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cancel = () => { prompt.reject(Object.assign(new Error('Action cancelled'), { cancelled: true })); onDone(); };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await prompt.fn({ 'X-Confirm-Password': pw });
      prompt.resolve(result);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_FAILED') { setError(err); setBusy(false); return; }
      prompt.reject(err);
      onDone();
    }
  };
  return (
    <Modal title="Confirm it's you" onClose={busy ? () => {} : cancel}>
      <form className="form" onSubmit={submit}>
        <div className="alert warning"><Lock size={18} /><div>This is a critical action. Re-enter your password to continue.</div></div>
        <Field label="Password" htmlFor="stepup-pw"><input id="stepup-pw" type="password" className="input" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
        <Alert>{error && 'Password confirmation failed. Try again.'}</Alert>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={cancel} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!pw}>Confirm</Button>
        </div>
      </form>
    </Modal>
  );
}
/** Returns run(fn): fn(headers) is retried with X-Confirm-Password when the API demands step-up. */
export const useStepUp = () => useContext(StepUpCtx);

// ------------------------------------------------------------ data table ---
/**
 * Server-paginated table. `columns`: [{ key, label, render?, sort?, num? }].
 * `params` are extra query params (filters); changing them resets to page 1.
 */
export function DataTable({ path, params = {}, columns, onRowClick, empty, initialSort, reloadKey = 0, pageSize: initialPageSize = 20 }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [sort, setSort] = useState(initialSort || null);
  const filterKey = JSON.stringify(params);
  useEffect(() => { setPage(1); }, [filterKey]);
  const q = useApi(path, { ...params, page, pageSize, sort: sort ? sort.key : undefined, order: sort ? sort.order : undefined }, { reloadKey });
  const toggleSort = (c) => {
    if (!c.sort) return;
    setSort((s) => (s && s.key === c.sort ? { key: c.sort, order: s.order === 'asc' ? 'desc' : 'asc' } : { key: c.sort, order: 'desc' }));
  };
  const rows = q.data || [];
  const p = q.body && q.body.pagination;
  return (
    <div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`${c.sort ? 'sortable' : ''} ${c.num ? 'num' : ''}`} onClick={() => toggleSort(c)} aria-sort={sort && sort.key === c.sort ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.label}{sort && sort.key === c.sort ? (sort.order === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.loading && !q.body && Array.from({ length: 5 }).map((_, i) => (
              <tr key={`sk${i}`}>{columns.map((c) => <td key={c.key}><div className="skeleton" /></td>)}</tr>
            ))}
            {rows.map((r, i) => (
              <tr key={r.id ?? i} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {!q.loading && !q.error && rows.length === 0 && (empty || <EmptyState title="No results" message="Try adjusting your filters." />)}
      {p && p.total > 0 && (
        <div className="pagination">
          <span>{(p.page - 1) * p.pageSize + 1}–{Math.min(p.page * p.pageSize, p.total)} of {p.total.toLocaleString()}</span>
          <div className="row">
            <select className="select" style={{ width: 'auto', height: 30 }} value={pageSize} aria-label="Rows per page" onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </select>
            <Button variant="secondary" size="sm" disabled={p.page <= 1 || q.loading} onClick={() => setPage(p.page - 1)} aria-label="Previous page"><ChevronLeft size={15} /></Button>
            <span>Page {p.page} of {p.totalPages}</span>
            <Button variant="secondary" size="sm" disabled={p.page >= p.totalPages || q.loading} onClick={() => setPage(p.page + 1)} aria-label="Next page"><ChevronRight size={15} /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Debounced value, for search boxes. */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Simple form-state helper with field errors from ApiError details. */
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => {
    const v = e && e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setValues((s) => ({ ...s, [k]: v }));
    setErrors((s) => ({ ...s, [k]: undefined }));
  };
  const submit = (fn) => async (e) => {
    if (e) e.preventDefault();
    setBusy(true);
    setFormError(null);
    setErrors({});
    try {
      await fn(values);
    } catch (err) {
      if (err && err.cancelled) { setBusy(false); return; }
      const fe = err instanceof ApiError ? err.fieldErrors : {};
      setErrors(fe);
      setFormError(Object.keys(fe).length ? err.message : errorText(err));
    }
    setBusy(false);
  };
  return { values, setValues, set, errors, formError, setFormError, busy, submit };
}
