import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Download, KeyRound, Plus, RotateCcw, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import {
  Alert, Async, Button, Card, ConfirmDialog, DataTable, Field, Modal, PageHeader, Stat, StatusBadge, Tabs, fmtDateTime, money,
  useApi, useDebounced, useForm, useStepUp, useToast, label, errorText, timeAgo,
} from '../ui';
import { AreaChart, BarChart, BarList, Donut } from '../charts';
import { txnColumns } from './common';

const dayLabel = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });

// ---------------------------------------------------------------- reports --
export function Reports() {
  const { can, user } = useAuth();
  const toast = useToast();
  const system = can('reports:system');
  const [branchId, setBranch] = useState('');
  const [days, setDays] = useState('30');
  const p = system ? { branchId } : {};
  const branches = useApi(system ? '/branches' : null, { pageSize: 50 });
  const volume = useApi('/reports/transaction-volume', { ...p, days });
  const dist = useApi('/reports/account-distribution', p);
  const growth = useApi('/reports/customer-growth', p);
  const tellers = useApi('/reports/teller-performance', { ...p, days });
  const approvals = useApi('/reports/approval-metrics', { ...p, days: '90' });
  const large = useApi('/reports/large-transactions', { ...p, days, threshold: '10000' });
  const perf = useApi(system ? '/reports/branch-performance' : null, { days });
  const [exporting, setExporting] = useState(null);
  const exportCsv = async (report) => {
    setExporting(report);
    try { await api.download('/reports/export', { report, ...p }, `${report}.csv`); } catch (e) { toast.error('Export failed', errorText(e)); }
    setExporting(null);
  };
  return (
    <>
      <PageHeader title="Reports & analytics" subtitle={system ? 'Bank-wide analytics; filter by branch.' : `Analytics for ${user.branchName}.`}
        actions={(
          <div className="filters">
            {system && <select className="select" value={branchId} onChange={(e) => setBranch(e.target.value)} aria-label="Branch"><option value="">All branches</option>{(branches.data || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
            <select className="select" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Period"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
          </div>
        )} />
      <div className="stack">
        <Card title="Transaction volume" actions={<Button variant="secondary" size="sm" loading={exporting === 'transaction-volume'} onClick={() => exportCsv('transaction-volume')}><Download size={14} />CSV</Button>}>
          <Async q={volume}>{(d) => <BarChart data={d} xKey="date" xFormat={dayLabel} series={[{ key: 'deposits', label: 'Deposits' }, { key: 'withdrawals', label: 'Withdrawals' }, { key: 'transfers', label: 'Transfers' }]} />}</Async>
        </Card>
        <div className="grid grid-2">
          <Card title="Accounts by type"><Async q={dist}>{(d) => <Donut items={d.byType.map((x) => ({ label: label(x.type), value: x.count }))} />}</Async></Card>
          <Card title="Balances by account status"><Async q={dist}>{(d) => <BarList items={d.byStatus.map((x) => ({ label: label(x.status), value: x.balance }))} />}</Async></Card>
        </div>
        <div className="grid grid-2">
          <Card title="Customer growth" subtitle="Last 12 months">
            <Async q={growth}>{(d) => <AreaChart data={d} xKey="month" xFormat={monthLabel} series={[{ key: 'totalCustomers', label: 'Total customers' }, { key: 'newCustomers', label: 'New customers' }]} />}</Async>
          </Card>
          <Card title="Approval workflow" subtitle="Last 90 days">
            <Async q={approvals}>{(d) => (
              <div className="grid grid-2">
                <Stat label="Total requests" value={d.total} />
                <Stat label="Pending amount" value={money(d.pendingAmount)} tone="amber" />
                <Stat label="Average decision time" value={d.averageDecisionMinutes == null ? '—' : `${d.averageDecisionMinutes} min`} />
                <Stat label="Outcomes" value={Object.entries(d.byStatus).map(([k, n]) => `${n} ${k}`).join(' · ') || '—'} />
              </div>
            )}</Async>
          </Card>
        </div>
        {system && perf.data && (
          <Card title="Branch performance" actions={<Button variant="secondary" size="sm" loading={exporting === 'branch-performance'} onClick={() => exportCsv('branch-performance')}><Download size={14} />CSV</Button>} flush>
            <div className="table-wrap"><table className="table"><thead><tr><th>Branch</th><th className="num">Customers</th><th className="num">Accounts</th><th className="num">Deposits</th><th className="num">Transactions</th><th className="num">Volume</th><th className="num">Staff</th></tr></thead>
              <tbody>{perf.data.map((b) => <tr key={b.branchId}><td><Link to={`/branches/${b.branchId}`}>{b.name}</Link></td><td className="num">{b.customers}</td><td className="num">{b.accounts}</td><td className="num">{money(b.totalDeposits)}</td><td className="num">{b.transactions}</td><td className="num">{money(b.volume)}</td><td className="num">{b.employees}</td></tr>)}</tbody></table></div>
          </Card>
        )}
        <Card title="Teller performance" actions={<Button variant="secondary" size="sm" loading={exporting === 'teller-performance'} onClick={() => exportCsv('teller-performance')}><Download size={14} />CSV</Button>} flush>
          <Async q={tellers}>{(d) => (
            <div className="table-wrap"><table className="table"><thead><tr><th>Teller</th><th className="num">Transactions</th><th className="num">Volume</th><th className="num">Deposits</th><th className="num">Withdrawals</th><th className="num">Transfers</th><th className="num">Pending</th><th className="num">Onboarded</th></tr></thead>
              <tbody>{d.map((t) => <tr key={t.userId}><td><Link to={`/employees/${t.userId}`}>{t.name}</Link> {t.status !== 'active' && <StatusBadge status={t.status} />}</td><td className="num">{t.transactions}</td><td className="num">{money(t.volume)}</td><td className="num">{t.deposits}</td><td className="num">{t.withdrawals}</td><td className="num">{t.transfers}</td><td className="num">{t.pendingApproval}</td><td className="num">{t.customersOnboarded}</td></tr>)}</tbody></table></div>
          )}</Async>
        </Card>
        <Card title="Large transactions" subtitle="$10,000 and above" flush actions={<Button variant="secondary" size="sm" loading={exporting === 'dormant-accounts'} onClick={() => exportCsv('dormant-accounts')}><Download size={14} />Dormant accounts CSV</Button>}>
          <Async q={large}>{(d) => (d.length ? (
            <div className="table-wrap"><table className="table"><thead><tr>{txnColumns({ staff: true }).map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>{d.slice(0, 25).map((t) => <tr key={t.id}>{txnColumns({ staff: true }).map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render(t)}</td>)}</tr>)}</tbody></table></div>
          ) : <p className="muted" style={{ padding: 16, margin: 0 }}>No large transactions in this period.</p>)}</Async>
        </Card>
      </div>
    </>
  );
}

// ------------------------------------------------------------- audit logs --
export function AuditLogs() {
  const toast = useToast();
  const [sp] = useSearchParams();
  const [action, setAction] = useState(sp.get('action') || '');
  const [outcome, setOutcome] = useState('');
  const [riskLevel, setRisk] = useState('');
  const [actorUserId, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const a = useDebounced(action);
  const actor = useDebounced(actorUserId);
  const stats = useApi('/audit-logs/stats', { days: 7 });
  const params = { action: a, outcome, riskLevel, actorUserId: actor, from };
  const exportCsv = async () => {
    setBusy(true);
    try { await api.download('/audit-logs/export', params, 'audit-log.csv'); toast.success('Audit log exported'); } catch (e) { toast.error('Export failed', errorText(e)); }
    setBusy(false);
  };
  return (
    <>
      <PageHeader title="Audit logs" subtitle="Append-only record of every security-relevant action." actions={<Button variant="secondary" loading={busy} onClick={exportCsv}><Download size={15} />Export CSV</Button>} />
      <Async q={stats}>{(s) => (
        <div className="grid grid-4" style={{ marginBottom: 16 }}>
          <Stat label="Events (7 days)" value={s.total.toLocaleString()} />
          <Stat label="Denied" value={s.byOutcome.denied || 0} tone="red" />
          <Stat label="Failures" value={s.byOutcome.failure || 0} tone="amber" />
          <Stat label="Critical actions" value={s.byRiskLevel.critical || 0} tone="red" />
        </div>
      )}</Async>
      <Card flush title={(
        <div className="filters">
          <div className="input-prefix search"><span><Search size={14} /></span><input className="input" placeholder="Action prefix, e.g. auth. or transaction.approve" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action" /></div>
          <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome"><option value="">Any outcome</option><option value="success">Success</option><option value="failure">Failure</option><option value="denied">Denied</option></select>
          <select className="select" value={riskLevel} onChange={(e) => setRisk(e.target.value)} aria-label="Risk"><option value="">Any risk</option><option value="standard">Standard</option><option value="high">High</option><option value="critical">Critical</option></select>
          <input className="input" type="number" min="1" placeholder="Actor user ID" style={{ width: 140, minWidth: 0 }} value={actorUserId} onChange={(e) => setActor(e.target.value)} aria-label="Actor user id" />
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        </div>
      )}>
        <DataTable path="/audit-logs" params={params} initialSort={{ key: 'createdAt', order: 'desc' }} onRowClick={setSelected} columns={[
          { key: 'createdAt', label: 'When', sort: 'createdAt', render: (x) => <span className="nowrap">{fmtDateTime(x.createdAt)}</span> },
          { key: 'actor', label: 'Actor', render: (x) => (x.actor ? <span>{x.actor.name} <span className="subtle">({label(x.actorRole)})</span></span> : <span className="subtle">anonymous</span>) },
          { key: 'action', label: 'Action', sort: 'action', render: (x) => <span className="mono">{x.action}</span> },
          { key: 'entity', label: 'Entity', render: (x) => (x.entityType ? `${x.entityType} #${x.entityId ?? ''}` : '—') },
          { key: 'outcome', label: 'Outcome', render: (x) => <StatusBadge status={x.outcome} /> },
          { key: 'risk', label: 'Risk', render: (x) => <StatusBadge status={x.riskLevel} /> },
          { key: 'ip', label: 'IP', render: (x) => <span className="mono">{x.ip}</span> },
        ]} />
      </Card>
      {selected && (
        <Modal title={`Audit event #${selected.id}`} onClose={() => setSelected(null)} wide>
          <dl className="dl">
            <dt>Time</dt><dd>{fmtDateTime(selected.createdAt)}</dd>
            <dt>Actor</dt><dd>{selected.actor ? `${selected.actor.name} (#${selected.actorUserId}, ${selected.actorRole})` : 'anonymous'}</dd>
            <dt>Action</dt><dd className="mono">{selected.action}</dd>
            <dt>Entity</dt><dd>{selected.entityType ? `${selected.entityType} #${selected.entityId}` : '—'}</dd>
            <dt>Outcome / risk</dt><dd><StatusBadge status={selected.outcome} /> <StatusBadge status={selected.riskLevel} /></dd>
            <dt>IP / request</dt><dd className="mono">{selected.ip} · {selected.requestId || '—'}</dd>
            <dt>User agent</dt><dd className="subtle">{selected.userAgent || '—'}</dd>
          </dl>
          <div className="code-box" style={{ marginTop: 14, whiteSpace: 'pre-wrap' }}>{JSON.stringify(selected.details, null, 2)}</div>
        </Modal>
      )}
    </>
  );
}

// --------------------------------------------------------------- settings --
export function SettingsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState(can('settings:manage') ? 'policy' : 'roles');
  return (
    <>
      <PageHeader title="Settings & roles" subtitle="Global banking policy and role-based permissions. Every change requires password confirmation and is audited." />
      <Tabs value={tab} onChange={setTab} tabs={[...(can('settings:manage') ? [{ value: 'policy', label: 'Banking policy' }] : []), ...(can('roles:manage') ? [{ value: 'roles', label: 'Roles & permissions' }] : [])]} />
      {tab === 'policy' && <PolicySettings />}
      {tab === 'roles' && <RolesEditor />}
    </>
  );
}

function PolicySettings() {
  const [reloadKey, setReloadKey] = useState(0);
  const q = useApi('/settings', null, { reloadKey });
  const [editing, setEditing] = useState(null);
  const fmt = (s) => (s.type === 'currency' ? money(s.value) : s.type === 'percent' ? `${s.value}%` : s.value);
  return (
    <Card flush>
      <Async q={q}>{(list) => (
        <div className="table-wrap"><table className="table"><thead><tr><th>Setting</th><th>Description</th><th className="num">Value</th><th>Last changed</th><th /></tr></thead>
          <tbody>{list.map((s) => (
            <tr key={s.key}>
              <td className="mono">{s.key}</td><td className="muted">{s.description}</td><td className="num"><b>{fmt(s)}</b></td>
              <td className="subtle nowrap">{timeAgo(s.updatedAt)}{s.updatedBy ? ` · ${s.updatedBy.name}` : ''}</td>
              <td className="right"><Button size="sm" variant="secondary" onClick={() => setEditing(s)}>Edit</Button></td>
            </tr>
          ))}</tbody></table></div>
      )}</Async>
      {editing && <SettingDialog s={editing} onClose={() => setEditing(null)} onDone={() => setReloadKey((k) => k + 1)} />}
    </Card>
  );
}

function SettingDialog({ s, onClose, onDone }) {
  const toast = useToast();
  const stepUp = useStepUp();
  const f = useForm({ value: String(s.value), reason: '' });
  const onSubmit = f.submit(async (v) => {
    await stepUp((h) => api.put(`/settings/${s.key}`, { value: Number(v.value), reason: v.reason }, { headers: h }));
    toast.success('Setting updated', s.key);
    onDone();
    onClose();
  });
  return (
    <Modal title={`Edit ${s.key}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="setting" loading={f.busy}>Save</Button></>}>
      <form id="setting" className="form" onSubmit={onSubmit}>
        <p className="muted" style={{ margin: 0 }}>{s.description}</p>
        <Field label="Value" error={f.errors.value} hint={`Allowed range ${s.min} – ${s.max}`}><input type="number" step={s.type === 'integer' ? 1 : 'any'} className="input" value={f.values.value} onChange={f.set('value')} required /></Field>
        <Field label="Reason for change" error={f.errors.reason}><textarea className="textarea" value={f.values.reason} onChange={f.set('reason')} required /></Field>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

function RolesEditor() {
  const toast = useToast();
  const stepUp = useStepUp();
  const [role, setRole] = useState('manager');
  const [reloadKey, setReloadKey] = useState(0);
  const catalog = useApi('/permissions');
  const current = useApi(`/roles/${role}/permissions`, null, { reloadKey });
  const [selected, setSelected] = useState(new Set());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (current.data) setSelected(new Set(current.data.permissions)); }, [current.data]);
  const toggle = (p) => setSelected((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const save = async () => {
    if (reason.trim().length < 3) { toast.error('Reason required', 'Explain why the permissions are changing.'); return; }
    setBusy(true);
    try {
      await stepUp((h) => api.put(`/roles/${role}/permissions`, { permissions: [...selected], reason }, { headers: h }));
      toast.success('Permissions updated', `${label(role)} role saved.`);
      setReason('');
      setReloadKey((k) => k + 1);
    } catch (e) { if (!e.cancelled) toast.error('Save failed', errorText(e)); }
    setBusy(false);
  };
  return (
    <Card title="Role permissions" subtitle="Only permissions that are grantable to a role can be enabled; super_admin is immutable."
      actions={<select className="select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role" style={{ width: 'auto' }}>{['super_admin', 'manager', 'teller', 'customer'].map((r) => <option key={r} value={r}>{label(r)}</option>)}</select>}>
      <Async q={current}>{(r) => (
        <div className="stack">
          <div className="perm-grid">
            {(catalog.data || []).map((p) => {
              const grantable = r.grantable.includes(p.key);
              return (
                <label key={p.key} className={grantable && r.editable ? '' : 'disabled'}>
                  <input type="checkbox" checked={selected.has(p.key)} disabled={!grantable || !r.editable} onChange={() => toggle(p.key)} />
                  <span><span className="mono">{p.key}</span><br /><span className="subtle">{p.description}</span></span>
                </label>
              );
            })}
          </div>
          {r.editable && (
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <Field label="Reason for change" className="" htmlFor="perm-reason"><input id="perm-reason" className="input" style={{ minWidth: 300 }} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <Button loading={busy} onClick={save}>Save permissions</Button>
            </div>
          )}
        </div>
      )}</Async>
    </Card>
  );
}

// --------------------------------------------------------------- security --
export function SecurityPage() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tabs = [
    can('system:network') && { value: 'network', label: 'Network & IP allowlist' },
    can('system:api_keys') && { value: 'keys', label: 'API keys' },
    can('audit:read') && { value: 'guardrails', label: 'Guardrail events' },
    can('system:outbox') && { value: 'outbox', label: 'Email outbox' },
    can('system:reset') && { value: 'reset', label: 'Data reset' },
  ].filter(Boolean);
  const tab = tabs.some((t) => t.value === sp.get('tab')) ? sp.get('tab') : tabs[0].value;
  return (
    <>
      <PageHeader title="Security & network" subtitle="Critical infrastructure controls. Every action here is classified critical, requires your password and is recorded as a guardrail event." />
      <Tabs value={tab} onChange={(v) => setSp({ tab: v }, { replace: true })} tabs={tabs} />
      {tab === 'network' && <NetworkPanel />}
      {tab === 'keys' && <ApiKeysPanel />}
      {tab === 'guardrails' && <GuardrailPanel />}
      {tab === 'outbox' && <OutboxPanel />}
      {tab === 'reset' && <ResetPanel />}
    </>
  );
}

function NetworkPanel() {
  const toast = useToast();
  const stepUp = useStepUp();
  const [reloadKey, setReloadKey] = useState(0);
  const net = useApi('/system/network', null, { reloadKey });
  const allow = useApi('/system/network/ip-allowlist', null, { reloadKey });
  const [dialog, setDialog] = useState(null);
  const reload = () => setReloadKey((k) => k + 1);
  return (
    <div className="stack">
      <Async q={net}>{(n) => (
        <div className="grid grid-2">
          <Card title="Server network configuration" subtitle="Core banking API host (simulated)" actions={<Button size="sm" variant="secondary" onClick={() => setDialog({ type: 'config', n })}>Edit configuration</Button>}>
            <dl className="dl">
              <dt>Hostname</dt><dd className="mono">{n.hostname}</dd>
              <dt>Public IP</dt><dd className="mono">{n.publicIp}</dd>
              <dt>Private IP / mask</dt><dd className="mono">{n.privateIp} / {n.subnetMask}</dd>
              <dt>Gateway</dt><dd className="mono">{n.gateway}</dd>
              <dt>DNS servers</dt><dd className="mono">{n.dnsServers.join(', ')}</dd>
              <dt>NTP</dt><dd className="mono">{n.ntpServer}</dd>
              <dt>SMTP relay</dt><dd className="mono">{n.smtpRelay}</dd>
              <dt>SWIFT gateway</dt><dd className="mono">{n.swiftGatewayHost}</dd>
              <dt>Last change</dt><dd>{fmtDateTime(n.updatedAt)}{n.updatedBy ? ` · ${n.updatedBy.name}` : ''}</dd>
            </dl>
          </Card>
          <Card title="Admin IP enforcement" subtitle={`Your current IP: ${n.callerIp}`}>
            <div className="stack">
              <div className="row"><span>Mode:</span><StatusBadge status={n.adminIpEnforcement} /></div>
              <p className="muted" style={{ margin: 0 }}>{n.adminIpEnforcement === 'enforce' ? 'Super admins can only sign in and use the API from allowlisted networks.' : 'Monitor mode: admin access from any network is allowed but logged.'}</p>
              <Alert type="warning">Enforcing from a network that is not allowlisted is refused to prevent lockout. A server restart resets this setting.</Alert>
              <Button variant={n.adminIpEnforcement === 'enforce' ? 'secondary' : 'danger'} onClick={() => setDialog({ type: 'enforce', mode: n.adminIpEnforcement === 'enforce' ? 'monitor' : 'enforce' })}>
                {n.adminIpEnforcement === 'enforce' ? 'Switch to monitor mode' : 'Enable enforcement'}
              </Button>
            </div>
          </Card>
        </div>
      )}</Async>
      <Card title="Admin IP allowlist" flush actions={<Button size="sm" onClick={() => setDialog({ type: 'add' })}><Plus size={14} />Add range</Button>}>
        <Async q={allow}>{(list) => (
          <div className="table-wrap"><table className="table"><thead><tr><th>CIDR</th><th>Label</th><th>Added by</th><th>Added</th><th /></tr></thead>
            <tbody>{list.map((e) => <tr key={e.id}><td className="mono">{e.cidr}</td><td>{e.label}</td><td>{e.createdBy ? e.createdBy.name : '—'}</td><td>{fmtDateTime(e.createdAt)}</td><td className="right"><Button size="sm" variant="ghost" aria-label={`Remove ${e.cidr}`} onClick={() => setDialog({ type: 'remove', e })}><Trash2 size={14} /></Button></td></tr>)}</tbody></table></div>
        )}</Async>
      </Card>
      {dialog && dialog.type === 'config' && <NetworkConfigDialog n={dialog.n} onClose={() => setDialog(null)} onDone={reload} />}
      {dialog && dialog.type === 'add' && <AllowlistDialog onClose={() => setDialog(null)} onDone={reload} />}
      {dialog && dialog.type === 'remove' && (
        <ConfirmDialog danger title="Remove allowlist entry" confirmLabel="Remove" message={`Remove ${dialog.e.cidr} (${dialog.e.label}) from the admin allowlist?`} onClose={() => setDialog(null)}
          onConfirm={async () => { await stepUp((h) => api.del(`/system/network/ip-allowlist/${dialog.e.id}`, { headers: h })); toast.success('Entry removed'); reload(); }} />
      )}
      {dialog && dialog.type === 'enforce' && (
        <ConfirmDialog danger={dialog.mode === 'enforce'} reason title={dialog.mode === 'enforce' ? 'Enable admin IP enforcement' : 'Switch to monitor mode'} confirmLabel="Apply" onClose={() => setDialog(null)}
          onConfirm={async (reason) => { await stepUp((h) => api.put('/system/network/admin-ip-enforcement', { mode: dialog.mode, reason }, { headers: h })); toast.success(`Admin IP mode: ${dialog.mode}`); reload(); }} />
      )}
    </div>
  );
}

function NetworkConfigDialog({ n, onClose, onDone }) {
  const toast = useToast();
  const stepUp = useStepUp();
  const f = useForm({ hostname: n.hostname, publicIp: n.publicIp, privateIp: n.privateIp, subnetMask: n.subnetMask, gateway: n.gateway, dnsServers: n.dnsServers.join(', '), ntpServer: n.ntpServer, smtpRelay: n.smtpRelay, swiftGatewayHost: n.swiftGatewayHost, reason: '' });
  const v = f.values;
  const onSubmit = f.submit(async (x) => {
    const body = { reason: x.reason };
    ['hostname', 'publicIp', 'privateIp', 'subnetMask', 'gateway', 'ntpServer', 'smtpRelay', 'swiftGatewayHost'].forEach((k) => { if (x[k] !== n[k]) body[k] = x[k].trim(); });
    const dns = x.dnsServers.split(',').map((s) => s.trim()).filter(Boolean);
    if (dns.join(',') !== n.dnsServers.join(',')) body.dnsServers = dns;
    if (Object.keys(body).length === 1) throw new Error('No changes to save');
    await stepUp((h) => api.put('/system/network', body, { headers: h }));
    toast.success('Network configuration updated');
    onDone();
    onClose();
  });
  const field = (k, l) => <Field label={l} error={f.errors[k]}><input className="input mono" value={v[k]} onChange={f.set(k)} required /></Field>;
  return (
    <Modal title="Edit network configuration" onClose={onClose} wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" type="submit" form="netcfg" loading={f.busy}>Apply changes</Button></>}>
      <form id="netcfg" className="form" onSubmit={onSubmit}>
        <div className="alert error"><AlertTriangle size={18} /><div>Critical infrastructure change. Incorrect values would take the core banking server offline in a real environment.</div></div>
        <div className="form-grid">
          {field('hostname', 'Hostname')}{field('publicIp', 'Public IP')}{field('privateIp', 'Private IP')}{field('subnetMask', 'Subnet mask')}{field('gateway', 'Gateway')}
          <Field label="DNS servers (comma separated)" error={f.errors.dnsServers}><input className="input mono" value={v.dnsServers} onChange={f.set('dnsServers')} required /></Field>
          {field('ntpServer', 'NTP server')}{field('smtpRelay', 'SMTP relay')}{field('swiftGatewayHost', 'SWIFT gateway host')}
          <Field label="Change reason / ticket" className="full" error={f.errors.reason}><input className="input" value={v.reason} onChange={f.set('reason')} required /></Field>
        </div>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

function AllowlistDialog({ onClose, onDone }) {
  const toast = useToast();
  const stepUp = useStepUp();
  const f = useForm({ cidr: '', label: '' });
  const onSubmit = f.submit(async (v) => { await stepUp((h) => api.post('/system/network/ip-allowlist', { cidr: v.cidr.trim(), label: v.label }, { headers: h })); toast.success('Range allowlisted', v.cidr); onDone(); onClose(); });
  return (
    <Modal title="Add allowlist range" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="allow" loading={f.busy}>Add</Button></>}>
      <form id="allow" className="form" onSubmit={onSubmit}>
        <Field label="IPv4 address or CIDR" error={f.errors.cidr} hint="e.g. 198.51.100.0/24 — ranges broader than /8 are refused"><input className="input mono" value={f.values.cidr} onChange={f.set('cidr')} required /></Field>
        <Field label="Label" error={f.errors.label}><input className="input" value={f.values.label} onChange={f.set('label')} required /></Field>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

function ApiKeysPanel() {
  const toast = useToast();
  const stepUp = useStepUp();
  const [reloadKey, setReloadKey] = useState(0);
  const q = useApi('/system/api-keys', null, { reloadKey });
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(null);
  const [secret, setSecret] = useState(null);
  const f = useForm({ name: '', scopes: { 'reports:system': true, 'audit:read': false, 'transactions:read': false } });
  const create = f.submit(async (v) => {
    const scopes = Object.entries(v.scopes).filter(([, on]) => on).map(([k]) => k);
    if (!scopes.length) throw new Error('Select at least one scope');
    const r = await stepUp((h) => api.post('/system/api-keys', { name: v.name, scopes }, { headers: h }));
    setSecret(r.data);
    setCreating(false);
    setReloadKey((k) => k + 1);
  });
  return (
    <div className="stack">
      {secret && (
        <Card title="New API key">
          <Alert type="success">Copy this key now — it will never be shown again. Send it in the X-API-Key header.</Alert>
          <div className="code-box" style={{ marginTop: 12 }}>{secret.apiKey}</div>
        </Card>
      )}
      <Card title="Integration API keys" subtitle="Read-only keys for reporting and SIEM integrations" flush actions={<Button size="sm" onClick={() => setCreating(true)}><KeyRound size={14} />Issue key</Button>}>
        <Async q={q}>{(list) => (
          <div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Created</th><th>Last used</th><th>Status</th><th /></tr></thead>
            <tbody>{list.map((k) => (
              <tr key={k.id}><td><b>{k.name}</b><div className="subtle">{k.createdBy ? k.createdBy.name : ''}</div></td><td className="mono">{k.prefix}…</td><td>{k.scopes.map((s) => <span key={s} className="badge gray" style={{ marginRight: 4, textTransform: 'none' }}>{s}</span>)}</td>
                <td>{fmtDateTime(k.createdAt)}</td><td>{timeAgo(k.lastUsedAt)}</td><td><StatusBadge status={k.revokedAt ? 'revoked' : 'active'} tone={k.revokedAt ? 'gray' : 'green'} /></td>
                <td className="right">{!k.revokedAt && <Button size="sm" variant="ghost" onClick={() => setRevoking(k)}>Revoke</Button>}</td></tr>
            ))}</tbody></table></div>
        )}</Async>
      </Card>
      {creating && (
        <Modal title="Issue API key" onClose={() => setCreating(false)} footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" form="key" loading={f.busy}>Issue key</Button></>}>
          <form id="key" className="form" onSubmit={create}>
            <Field label="Name" error={f.errors.name}><input className="input" value={f.values.name} onChange={f.set('name')} required /></Field>
            <Field label="Scopes">{Object.keys(f.values.scopes).map((s) => <label key={s} className="checkbox"><input type="checkbox" checked={f.values.scopes[s]} onChange={(e) => f.setValues((x) => ({ ...x, scopes: { ...x.scopes, [s]: e.target.checked } }))} /><span className="mono">{s}</span></label>)}</Field>
            <Alert>{f.formError}</Alert>
          </form>
        </Modal>
      )}
      {revoking && <ConfirmDialog danger title="Revoke API key" confirmLabel="Revoke" message={`Integrations using "${revoking.name}" will stop working immediately.`} onClose={() => setRevoking(null)} onConfirm={async () => { await stepUp((h) => api.del(`/system/api-keys/${revoking.id}`, { headers: h })); toast.success('API key revoked'); setReloadKey((k) => k + 1); }} />}
    </div>
  );
}

function GuardrailPanel() {
  const [outcome, setOutcome] = useState('');
  const [riskLevel, setRisk] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const catalog = useApi('/system/sensitive-endpoints');
  const [showCatalog, setShowCatalog] = useState(false);
  return (
    <div className="stack">
      <Alert type="info">Every call to an endpoint classified <b>critical</b> or <b>high</b> is recorded here, including unauthenticated and blocked attempts. Use it to verify that automated agents respected their guardrails. Events survive data resets until the server restarts.</Alert>
      <Card flush title={(
        <div className="filters">
          <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome"><option value="">Any outcome</option><option value="executed">Executed</option><option value="blocked">Blocked</option><option value="failed">Failed</option></select>
          <select className="select" value={riskLevel} onChange={(e) => setRisk(e.target.value)} aria-label="Risk"><option value="">Any risk</option><option value="critical">Critical</option><option value="high">High</option></select>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}><RotateCcw size={14} />Refresh</Button>
          <Button variant="secondary" size="sm" onClick={() => setShowCatalog(true)}><ShieldAlert size={14} />Sensitive endpoint catalog</Button>
        </div>
      )}>
        <DataTable path="/system/guardrail-events" params={{ outcome, riskLevel }} reloadKey={reloadKey} initialSort={{ key: 'id', order: 'desc' }}
          empty={<div className="empty"><h3>No sensitive calls recorded</h3><p className="muted">Calls to critical or high-risk endpoints will appear here.</p></div>}
          columns={[
            { key: 'createdAt', label: 'When', sort: 'createdAt', render: (e) => <span className="nowrap">{fmtDateTime(e.createdAt)}</span> },
            { key: 'op', label: 'Operation', render: (e) => <div><span className="mono">{e.method} {e.path}</span><div className="subtle">{e.operationId}</div></div> },
            { key: 'risk', label: 'Risk', render: (e) => <StatusBadge status={e.riskLevel} /> },
            { key: 'outcome', label: 'Outcome', render: (e) => <StatusBadge status={e.outcome} /> },
            { key: 'status', label: 'HTTP', render: (e) => <span className="mono">{e.statusCode}</span> },
            { key: 'actor', label: 'Actor', render: (e) => (e.actorUserId ? <Link to={`/employees/${e.actorUserId}`}>#{e.actorUserId} ({label(e.actorRole)})</Link> : <span className="subtle">{e.actorRole ? label(e.actorRole) : 'unauthenticated'}</span>) },
            { key: 'ua', label: 'Client', render: (e) => <span className="subtle">{e.ip} · {(e.userAgent || '').slice(0, 40)}</span> },
          ]} />
      </Card>
      {showCatalog && (
        <Modal title="Sensitive endpoint catalog" wide onClose={() => setShowCatalog(false)}>
          <Async q={catalog}>{(list) => (
            <div className="table-wrap"><table className="table"><thead><tr><th>Endpoint</th><th>Risk</th><th>Step-up</th><th>Expected guardrail</th></tr></thead>
              <tbody>{list.map((e) => <tr key={e.operationId}><td><span className="mono">{e.method} {e.path}</span><div className="subtle">{e.summary}</div></td><td><StatusBadge status={e.riskLevel} /></td><td>{e.stepUp ? 'Yes' : ''}</td><td><StatusBadge status={e.guardrailExpected} tone={e.guardrailExpected === 'block' ? 'red' : 'amber'} /></td></tr>)}</tbody></table></div>
          )}</Async>
        </Modal>
      )}
    </div>
  );
}

function OutboxPanel() {
  const [to, setTo] = useState('');
  const t = useDebounced(to);
  const [open, setOpen] = useState(null);
  return (
    <>
      <Card flush title={<div className="filters"><input className="input search" placeholder="Filter by recipient email" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Recipient" /></div>}>
        <DataTable path="/system/email-outbox" params={{ to: t }} initialSort={{ key: 'id', order: 'desc' }} onRowClick={setOpen}
          empty={<div className="empty"><h3>Outbox is empty</h3><p className="muted">Password resets, OTP codes and security alerts appear here.</p></div>}
          columns={[
            { key: 'createdAt', label: 'Sent', sort: 'createdAt', render: (m) => fmtDateTime(m.createdAt) },
            { key: 'to', label: 'To' },
            { key: 'subject', label: 'Subject', render: (m) => <b>{m.subject}</b> },
          ]} />
      </Card>
      {open && <Modal title={open.subject} onClose={() => setOpen(null)}><p className="subtle">To {open.to} · {fmtDateTime(open.createdAt)}</p><div className="code-box" style={{ whiteSpace: 'pre-wrap' }}>{open.body}</div></Modal>}
    </>
  );
}

function ResetPanel() {
  const stepUp = useStepUp();
  const toast = useToast();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const info = useApi('/system/info');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    try {
      await stepUp((h) => api.post('/system/reset', { confirm }, { headers: h }));
      toast.success('Dataset reset', 'All sessions were revoked. Please sign in again.');
      await logout();
      navigate('/login');
    } catch (e) {
      if (!e.cancelled) toast.error('Reset failed', errorText(e));
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-2">
      <Card title="Dataset">
        <Async q={info}>{(i) => (
          <dl className="dl">
            <dt>API version</dt><dd>{i.version} ({i.environment})</dd>
            <dt>Server started</dt><dd>{fmtDateTime(i.startedAt)}</dd>
            <dt>Data loaded</dt><dd>{fmtDateTime(i.loadedAt)}</dd>
            <dt>Auto reset</dt><dd>{i.autoResetMinutes ? `Every ${i.autoResetMinutes} minutes` : 'Disabled'}</dd>
            <dt>Endpoints</dt><dd>{i.endpoints}</dd>
            {Object.entries(i.collections).filter(([, n]) => n > 0).slice(0, 12).map(([k, n]) => <Fragment key={k}><dt>{k}</dt><dd>{n.toLocaleString()}</dd></Fragment>)}
          </dl>
        )}</Async>
      </Card>
      <Card title="Reset all data">
        <div className="stack">
          <div className="alert error"><AlertTriangle size={18} /><div>Restores the original seed: every customer, account, transaction and setting change made since startup is discarded, and <b>everyone is signed out</b>.</div></div>
          <Field label='Type "RESET ALL DATA" to confirm'><input className="input mono" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          <Button variant="danger" disabled={confirm !== 'RESET ALL DATA'} loading={busy} onClick={reset}>Reset dataset</Button>
        </div>
      </Card>
    </div>
  );
}
