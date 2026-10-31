import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftRight, CheckCircle2, Clock, Plus, ShieldCheck, Trash2, UserRoundPlus } from 'lucide-react';
import { api } from '../api';
import {
  Alert, Async, Button, Card, ConfirmDialog, EmptyState, Field, Modal, PageHeader, StatusBadge, Tabs, fmtDate, money, useApi,
  useForm, useToast, errorText,
} from '../ui';
import { acctName } from './common';

const newKey = () => `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;

export function Transfer() {
  const toast = useToast();
  const accounts = useApi('/accounts', { pageSize: 100 });
  const bens = useApi('/beneficiaries', { status: 'active', pageSize: 100 });
  const [mode, setMode] = useState('own');
  const [check, setCheck] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);
  const idemKey = useRef(newKey());
  const f = useForm({ sourceAccountId: '', destinationAccountId: '', beneficiaryId: '', amount: '', description: '' });
  const v = f.values;
  useEffect(() => { setCheck(null); }, [v.sourceAccountId, v.destinationAccountId, v.beneficiaryId, v.amount, mode]);

  const usable = (accounts.data || []).filter((a) => a.status === 'active' && a.type !== 'fixed_deposit');
  const source = usable.find((a) => String(a.id) === v.sourceAccountId);
  const destOptions = (accounts.data || []).filter((a) => String(a.id) !== v.sourceAccountId && a.type !== 'fixed_deposit' && a.status !== 'closed');
  const ben = (bens.data || []).find((b) => String(b.id) === v.beneficiaryId);
  const payload = () => {
    const b = { sourceAccountId: Number(v.sourceAccountId), amount: Number(v.amount) };
    if (mode === 'own') b.destinationAccountId = Number(v.destinationAccountId); else b.beneficiaryId = Number(v.beneficiaryId);
    return b;
  };

  const review = f.submit(async () => {
    const r = await api.post('/transfers/validate', payload());
    setCheck(r.data);
    if (r.data.allowed) setConfirming(true);
  });

  const send = async () => {
    const body = payload();
    if (v.description) body.description = v.description;
    const r = await api.post(mode === 'own' ? '/transfers/own' : '/transfers/beneficiary', body, { headers: { 'Idempotency-Key': idemKey.current } });
    idemKey.current = newKey();
    setResult(r.data);
    toast.success(r.data.status === 'completed' ? 'Transfer sent' : 'Transfer submitted for review', r.data.reference);
    accounts.reload();
  };

  if (result) {
    const pending = result.status === 'pending_approval';
    return (
      <>
        <PageHeader title="Transfer money" />
        <Card>
          <div className="stack" style={{ alignItems: 'center', textAlign: 'center', padding: 24 }}>
            {pending ? <Clock size={44} color="var(--warning)" /> : <CheckCircle2 size={44} color="var(--accent)" />}
            <h2>{pending ? 'Transfer is being reviewed' : 'Transfer complete'}</h2>
            <p className="muted" style={{ margin: 0 }}>{money(result.amount)} · <span className="mono">{result.reference}</span></p>
            {pending && <Alert type="warning">Large transfers are reviewed by your branch. The funds are on hold until a decision is made; you can cancel from the transaction page.</Alert>}
            <div className="row"><Link className="btn btn-secondary" to={`/transactions/${result.id}`}>View details</Link><Button onClick={() => { setResult(null); f.setValues({ ...v, amount: '', description: '' }); }}>Make another transfer</Button></div>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Transfer money" subtitle="Move money between your accounts or pay a registered beneficiary." />
      <div className="grid grid-main">
        <Card>
          <Tabs value={mode} onChange={setMode} tabs={[{ value: 'own', label: 'Between my accounts' }, { value: 'beneficiary', label: 'Pay a beneficiary' }]} />
          <Async q={accounts}>{() => (usable.length === 0 ? <EmptyState title="No eligible accounts" message="You need an active checking or savings account to transfer money." /> : (
            <form className="form" onSubmit={review}>
              <Field label="From" error={f.errors.sourceAccountId}>
                <select className="select" value={v.sourceAccountId} onChange={f.set('sourceAccountId')} required>
                  <option value="">Choose an account…</option>
                  {usable.map((a) => <option key={a.id} value={a.id}>{acctName(a)} — available {money(a.availableBalance)}</option>)}
                </select>
              </Field>
              {mode === 'own' ? (
                <Field label="To" error={f.errors.destinationAccountId}>
                  <select className="select" value={v.destinationAccountId} onChange={f.set('destinationAccountId')} required>
                    <option value="">Choose an account…</option>
                    {destOptions.map((a) => <option key={a.id} value={a.id} disabled={a.status === 'frozen'}>{acctName(a)}{a.status !== 'active' ? ` (${a.status})` : ''}</option>)}
                  </select>
                </Field>
              ) : (
                <Field label="Pay to" error={f.errors.beneficiaryId} hint={<span>Only active beneficiaries are listed. <Link to="/beneficiaries">Manage beneficiaries</Link></span>}>
                  <select className="select" value={v.beneficiaryId} onChange={f.set('beneficiaryId')} required>
                    <option value="">Choose a beneficiary…</option>
                    {(bens.data || []).map((b) => <option key={b.id} value={b.id}>{b.nickname ? `${b.nickname} (${b.name})` : b.name} · {b.bankName} ••{b.accountNumber.slice(-4)}</option>)}
                  </select>
                </Field>
              )}
              <div className="form-grid">
                <Field label="Amount" error={f.errors.amount}><div className="input-prefix"><span>$</span><input type="number" step="0.01" min="0.01" className="input" value={v.amount} onChange={f.set('amount')} required /></div></Field>
                <Field label="Reference (optional)" error={f.errors.description}><input className="input" maxLength={140} value={v.description} onChange={f.set('description')} /></Field>
              </div>
              {check && !check.allowed && <Alert>{check.reason}</Alert>}
              <Alert>{f.formError}</Alert>
              <Button type="submit" loading={f.busy}><ArrowLeftRight size={16} />Review transfer</Button>
            </form>
          ))}</Async>
        </Card>
        <SourceLimits accountId={v.sourceAccountId} />
      </div>
      {confirming && check && (
        <ConfirmDialog title="Confirm transfer" confirmLabel={check.requiresApproval ? 'Submit for review' : 'Send money'} onClose={() => setConfirming(false)} onConfirm={send}>
          <dl className="dl">
            <dt>From</dt><dd>{source ? acctName(source) : '—'}</dd>
            <dt>To</dt><dd>{mode === 'own' ? acctName((accounts.data || []).find((a) => String(a.id) === v.destinationAccountId)) : ben ? `${ben.name} · ${ben.bankName}` : '—'}</dd>
            <dt>Amount</dt><dd><b>{money(Number(v.amount))}</b></dd>
            <dt>Fee</dt><dd>{money(check.fee)}</dd>
          </dl>
          {check.requiresApproval && <Alert type="warning">{check.approvalReason}. The funds will be held until your branch reviews the transfer.</Alert>}
        </ConfirmDialog>
      )}
    </>
  );
}

function SourceLimits({ accountId }) {
  const q = useApi(accountId ? `/accounts/${accountId}/limits` : null);
  return (
    <Card title="Your limits" subtitle={accountId ? 'For the selected account, today' : 'Select an account to see limits'}>
      {q.data ? (
        <dl className="dl">
          <dt>Per transfer</dt><dd>{money(q.data.online.perTransaction)}</dd>
          <dt>Daily limit</dt><dd>{money(q.data.online.daily)}</dd>
          <dt>Remaining today</dt><dd>{money(q.data.online.remainingToday)}</dd>
          <dt>Reviewed above</dt><dd>{money(q.data.online.approvalThreshold)}</dd>
          <dt>New payees (24h)</dt><dd>{money(q.data.online.newBeneficiaryLimit)}</dd>
        </dl>
      ) : <p className="muted" style={{ margin: 0 }}>Transfers above your branch&apos;s review threshold are held for manager approval.</p>}
    </Card>
  );
}

export function Beneficiaries() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const q = useApi('/beneficiaries', { pageSize: 100 }, { reloadKey });
  const [adding, setAdding] = useState(false);
  const [activating, setActivating] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    if (id && q.data) {
      const b = q.data.find((x) => String(x.id) === id);
      if (b && b.status === 'pending_activation') setActivating(b);
    }
  }, [id, q.data]);

  const toggle = async (b) => {
    try {
      const r = await api.post(`/beneficiaries/${b.id}/${b.status === 'active' ? 'disable' : 'enable'}`);
      toast.success(b.status === 'active' ? 'Beneficiary disabled' : 'Activation code sent', b.status === 'active' ? undefined : 'Check your notifications for the code.');
      reload();
      if (r.data.status === 'pending_activation') setActivating(r.data);
    } catch (e) { toast.error('Action failed', errorText(e)); }
  };

  return (
    <>
      <PageHeader title="Beneficiaries" subtitle="People and accounts you can send money to. New payees are activated with a one-time code." actions={<Button onClick={() => setAdding(true)}><Plus size={16} />Add beneficiary</Button>} />
      <Card flush>
        <Async q={q}>{(list) => (list.length === 0 ? <EmptyState icon={UserRoundPlus} title="No beneficiaries yet" message="Add a payee to start sending money." action={<Button onClick={() => setAdding(true)}>Add beneficiary</Button>} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Name</th><th>Bank</th><th>Account</th><th>Status</th><th className="num">Daily limit</th><th>Added</th><th /></tr></thead>
            <tbody>{list.map((b) => (
              <tr key={b.id}>
                <td><b>{b.nickname || b.name}</b>{b.nickname && <div className="subtle">{b.name}</div>}</td>
                <td>{b.bankName}{b.isInternal && <span className="badge blue" style={{ marginLeft: 6 }}>Internal</span>}</td>
                <td className="mono">••{b.accountNumber.slice(-4)}</td>
                <td><StatusBadge status={b.status} /></td>
                <td className="num">{money(b.dailyLimit)}</td>
                <td>{fmtDate(b.createdAt)}</td>
                <td className="right"><div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                  {b.status === 'pending_activation' && <Button size="sm" onClick={() => setActivating(b)}><ShieldCheck size={14} />Activate</Button>}
                  {b.status !== 'pending_activation' && <Button size="sm" variant="secondary" onClick={() => toggle(b)}>{b.status === 'active' ? 'Disable' : 'Enable'}</Button>}
                  {b.status === 'active' && <Button size="sm" variant="secondary" onClick={() => navigate('/transfer')}>Pay</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>Edit</Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${b.name}`} onClick={() => setDeleting(b)}><Trash2 size={14} /></Button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        ))}</Async>
      </Card>
      {adding && <AddBeneficiary onClose={() => setAdding(false)} onCreated={(b) => { setAdding(false); reload(); setActivating(b); }} />}
      {activating && <ActivateBeneficiary b={activating} onClose={() => { setActivating(null); if (id) navigate('/beneficiaries', { replace: true }); }} onDone={reload} />}
      {editing && <EditBeneficiary b={editing} onClose={() => setEditing(null)} onDone={reload} />}
      {deleting && (
        <ConfirmDialog danger title="Delete beneficiary" confirmLabel="Delete" message={`${deleting.name} will be removed from your payees.`} onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.del(`/beneficiaries/${deleting.id}`); toast.success('Beneficiary deleted'); reload(); }} />
      )}
    </>
  );
}

