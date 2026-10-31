import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bell, CheckCheck, LogOut, Monitor, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import {
  Alert, Async, Button, Card, ConfirmDialog, EmptyState, Field, Modal, PageHeader, StatusBadge, Tabs, fmtDate, fmtDateTime,
  useApi, useForm, useToast, label, timeAgo, errorText,
} from '../ui';
import { ContactModal } from './customers';

export function Profile() {
  const { user, isCustomer } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'security' ? 'security' : 'profile';
  return (
    <>
      <PageHeader title="Profile & security" subtitle={`${user.firstName} ${user.lastName} · ${user.email}`} />
      <Tabs value={tab} onChange={(v) => setSp(v === 'profile' ? {} : { tab: v }, { replace: true })} tabs={[{ value: 'profile', label: 'Profile' }, { value: 'security', label: 'Password & sessions' }]} />
      {tab === 'profile' && (isCustomer ? <CustomerProfile /> : <StaffProfile />)}
      {tab === 'security' && <Security />}
    </>
  );
}

function StaffProfile() {
  const { user, permissions } = useAuth();
  return (
    <div className="grid grid-main">
      <Card title="Employee profile" subtitle="Contact your administrator to change these details.">
        <dl className="dl">
          <dt>Name</dt><dd>{user.firstName} {user.lastName}</dd>
          <dt>Email</dt><dd>{user.email}</dd>
          <dt>Phone</dt><dd>{user.phone || '—'}</dd>
          <dt>Role</dt><dd style={{ textTransform: 'capitalize' }}>{label(user.role)}</dd>
          <dt>Title</dt><dd>{user.title || '—'}</dd>
          <dt>Branch</dt><dd>{user.branchName || 'Head office'}</dd>
          <dt>Employee code</dt><dd className="mono">{user.employeeCode}</dd>
          <dt>Hired</dt><dd>{fmtDate(user.hireDate)}</dd>
        </dl>
      </Card>
      <Card title="Your permissions">
        <div className="row" style={{ gap: 6 }}>{permissions.map((p) => <span key={p} className="badge gray" style={{ textTransform: 'none' }}>{p}</span>)}</div>
      </Card>
    </div>
  );
}

function CustomerProfile() {
  const { refreshMe } = useAuth();
  const toast = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [dialog, setDialog] = useState(null);
  const q = useApi('/me/profile', null, { reloadKey });
  const reload = () => { setReloadKey((k) => k + 1); refreshMe().catch(() => {}); };
  return (
    <Async q={q}>{(c) => (
      <div className="grid grid-main">
        <Card title="Personal details" actions={<><Button size="sm" variant="secondary" onClick={() => setDialog('address')}>Edit address</Button><Button size="sm" variant="secondary" onClick={() => setDialog('contact')}>Change email / phone</Button></>}>
          <dl className="dl">
            <dt>Name</dt><dd>{c.fullName}</dd>
            <dt>Customer number</dt><dd className="mono">{c.customerNumber}</dd>
            <dt>Email</dt><dd>{c.email}</dd>
            <dt>Phone</dt><dd>{c.phone}</dd>
            <dt>Date of birth</dt><dd>{fmtDate(c.dateOfBirth)}</dd>
            <dt>Address</dt><dd>{c.address.line1}, {c.address.city}, {c.address.state} {c.address.postalCode}</dd>
            <dt>Occupation</dt><dd>{c.occupation || '—'}</dd>
            <dt>Home branch</dt><dd>{c.branchName}</dd>
          </dl>
        </Card>
        <Card title="Verification">
          <dl className="dl">
            <dt>Profile status</dt><dd><StatusBadge status={c.status} /></dd>
            <dt>Identity</dt><dd><StatusBadge status={c.kycStatus} /></dd>
            {c.kyc && <><dt>Document</dt><dd>{label(c.kyc.documentType)} {c.kyc.documentNumberMasked}</dd></>}
            <dt>National ID</dt><dd className="mono">{c.nationalIdMasked}</dd>
          </dl>
          <p className="subtle" style={{ marginBottom: 0 }}>To change your name or date of birth, visit your branch with a photo ID.</p>
        </Card>
        {dialog === 'contact' && <ContactModal c={c} self onClose={() => setDialog(null)} onSaved={reload} />}
        {dialog === 'address' && <AddressDialog c={c} onClose={() => setDialog(null)} onDone={() => { toast.success('Address updated'); reload(); }} />}
      </div>
    )}</Async>
  );
}

