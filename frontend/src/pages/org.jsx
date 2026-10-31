import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Building2, KeyRound, LogOut, Pencil, Plus, Search, Trash2, Unlock, UserCheck, UserCog, UserX } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import {
  Alert, Async, Button, Card, ConfirmDialog, DataTable, Field, Modal, PageHeader, Stat, StatusBadge, Tabs, fmtDate, fmtDateTime,
  money, useApi, useDebounced, useForm, useStepUp, useToast, label, initials, timeAgo,
} from '../ui';

export function Employees() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [branchId, setBranch] = useState('');
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const branches = useApi(user.role === 'super_admin' ? '/branches' : null, { pageSize: 50 });
  const s = useDebounced(search);
  return (
    <>
      <PageHeader title="Employees" subtitle={user.role === 'super_admin' ? 'All staff across the bank.' : `Staff of ${user.branchName}.`} actions={can('users:manage') && <Button onClick={() => setCreating(true)}><Plus size={16} />Add employee</Button>} />
      <Card flush title={(
        <div className="filters">
          <div className="input-prefix search"><span><Search size={14} /></span><input className="input" placeholder="Name, email or employee code" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search employees" /></div>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role"><option value="">All roles</option>{(user.role === 'super_admin' ? ['super_admin', 'manager', 'teller'] : ['manager', 'teller']).map((r) => <option key={r} value={r}>{label(r)}</option>)}</select>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
          {branches.data && <select className="select" value={branchId} onChange={(e) => setBranch(e.target.value)} aria-label="Branch"><option value="">All branches</option>{branches.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        </div>
      )}>
        <DataTable path="/users" params={{ search: s, role, status, branchId }} reloadKey={reloadKey} initialSort={{ key: 'name', order: 'asc' }} onRowClick={(u) => navigate(`/employees/${u.id}`)}
          columns={[
            { key: 'name', label: 'Employee', sort: 'name', render: (u) => <div className="row" style={{ flexWrap: 'nowrap' }}><span className="avatar">{initials(u.firstName, u.lastName)}</span><div><b>{u.firstName} {u.lastName}</b><div className="subtle">{u.email}</div></div></div> },
            { key: 'employeeCode', label: 'Code', render: (u) => <span className="mono">{u.employeeCode}</span> },
            { key: 'role', label: 'Role', sort: 'role', render: (u) => <StatusBadge status={u.role} tone={u.role === 'super_admin' ? 'purple' : u.role === 'manager' ? 'blue' : 'gray'} /> },
            { key: 'title', label: 'Title' },
            { key: 'branchName', label: 'Branch', render: (u) => u.branchName || 'Head office' },
            { key: 'status', label: 'Status', render: (u) => <span className="row"><StatusBadge status={u.status} />{u.locked && <StatusBadge status="locked" />}</span> },
            { key: 'lastLoginAt', label: 'Last sign-in', sort: 'lastLoginAt', render: (u) => timeAgo(u.lastLoginAt) },
          ]} />
      </Card>
      {creating && <NewEmployeeModal onClose={() => setCreating(false)} onCreated={() => setReloadKey((k) => k + 1)} branches={branches.data} />}
    </>
  );
}

function NewEmployeeModal({ onClose, onCreated, branches }) {
  const { can, user } = useAuth();
  const [created, setCreated] = useState(null);
  const privileged = can('users:privileged');
  const f = useForm({ firstName: '', lastName: '', email: '', phone: '', role: 'teller', branchId: user.branchId ? String(user.branchId) : '', title: '' });
  const v = f.values;
  const onSubmit = f.submit(async (x) => {
    const body = { firstName: x.firstName, lastName: x.lastName, email: x.email, role: x.role };
    if (x.phone) body.phone = x.phone;
    if (x.title) body.title = x.title;
    if (x.role !== 'super_admin' && x.branchId) body.branchId = Number(x.branchId);
    const r = await api.post('/users', body);
    setCreated(r.data);
    onCreated();
  });
  if (created) {
    return (
      <Modal title="Employee created" onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
        <div className="stack">
          <Alert type="success">{created.firstName} {created.lastName} ({label(created.role)}) can now sign in as {created.email}.</Alert>
          <Field label="One-time temporary password" hint="Share securely; it will not be shown again."><div className="code-box">{created.temporaryPassword}</div></Field>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Add employee" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="new-emp" loading={f.busy}>Create employee</Button></>}>
      <form id="new-emp" className="form" onSubmit={onSubmit}>
        <div className="form-grid">
          <Field label="First name" error={f.errors.firstName}><input className="input" value={v.firstName} onChange={f.set('firstName')} required /></Field>
          <Field label="Last name" error={f.errors.lastName}><input className="input" value={v.lastName} onChange={f.set('lastName')} required /></Field>
          <Field label="Work email" className="full" error={f.errors.email}><input type="email" className="input" value={v.email} onChange={f.set('email')} required /></Field>
          <Field label="Role" error={f.errors.role}>
            <select className="select" value={v.role} onChange={f.set('role')}>
              <option value="teller">Teller</option>
              {privileged && <option value="manager">Manager</option>}
              {privileged && <option value="super_admin">Super admin</option>}
            </select>
          </Field>
          <Field label="Branch" error={f.errors.branchId}>
            {privileged ? (
              <select className="select" value={v.branchId} onChange={f.set('branchId')} disabled={v.role === 'super_admin'} required={v.role !== 'super_admin'}>
                <option value="">{v.role === 'super_admin' ? 'Head office' : 'Select…'}</option>
                {(branches || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            ) : <input className="input" value={user.branchName} disabled />}
          </Field>
          <Field label="Job title (optional)"><input className="input" value={v.title} onChange={f.set('title')} /></Field>
          <Field label="Phone (optional)" error={f.errors.phone}><input className="input" value={v.phone} onChange={f.set('phone')} /></Field>
        </div>
        {!privileged && <Alert type="info">Managers can add tellers to their own branch. Managers and administrators are created by a super admin.</Alert>}
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

export function EmployeeDetail() {
  const { id } = useParams();
  const { user: me, can } = useAuth();
  const toast = useToast();
  const stepUp = useStepUp();
  const navigate = useNavigate();
  const [tab, setTab] = useState('activity');
  const [dialog, setDialog] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tempPw, setTempPw] = useState(null);
  const q = useApi(`/users/${id}`, null, { reloadKey });
  const reload = () => setReloadKey((k) => k + 1);
  return (
    <Async q={q}>{(u) => {
      const self = u.id === me.id;
      const manageable = !self && (me.role === 'super_admin' || (me.role === 'manager' && u.role === 'teller'));
      const priv = can('users:privileged') && !self;
      return (
        <>
          <PageHeader crumbs={[{ label: 'Employees', to: '/employees' }, { label: `${u.firstName} ${u.lastName}` }]}
            title={<span className="row">{u.firstName} {u.lastName} <StatusBadge status={u.status} />{u.locked && <StatusBadge status="locked" />}</span>}
            subtitle={`${u.title || label(u.role)} · ${u.branchName || 'Head office'} · ${u.employeeCode}`}
            actions={manageable && u.status !== 'deleted' && (
              <>
                {can('users:manage') && <Button variant="secondary" onClick={() => setDialog('edit')}><Pencil size={15} />Edit</Button>}
                {u.locked && <Button variant="secondary" onClick={async () => { try { await api.post(`/users/${u.id}/unlock`); toast.success('Account unlocked'); reload(); } catch (e) { toast.error('Unlock failed', e.message); } }}><Unlock size={15} />Unlock</Button>}
                <Button variant="secondary" onClick={() => setDialog('resetpw')}><KeyRound size={15} />Reset password</Button>
                {priv && <Button variant="secondary" onClick={() => setDialog('role')}><UserCog size={15} />Change role</Button>}
                {priv && u.role !== 'super_admin' && <Button variant="secondary" onClick={() => setDialog('branch')}><Building2 size={15} />Transfer branch</Button>}
                {priv && <Button variant="secondary" onClick={() => setDialog('signout')}><LogOut size={15} />Force sign-out</Button>}
                {u.status === 'active' ? <Button variant="danger" onClick={() => setDialog('deactivate')}><UserX size={15} />Deactivate</Button> : <Button variant="success" onClick={() => setDialog('activate')}><UserCheck size={15} />Activate</Button>}
                {priv && u.status === 'inactive' && <Button variant="ghost" onClick={() => setDialog('delete')}><Trash2 size={15} />Delete</Button>}
              </>
            )} />
          <div className="grid grid-main" style={{ marginBottom: 16 }}>
            <Card title="Profile">
              <dl className="dl">
                <dt>Email</dt><dd>{u.email}</dd>
                <dt>Phone</dt><dd>{u.phone || '—'}</dd>
                <dt>Role</dt><dd style={{ textTransform: 'capitalize' }}>{label(u.role)}</dd>
                <dt>Branch</dt><dd>{u.branchName || 'Head office'}</dd>
                <dt>Hired</dt><dd>{fmtDate(u.hireDate)}</dd>
                <dt>Last sign-in</dt><dd>{fmtDateTime(u.lastLoginAt)}</dd>
                <dt>Password changed</dt><dd>{fmtDateTime(u.passwordChangedAt)}</dd>
              </dl>
            </Card>
            {tempPw && (
              <Card title="Temporary password">
                <Alert type="success">Share this one-time password securely. It is not stored in readable form.</Alert>
                <div className="code-box" style={{ marginTop: 12 }}>{tempPw}</div>
              </Card>
            )}
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'activity', label: 'Activity' }, ...(can('users:privileged') ? [{ value: 'sessions', label: 'Sessions' }] : [])]} />
          {tab === 'activity' && (
            <Card flush>
              <DataTable path={`/users/${u.id}/activity`} initialSort={{ key: 'createdAt', order: 'desc' }} columns={[
                { key: 'createdAt', label: 'When', sort: 'createdAt', render: (a) => fmtDateTime(a.createdAt) },
                { key: 'action', label: 'Action', sort: 'action', render: (a) => <span className="mono">{a.action}</span> },
                { key: 'entity', label: 'Entity', render: (a) => (a.entityType ? `${a.entityType} #${a.entityId}` : '—') },
                { key: 'outcome', label: 'Outcome', render: (a) => <StatusBadge status={a.outcome} /> },
                { key: 'ip', label: 'IP', render: (a) => <span className="mono">{a.ip}</span> },
              ]} />
            </Card>
          )}
          {tab === 'sessions' && <UserSessions id={u.id} reloadKey={reloadKey} />}

          {dialog === 'edit' && <EditEmployee u={u} onClose={() => setDialog(null)} onDone={reload} />}
          {dialog === 'resetpw' && (
            <ConfirmDialog title="Reset password" confirmLabel="Generate temporary password" onClose={() => setDialog(null)}
              message="A one-time temporary password is generated and all of the employee's sessions are revoked. You will be asked to confirm your own password."
              onConfirm={async () => { const r = await stepUp((h) => api.post(`/users/${u.id}/reset-password`, {}, { headers: h })); setTempPw(r.data.temporaryPassword); toast.success('Password reset'); }} />
          )}
          {(dialog === 'deactivate' || dialog === 'activate') && (
            <ConfirmDialog title={dialog === 'deactivate' ? 'Deactivate employee' : 'Activate employee'} danger={dialog === 'deactivate'} reason confirmLabel={dialog === 'deactivate' ? 'Deactivate' : 'Activate'} onClose={() => setDialog(null)}
              message={dialog === 'deactivate' ? 'The employee is signed out immediately and cannot sign in again until re-activated.' : 'The employee will be able to sign in again.'}
              onConfirm={async (reason) => { await api.post(`/users/${u.id}/${dialog}`, { reason }); toast.success(`Employee ${dialog}d`); reload(); }} />
          )}
          {dialog === 'role' && <RoleDialog u={u} onClose={() => setDialog(null)} onDone={reload} />}
          {dialog === 'branch' && <BranchTransferDialog u={u} onClose={() => setDialog(null)} onDone={reload} />}
          {dialog === 'signout' && <ConfirmDialog title="Force sign-out" danger confirmLabel="Sign out everywhere" message="All active sessions of this employee are revoked." onClose={() => setDialog(null)} onConfirm={async () => { const r = await api.del(`/users/${u.id}/sessions`); toast.success(r.data.message); reload(); }} />}
          {dialog === 'delete' && <ConfirmDialog title="Delete employee" danger confirmLabel="Delete permanently" message="The account is anonymised permanently; audit history is kept. You will be asked to confirm your password." onClose={() => setDialog(null)} onConfirm={async () => { await stepUp((h) => api.del(`/users/${u.id}`, { headers: h })); toast.success('Employee deleted'); navigate('/employees'); }} />}
        </>
      );
    }}</Async>
  );
}

function UserSessions({ id, reloadKey }) {
  const q = useApi(`/users/${id}/sessions`, null, { reloadKey });
  return (
    <Card flush>
      <Async q={q}>{(list) => (list.length ? (
        <div className="table-wrap"><table className="table"><thead><tr><th>Started</th><th>Last used</th><th>IP</th><th>Device</th><th>Expires</th></tr></thead>
          <tbody>{list.map((s) => <tr key={s.id}><td>{fmtDateTime(s.createdAt)}</td><td>{timeAgo(s.lastUsedAt)}</td><td className="mono">{s.ip}</td><td className="subtle">{s.userAgent || '—'}</td><td>{fmtDateTime(s.expiresAt)}</td></tr>)}</tbody></table></div>
      ) : <p className="muted" style={{ padding: 16, margin: 0 }}>No active sessions.</p>)}</Async>
    </Card>
  );
}

function EditEmployee({ u, onClose, onDone }) {
  const toast = useToast();
  const f = useForm({ firstName: u.firstName, lastName: u.lastName, phone: u.phone || '', title: u.title || '' });
  const onSubmit = f.submit(async (v) => {
    const body = { firstName: v.firstName, lastName: v.lastName, title: v.title };
    if (v.phone) body.phone = v.phone;
    await api.patch(`/users/${u.id}`, body);
    toast.success('Employee updated');
    onDone();
    onClose();
  });
  return (
    <Modal title="Edit employee" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="edit-emp" loading={f.busy}>Save</Button></>}>
      <form id="edit-emp" className="form" onSubmit={onSubmit}>
        <div className="form-grid">
          <Field label="First name" error={f.errors.firstName}><input className="input" value={f.values.firstName} onChange={f.set('firstName')} required /></Field>
          <Field label="Last name" error={f.errors.lastName}><input className="input" value={f.values.lastName} onChange={f.set('lastName')} required /></Field>
          <Field label="Phone" error={f.errors.phone}><input className="input" value={f.values.phone} onChange={f.set('phone')} /></Field>
          <Field label="Title" error={f.errors.title}><input className="input" value={f.values.title} onChange={f.set('title')} /></Field>
        </div>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

function RoleDialog({ u, onClose, onDone }) {
  const toast = useToast();
  const stepUp = useStepUp();
  const branches = useApi('/branches', { status: 'active', pageSize: 50 });
  const f = useForm({ role: u.role === 'teller' ? 'manager' : 'teller', branchId: u.branchId ? String(u.branchId) : '', reason: '' });
  const onSubmit = f.submit(async (v) => {
    const body = { role: v.role, reason: v.reason };
    if (v.role !== 'super_admin' && v.branchId) body.branchId = Number(v.branchId);
    await stepUp((h) => api.put(`/users/${u.id}/role`, body, { headers: h }));
    toast.success('Role changed', 'The employee must sign in again.');
    onDone();
    onClose();
  });
  return (
    <Modal title="Change role" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="role" loading={f.busy}>Change role</Button></>}>
      <form id="role" className="form" onSubmit={onSubmit}>
        <Alert type="warning">Role changes are critical: they alter what this person can do and require password confirmation.</Alert>
        <Field label="New role"><select className="select" value={f.values.role} onChange={f.set('role')}>{['teller', 'manager', 'super_admin'].filter((r) => r !== u.role).map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></Field>
        {f.values.role !== 'super_admin' && <Field label="Branch"><select className="select" value={f.values.branchId} onChange={f.set('branchId')} required><option value="">Select…</option>{(branches.data || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
        <Field label="Reason" error={f.errors.reason}><textarea className="textarea" value={f.values.reason} onChange={f.set('reason')} required /></Field>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

function BranchTransferDialog({ u, onClose, onDone }) {
  const toast = useToast();
  const branches = useApi('/branches', { status: 'active', pageSize: 50 });
  const f = useForm({ branchId: '', reason: '' });
  const onSubmit = f.submit(async (v) => { await api.put(`/users/${u.id}/branch`, { branchId: Number(v.branchId), reason: v.reason }); toast.success('Employee transferred'); onDone(); onClose(); });
  return (
    <Modal title="Transfer to another branch" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="xfer" loading={f.busy}>Transfer</Button></>}>
      <form id="xfer" className="form" onSubmit={onSubmit}>
        <Field label="New branch"><select className="select" value={f.values.branchId} onChange={f.set('branchId')} required><option value="">Select…</option>{(branches.data || []).filter((b) => b.id !== u.branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Reason" error={f.errors.reason}><textarea className="textarea" value={f.values.reason} onChange={f.set('reason')} required /></Field>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------- branches ----
export function Branches() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <>
      <PageHeader title="Branches" subtitle="Branch network, managers and limits." actions={<Button onClick={() => setCreating(true)}><Plus size={16} />New branch</Button>} />
      <Card flush>
        <DataTable path="/branches" reloadKey={reloadKey} initialSort={{ key: 'code', order: 'asc' }} onRowClick={(b) => navigate(`/branches/${b.id}`)} columns={[
          { key: 'code', label: 'Code', sort: 'code', render: (b) => <span className="mono">{b.code}</span> },
          { key: 'name', label: 'Branch', sort: 'name', render: (b) => <div><b>{b.name}</b><div className="subtle">{b.address.city}, {b.address.state}</div></div> },
          { key: 'manager', label: 'Manager', render: (b) => (b.manager ? b.manager.name : <span className="subtle">Unassigned</span>) },
          { key: 'routingNumber', label: 'Routing', render: (b) => <span className="mono">{b.routingNumber}</span> },
          { key: 'onboard', label: 'Teller onboarding', render: (b) => (b.tellersCanOnboard ? 'Allowed' : 'Manager only') },
          { key: 'status', label: 'Status', render: (b) => <StatusBadge status={b.status} /> },
        ]} />
      </Card>
      {creating && <BranchModal onClose={() => setCreating(false)} onDone={() => setReloadKey((k) => k + 1)} />}
    </>
  );
}

function BranchModal({ branch, onClose, onDone }) {
  const toast = useToast();
  const f = useForm(branch
    ? { name: branch.name, phone: branch.phone, email: branch.email, tellersCanOnboard: branch.tellersCanOnboard, address: { ...branch.address } }
    : { code: '', name: '', phone: '', email: '', tellersCanOnboard: true, address: { line1: '', city: '', state: '', postalCode: '', country: 'US' } });
  const v = f.values;
  const setAddr = (k) => (e) => f.setValues((s) => ({ ...s, address: { ...s.address, [k]: e.target.value } }));
  const onSubmit = f.submit(async (x) => {
    if (branch) await api.patch(`/branches/${branch.id}`, x);
    else await api.post('/branches', x);
    toast.success(branch ? 'Branch updated' : 'Branch created');
    onDone();
    onClose();
  });
  return (
    <Modal title={branch ? 'Edit branch' : 'New branch'} onClose={onClose} wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="branch" loading={f.busy}>Save</Button></>}>
      <form id="branch" className="form" onSubmit={onSubmit}>
        <div className="form-grid">
          {!branch && <Field label="Branch code" error={f.errors.code} hint="e.g. KB005"><input className="input mono" value={v.code} onChange={f.set('code')} required /></Field>}
          <Field label="Name" error={f.errors.name}><input className="input" value={v.name} onChange={f.set('name')} required /></Field>
          <Field label="Phone" error={f.errors.phone}><input className="input" value={v.phone} onChange={f.set('phone')} required /></Field>
          <Field label="Email" error={f.errors.email}><input type="email" className="input" value={v.email} onChange={f.set('email')} required /></Field>
          <Field label="Street" className="full" error={f.errors['address.line1']}><input className="input" value={v.address.line1} onChange={setAddr('line1')} required /></Field>
          <Field label="City" error={f.errors['address.city']}><input className="input" value={v.address.city} onChange={setAddr('city')} required /></Field>
          <Field label="State" error={f.errors['address.state']}><input className="input" value={v.address.state} onChange={setAddr('state')} required /></Field>
          <Field label="Postal code" error={f.errors['address.postalCode']}><input className="input" value={v.address.postalCode} onChange={setAddr('postalCode')} required /></Field>
          <label className="checkbox full"><input type="checkbox" checked={v.tellersCanOnboard} onChange={f.set('tellersCanOnboard')} />Tellers may onboard new customers</label>
        </div>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

export function BranchDetail() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [dialog, setDialog] = useState(null);
  const q = useApi(`/branches/${id}`, null, { reloadKey });
  const ownOrGlobal = user.role === 'super_admin' || String(user.branchId) === id;
  const stats = useApi(ownOrGlobal && can('reports:branch', 'reports:system') ? `/branches/${id}/stats` : null, null, { reloadKey });
  const limits = useApi(`/branches/${id}/limits`, null, { reloadKey });
  const reload = () => setReloadKey((k) => k + 1);
  return (
    <Async q={q}>{(b) => (
      <>
        <PageHeader crumbs={can('branches:manage') ? [{ label: 'Branches', to: '/branches' }, { label: b.name }] : undefined}
          title={<span className="row">{b.name} <StatusBadge status={b.status} /></span>} subtitle={`${b.code} · ${b.address.line1}, ${b.address.city}, ${b.address.state} · Routing ${b.routingNumber}`}
          actions={(
            <>
              {can('branch_limits:manage') && ownOrGlobal && <Button variant="secondary" onClick={() => setDialog('limits')}>Edit limits</Button>}
              {can('branches:manage') && <Button variant="secondary" onClick={() => setDialog('edit')}><Pencil size={15} />Edit</Button>}
              {can('branches:manage') && <Button variant="secondary" onClick={() => setDialog('manager')}>Assign manager</Button>}
              {can('branches:manage') && (b.status === 'active' ? <Button variant="danger" onClick={() => setDialog('deactivate')}>Deactivate</Button> : <Button variant="success" onClick={async () => { try { await api.post(`/branches/${b.id}/activate`); toast.success('Branch activated'); reload(); } catch (e) { toast.error('Failed', e.message); } }}>Activate</Button>)}
            </>
          )} />
        {stats.data && (
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <Stat label="Customers" value={stats.data.customers} sub={`${stats.data.activeCustomers} active`} />
            <Stat label="Accounts" value={stats.data.accounts} sub={Object.entries(stats.data.accountsByStatus).map(([k, n]) => `${n} ${k}`).join(' · ')} />
            <Stat label="Total deposits" value={money(stats.data.totalDeposits)} tone="green" />
            <Stat label="Volume (30 days)" value={money(stats.data.volumeLast30Days)} sub={`${stats.data.transactionsLast30Days} transactions`} />
          </div>
        )}
        <div className="grid grid-2">
          <Card title="Branch details">
            <dl className="dl">
              <dt>Manager</dt><dd>{b.manager ? `${b.manager.name} (${b.manager.email})` : 'Unassigned'}</dd>
              <dt>Phone</dt><dd>{b.phone}</dd>
              <dt>Email</dt><dd>{b.email}</dd>
              <dt>Customer onboarding</dt><dd>{b.tellersCanOnboard ? 'Tellers and managers' : 'Managers only'}</dd>
              <dt>Opened</dt><dd>{fmtDate(b.openedAt)}</dd>
              {stats.data && <><dt>Pending approvals</dt><dd>{stats.data.pendingApprovals}</dd><dt>Open service requests</dt><dd>{stats.data.openServiceRequests}</dd></>}
            </dl>
          </Card>
          <Card title="Transaction limits" subtitle="Bounded by global caps set by a super admin">
            {limits.data && (
              <dl className="dl">
                <dt>Approval threshold</dt><dd>{money(limits.data.limits.approvalThreshold)} <span className="subtle">(cap {money(limits.data.caps.approvalThreshold)})</span></dd>
                <dt>Teller cash withdrawal</dt><dd>{money(limits.data.limits.tellerCashWithdrawalLimit)} <span className="subtle">(cap {money(limits.data.caps.tellerCashWithdrawalLimit)})</span></dd>
                <dt>Daily cash per account</dt><dd>{money(limits.data.limits.dailyCashWithdrawalLimit)} <span className="subtle">(cap {money(limits.data.caps.dailyCashWithdrawalLimit)})</span></dd>
                <dt>Large deposit review</dt><dd>{money(limits.data.limits.largeDepositThreshold)} <span className="subtle">(cap {money(limits.data.caps.largeDepositThreshold)})</span></dd>
              </dl>
            )}
          </Card>
        </div>
        {can('users:read') && ownOrGlobal && (
          <div style={{ marginTop: 16 }}><Card title="Staff" flush>
            <DataTable path={`/branches/${b.id}/employees`} reloadKey={reloadKey} onRowClick={(u) => navigate(`/employees/${u.id}`)} columns={[
              { key: 'name', label: 'Name', sort: 'name', render: (u) => `${u.firstName} ${u.lastName}` },
              { key: 'role', label: 'Role', sort: 'role', render: (u) => <StatusBadge status={u.role} tone={u.role === 'manager' ? 'blue' : 'gray'} /> },
              { key: 'title', label: 'Title' },
              { key: 'status', label: 'Status', render: (u) => <StatusBadge status={u.status} /> },
            ]} />
          </Card></div>
        )}
        {dialog === 'edit' && <BranchModal branch={b} onClose={() => setDialog(null)} onDone={reload} />}
        {dialog === 'limits' && limits.data && <LimitsDialog b={b} limits={limits.data} onClose={() => setDialog(null)} onDone={reload} />}
        {dialog === 'manager' && <AssignManager b={b} onClose={() => setDialog(null)} onDone={reload} />}
        {dialog === 'deactivate' && <ConfirmDialog title="Deactivate branch" danger reason confirmLabel="Deactivate" message="Only possible when the branch has no open accounts and no active staff." onClose={() => setDialog(null)} onConfirm={async (reason) => { await api.post(`/branches/${b.id}/deactivate`, { reason }); toast.success('Branch deactivated'); reload(); }} />}
      </>
    )}</Async>
  );
}

function LimitsDialog({ b, limits, onClose, onDone }) {
  const toast = useToast();
  const f = useForm({ ...Object.fromEntries(Object.entries(limits.limits).map(([k, v]) => [k, String(v)])), reason: '' });
  const fields = [['approvalThreshold', 'Approval threshold'], ['tellerCashWithdrawalLimit', 'Teller cash withdrawal'], ['dailyCashWithdrawalLimit', 'Daily cash per account'], ['largeDepositThreshold', 'Large deposit review']];
  const onSubmit = f.submit(async (v) => {
    await api.put(`/branches/${b.id}/limits`, { ...Object.fromEntries(fields.map(([k]) => [k, Number(v[k])])), reason: v.reason });
    toast.success('Branch limits updated');
    onDone();
    onClose();
  });
  return (
    <Modal title={`Limits — ${b.name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="limits" loading={f.busy}>Save limits</Button></>}>
      <form id="limits" className="form" onSubmit={onSubmit}>
        <div className="form-grid">
          {fields.map(([k, l]) => <Field key={k} label={l} error={f.errors[k]} hint={`Max ${money(limits.caps[k])}`}><div className="input-prefix"><span>$</span><input type="number" min="100" step="1" className="input" value={f.values[k]} onChange={f.set(k)} required /></div></Field>)}
          <Field label="Reason" className="full" error={f.errors.reason}><textarea className="textarea" value={f.values.reason} onChange={f.set('reason')} required /></Field>
        </div>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

function AssignManager({ b, onClose, onDone }) {
  const toast = useToast();
  const managers = useApi('/users', { role: 'manager', branchId: b.id, status: 'active', pageSize: 50 });
  const f = useForm({ userId: b.manager ? String(b.manager.id) : '' });
  const onSubmit = f.submit(async (v) => { await api.put(`/branches/${b.id}/manager`, { userId: Number(v.userId) }); toast.success('Branch manager assigned'); onDone(); onClose(); });
  return (
    <Modal title="Assign branch manager" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="mgr" loading={f.busy}>Assign</Button></>}>
      <form id="mgr" className="form" onSubmit={onSubmit}>
        <Field label="Manager" hint="Only active managers assigned to this branch are eligible">
          <select className="select" value={f.values.userId} onChange={f.set('userId')} required><option value="">Select…</option>{(managers.data || []).map((m) => <option key={m.id} value={m.id}>{m.firstName} {m.lastName} — {m.title}</option>)}</select>
        </Field>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}