function AddBeneficiary({ onClose, onCreated }) {
  const toast = useToast();
  const branches = useApi('/public/branches');
  const [kind, setKind] = useState('internal');
  const [lookup, setLookup] = useState(null);
  const f = useForm({ name: '', nickname: '', accountNumber: '', routingNumber: '', bankName: '', dailyLimit: '2000' });
  const v = f.values;
  const verify = f.submit(async () => {
    const r = await api.get('/accounts/lookup', { accountNumber: v.accountNumber });
    setLookup(r.data);
    f.setValues((s) => ({ ...s, routingNumber: r.data.routingNumber }));
  });
  const onSubmit = f.submit(async (x) => {
    const body = { name: x.name, accountNumber: x.accountNumber, routingNumber: x.routingNumber, dailyLimit: Number(x.dailyLimit) };
    if (x.nickname) body.nickname = x.nickname;
    if (kind === 'external') body.bankName = x.bankName;
    const r = await api.post('/beneficiaries', body);
    toast.success('Beneficiary added', 'Enter the activation code from your notifications to start paying them.');
    onCreated(r.data);
  });
  return (
    <Modal title="Add beneficiary" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="add-ben" loading={f.busy} disabled={kind === 'internal' && !lookup}>Add beneficiary</Button></>}>
      <Tabs value={kind} onChange={(k) => { setKind(k); setLookup(null); }} tabs={[{ value: 'internal', label: 'Kestrel Bank account' }, { value: 'external', label: 'Other bank' }]} />
      <form id="add-ben" className="form" onSubmit={onSubmit}>
        {kind === 'internal' ? (
          <>
            <Field label="Account number" error={f.errors.accountNumber}>
              <div className="row" style={{ flexWrap: 'nowrap' }}><input className="input mono" value={v.accountNumber} onChange={(e) => { f.set('accountNumber')(e); setLookup(null); }} placeholder="10 digits" required /><Button variant="secondary" onClick={verify} loading={f.busy}>Verify</Button></div>
            </Field>
            {lookup && <Alert type={lookup.acceptsCredits ? 'success' : 'error'}>{lookup.acceptsCredits ? `Account found: ${lookup.holderName} at ${lookup.branchName}.` : 'This account cannot receive transfers.'}</Alert>}
          </>
        ) : (
          <div className="form-grid">
            <Field label="Bank name" error={f.errors.bankName}><input className="input" value={v.bankName} onChange={f.set('bankName')} required /></Field>
            <Field label="Routing number" error={f.errors.routingNumber}><input className="input mono" maxLength={9} value={v.routingNumber} onChange={f.set('routingNumber')} required /></Field>
            <Field label="Account number" className="full" error={f.errors.accountNumber}><input className="input mono" value={v.accountNumber} onChange={f.set('accountNumber')} required /></Field>
          </div>
        )}
        <div className="form-grid">
          <Field label="Beneficiary name" error={f.errors.name}><input className="input" value={v.name} onChange={f.set('name')} required /></Field>
          <Field label="Nickname (optional)" error={f.errors.nickname}><input className="input" maxLength={40} value={v.nickname} onChange={f.set('nickname')} /></Field>
          <Field label="Daily limit" className="full" error={f.errors.dailyLimit} hint="Cannot exceed your daily online transfer limit"><div className="input-prefix"><span>$</span><input type="number" min="1" className="input" value={v.dailyLimit} onChange={f.set('dailyLimit')} required /></div></Field>
        </div>
        {kind === 'internal' && branches.data && <p className="subtle" style={{ margin: 0 }}>Kestrel routing numbers: {branches.data.map((b) => b.name).join(', ')}</p>}
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

function ActivateBeneficiary({ b, onClose, onDone }) {
  const toast = useToast();
  const f = useForm({ code: '' });
  const onSubmit = f.submit(async (v) => {
    await api.post(`/beneficiaries/${b.id}/activate`, { code: v.code.trim() });
    toast.success('Beneficiary activated', 'For the first 24 hours, a lower transfer limit applies.');
    onDone();
    onClose();
  });
  const resend = async () => {
    try { await api.post(`/beneficiaries/${b.id}/resend-code`); toast.info('New code sent', 'Check your notifications.'); } catch (e) { toast.error('Could not resend', errorText(e)); }
  };
  return (
    <Modal title={`Activate ${b.nickname || b.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={resend}>Resend code</Button><Button variant="secondary" onClick={onClose}>Later</Button><Button type="submit" form="activate" loading={f.busy}>Activate</Button></>}>
      <form id="activate" className="form" onSubmit={onSubmit}>
        <Alert type="info">We sent a 6-digit code to your <Link to="/notifications">notifications</Link> (simulating SMS). It expires in 10 minutes.</Alert>
        <Field label="Activation code" error={f.errors.code}><input className="input mono" inputMode="numeric" maxLength={6} value={f.values.code} onChange={f.set('code')} autoComplete="one-time-code" required /></Field>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

function EditBeneficiary({ b, onClose, onDone }) {
  const toast = useToast();
  const f = useForm({ nickname: b.nickname || '', dailyLimit: String(b.dailyLimit) });
  const onSubmit = f.submit(async (v) => {
    await api.patch(`/beneficiaries/${b.id}`, { nickname: v.nickname || null, dailyLimit: Number(v.dailyLimit) });
    toast.success('Beneficiary updated');
    onDone();
    onClose();
  });
  return (
    <Modal title="Edit beneficiary" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="edit-ben" loading={f.busy}>Save</Button></>}>
      <form id="edit-ben" className="form" onSubmit={onSubmit}>
        <p className="muted" style={{ margin: 0 }}>{b.name} · {b.bankName} ••{b.accountNumber.slice(-4)}. To change account details, add a new beneficiary.</p>
        <Field label="Nickname" error={f.errors.nickname}><input className="input" maxLength={40} value={f.values.nickname} onChange={f.set('nickname')} /></Field>
        <Field label="Daily limit" error={f.errors.dailyLimit}><div className="input-prefix"><span>$</span><input type="number" min="1" className="input" value={f.values.dailyLimit} onChange={f.set('dailyLimit')} required /></div></Field>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}