function AddressDialog({ c, onClose, onDone }) {
  const f = useForm({ ...c.address, occupation: c.occupation || '' });
  const v = f.values;
  const onSubmit = f.submit(async (x) => {
    const body = { address: { line1: x.line1, city: x.city, state: x.state, postalCode: x.postalCode, country: x.country || 'US' } };
    if (x.occupation) body.occupation = x.occupation;
    await api.patch('/me/profile', body);
    onDone();
    onClose();
  });
  return (
    <Modal title="Update address" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="addr" loading={f.busy}>Save</Button></>}>
      <form id="addr" className="form" onSubmit={onSubmit}>
        <div className="form-grid">
          <Field label="Street" className="full" error={f.errors['address.line1']}><input className="input" value={v.line1} onChange={f.set('line1')} required /></Field>
          <Field label="City" error={f.errors['address.city']}><input className="input" value={v.city} onChange={f.set('city')} required /></Field>
          <Field label="State" error={f.errors['address.state']}><input className="input" value={v.state} onChange={f.set('state')} required /></Field>
          <Field label="Postal code" error={f.errors['address.postalCode']}><input className="input" value={v.postalCode} onChange={f.set('postalCode')} required /></Field>
          <Field label="Occupation" error={f.errors.occupation}><input className="input" value={v.occupation} onChange={f.set('occupation')} /></Field>
        </div>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

function Security() {
  const toast = useToast();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const sessions = useApi('/auth/sessions', null, { reloadKey });
  const [confirmAll, setConfirmAll] = useState(false);
  const f = useForm({ currentPassword: '', newPassword: '', confirm: '' });
  const onSubmit = f.submit(async (v) => {
    if (v.newPassword !== v.confirm) throw new Error('New passwords do not match');
    const r = await api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword });
    f.setValues({ currentPassword: '', newPassword: '', confirm: '' });
    toast.success('Password changed', `${r.data.otherSessionsRevoked} other session(s) were signed out.`);
    setReloadKey((k) => k + 1);
  });
  const revoke = async (s) => {
    try { await api.del(`/auth/sessions/${s.id}`); toast.success('Session signed out'); setReloadKey((k) => k + 1); } catch (e) { toast.error('Could not revoke', errorText(e)); }
  };
  return (
    <div className="grid grid-2">
      <Card title="Change password">
        <form className="form" onSubmit={onSubmit}>
          <Field label="Current password" error={f.errors.currentPassword}><input type="password" className="input" autoComplete="current-password" value={f.values.currentPassword} onChange={f.set('currentPassword')} required /></Field>
          <Field label="New password" error={f.errors.newPassword} hint="10+ characters with upper and lower case, a number and a symbol"><input type="password" className="input" autoComplete="new-password" value={f.values.newPassword} onChange={f.set('newPassword')} required /></Field>
          <Field label="Confirm new password"><input type="password" className="input" autoComplete="new-password" value={f.values.confirm} onChange={f.set('confirm')} required /></Field>
          <Alert>{f.formError}</Alert>
          <Button type="submit" loading={f.busy}>Update password</Button>
        </form>
      </Card>
      <Card title="Active sessions" actions={<Button size="sm" variant="secondary" onClick={() => setConfirmAll(true)}><LogOut size={14} />Sign out everywhere</Button>}>
        <Async q={sessions}>{(list) => (
          <ul className="timeline">
            {list.map((s) => (
              <li key={s.id}>
                <Monitor size={18} color="var(--text-3)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row"><b className="mono">{s.ip}</b>{s.current && <span className="badge green">This session</span>}</div>
                  <div className="subtle" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.userAgent || 'Unknown client'}</div>
                  <div className="subtle">Started {fmtDateTime(s.createdAt)} · active {timeAgo(s.lastUsedAt)}</div>
                </div>
                {!s.current && <Button size="sm" variant="ghost" onClick={() => revoke(s)}>Sign out</Button>}
              </li>
            ))}
          </ul>
        )}</Async>
      </Card>
      {confirmAll && (
        <ConfirmDialog danger title="Sign out everywhere" confirmLabel="Sign out all sessions" message="All sessions, including this one, will be signed out." onClose={() => setConfirmAll(false)}
          onConfirm={async () => { await api.post('/auth/logout-all'); await logout(); navigate('/login'); }} />
      )}
    </div>
  );
}

export function Notifications() {
  const toast = useToast();
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const q = useApi('/notifications', { unreadOnly: unreadOnly ? 'true' : undefined, page, pageSize: 20 }, { reloadKey });
  const reload = () => setReloadKey((k) => k + 1);
  const act = async (fn, msg) => { try { await fn(); if (msg) toast.success(msg); reload(); } catch (e) { toast.error('Action failed', errorText(e)); } };
  const open = async (n) => {
    if (!n.read) await api.post(`/notifications/${n.id}/read`).catch(() => {});
    if (n.link) navigate(n.link); else reload();
  };
  return (
    <>
      <PageHeader title="Notifications" actions={<Button variant="secondary" onClick={() => act(() => api.post('/notifications/read-all'), 'All notifications marked as read')}><CheckCheck size={15} />Mark all read</Button>} />
      <Tabs value={unreadOnly ? 'unread' : 'all'} onChange={(v) => { setUnreadOnly(v === 'unread'); setPage(1); }} tabs={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }]} />
      <Card flush>
        <Async q={q}>{(list, body) => (list.length === 0 ? <EmptyState icon={Bell} title="You're all caught up" message="New alerts about your accounts and security will appear here." /> : (
          <>
            <ul className="timeline">
              {list.map((n) => (
                <li key={n.id} className={n.read ? '' : 'notif-unread'} style={{ padding: '12px 16px' }}>
                  <Bell size={18} color={n.read ? 'var(--text-3)' : 'var(--primary)'} />
                  <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => open(n)} onKeyDown={(e) => { if (e.key === 'Enter') open(n); }} role="button" tabIndex={0}>
                    <div className="row"><b>{n.title}</b><StatusBadge status={n.type} tone="gray" /></div>
                    <div className="muted">{n.message}</div>
                    <div className="subtle">{timeAgo(n.createdAt)}</div>
                  </div>
                  {!n.read && <Button size="sm" variant="ghost" onClick={() => act(() => api.post(`/notifications/${n.id}/read`))}>Mark read</Button>}
                  <Button size="sm" variant="ghost" aria-label="Delete notification" onClick={() => act(() => api.del(`/notifications/${n.id}`), 'Notification deleted')}><Trash2 size={14} /></Button>
                </li>
              ))}
            </ul>
            {body.pagination.totalPages > 1 && (
              <div className="pagination">
                <span>Page {body.pagination.page} of {body.pagination.totalPages}</span>
                <div className="row"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="secondary" disabled={page >= body.pagination.totalPages} onClick={() => setPage(page + 1)}>Next</Button></div>
              </div>
            )}
          </>
        ))}</Async>
      </Card>
    </>
  );
}
