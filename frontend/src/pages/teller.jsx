import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Search, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alert, Button, Card, Field, PageHeader, StatusBadge, Tabs, money, useApi, useDebounced, useForm, useToast, label } from '../ui';
import { acctName } from './common';

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');

function AccountPicker({ value, onChange }) {
  const [search, setSearch] = useState('');
  const s = useDebounced(search);
  const results = useApi(!value && s.length >= 3 ? '/accounts' : null, { search: s, pageSize: 8 });
  if (value) {
    return (
      <div className="card" style={{ padding: 14 }}>
        <div className="row between">
          <div>
            <div className="row"><b>{acctName(value)}</b><StatusBadge status={value.status} /></div>
            <div className="subtle">{value.holders.map((h) => h.name).join(', ')} · {value.branchName}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onChange(null)} aria-label="Change account"><X size={15} /></Button>
        </div>
        <div className="row" style={{ gap: 24, marginTop: 10 }}>
          <div><div className="subtle">Ledger</div><b>{money(value.ledgerBalance)}</b></div>
          <div><div className="subtle">Available</div><b>{money(value.availableBalance)}</b></div>
          <div><div className="subtle">On hold</div><b>{money(value.holdAmount)}</b></div>
        </div>
      </div>
    );
  }
  return (
    <Field label="Account" hint="Search by account number or holder name (min. 3 characters)">
      <div className="input-prefix"><span><Search size={14} /></span><input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. 4001 or Thompson" /></div>
      {results.data && (
        <div className="card" style={{ marginTop: 6 }}>
          {results.data.length === 0 && <div className="subtle" style={{ padding: 10 }}>No accounts found in your scope</div>}
          {results.data.map((a) => (
            <button type="button" key={a.id} className="btn btn-ghost btn-block" style={{ justifyContent: 'space-between', height: 'auto', padding: '8px 12px' }} onClick={() => onChange(a)}>
              <span style={{ textAlign: 'left' }}><span className="mono">{a.accountNumber}</span> · {a.holders.map((h) => h.name).join(', ')}</span>
              <StatusBadge status={a.status} />
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}

function Result({ txn, onReset }) {
  const pending = txn.status === 'pending_approval';
  return (
    <div className="stack" style={{ alignItems: 'center', textAlign: 'center', padding: '12px 0' }}>
      {pending ? <Clock size={40} color="var(--warning)" /> : <CheckCircle2 size={40} color="var(--accent)" />}
      <h2>{pending ? 'Submitted for approval' : 'Transaction completed'}</h2>
      <p className="muted" style={{ margin: 0 }}>{label(txn.type)} of {money(txn.amount)} · <span className="mono">{txn.reference}</span></p>
      {pending && <Alert type="warning">The amount exceeds your limit, so the funds are on hold until a manager approves.</Alert>}
      <div className="row"><Link className="btn btn-secondary" to={`/transactions/${txn.id}`}>View receipt</Link><Button onClick={onReset}>New transaction</Button></div>
    </div>
  );
}

function useIdempotentSubmit() {
  const key = useRef(newKey());
  return { headers: () => ({ 'Idempotency-Key': key.current }), rotate: () => { key.current = newKey(); } };
}

function DepositForm({ account, onDone }) {
  const toast = useToast();
  const idem = useIdempotentSubmit();
  const f = useForm({ amount: '', depositorName: '', description: '' });
  const onSubmit = f.submit(async (v) => {
    const body = { accountId: account.id, amount: Number(v.amount), depositorName: v.depositorName };
    if (v.description) body.description = v.description;
    const r = await api.post('/transactions/deposits', body, { headers: idem.headers() });
    idem.rotate();
    toast.success(r.data.status === 'completed' ? 'Deposit posted' : 'Deposit held for review', r.data.reference);
    onDone(r.data);
  });
  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label="Amount" error={f.errors.amount}><div className="input-prefix"><span>$</span><input type="number" step="0.01" min="0.01" className="input" value={f.values.amount} onChange={f.set('amount')} required /></div></Field>
        <Field label="Depositor name" error={f.errors.depositorName}><input className="input" value={f.values.depositorName} onChange={f.set('depositorName')} required /></Field>
        <Field label="Memo (optional)" className="full" error={f.errors.description}><input className="input" maxLength={140} value={f.values.description} onChange={f.set('description')} /></Field>
      </div>
      <Alert>{f.formError}</Alert>
      <Button type="submit" loading={f.busy} disabled={account.status === 'closed'}>Post deposit</Button>
    </form>
  );
}

function WithdrawalForm({ account, onDone }) {
  const toast = useToast();
  const idem = useIdempotentSubmit();
  const f = useForm({ customerId: String(account.holders[0].customerId), documentType: 'passport', documentNumberLast4: '', amount: '', description: '' });
  const onSubmit = f.submit(async (v) => {
    const body = { accountId: account.id, customerId: Number(v.customerId), amount: Number(v.amount), idVerification: { documentType: v.documentType, documentNumberLast4: v.documentNumberLast4 } };
    if (v.description) body.description = v.description;
    const r = await api.post('/transactions/withdrawals', body, { headers: idem.headers() });
    idem.rotate();
    toast.success(r.data.status === 'completed' ? 'Withdrawal completed' : 'Withdrawal awaiting approval', r.data.reference);
    onDone(r.data);
  });
  return (
    <form className="form" onSubmit={onSubmit}>
      <Alert type="info">The account holder must be present. Verify their photo ID against the document on file before paying out cash.</Alert>
      <div className="form-grid">
        <Field label="Account holder present" error={f.errors.customerId}><select className="select" value={f.values.customerId} onChange={f.set('customerId')}>{account.holders.map((h) => <option key={h.customerId} value={h.customerId}>{h.name} ({h.holderType})</option>)}</select></Field>
        <Field label="ID document type"><select className="select" value={f.values.documentType} onChange={f.set('documentType')}><option value="passport">Passport</option><option value="drivers_license">Driver&apos;s license</option><option value="national_id">National ID</option></select></Field>
        <Field label="Last 4 of document number" error={f.errors['idVerification.documentNumberLast4']}><input className="input mono" maxLength={4} value={f.values.documentNumberLast4} onChange={f.set('documentNumberLast4')} required /></Field>
        <Field label="Amount" error={f.errors.amount}><div className="input-prefix"><span>$</span><input type="number" step="0.01" min="0.01" className="input" value={f.values.amount} onChange={f.set('amount')} required /></div></Field>
        <Field label="Memo (optional)" className="full"><input className="input" maxLength={140} value={f.values.description} onChange={f.set('description')} /></Field>
      </div>
      <Alert>{f.formError}</Alert>
      <Button type="submit" loading={f.busy}>Process withdrawal</Button>
    </form>
  );
}

function TransferForm({ account, onDone }) {
  const toast = useToast();
  const idem = useIdempotentSubmit();
  const f = useForm({ customerId: String(account.holders[0].customerId), target: '', amount: '', description: '' });
  const [check, setCheck] = useState(null);
  const own = useApi(`/customers/${f.values.customerId}/accounts`);
  const bens = useApi(`/customers/${f.values.customerId}/beneficiaries`);
  useEffect(() => { setCheck(null); }, [f.values.target, f.values.amount, f.values.customerId]);
  const body = (v) => {
    const [kind, id] = v.target.split(':');
    const b = { customerId: Number(v.customerId), sourceAccountId: account.id, amount: Number(v.amount) };
    if (kind === 'acct') b.destinationAccountId = Number(id); else b.beneficiaryId = Number(id);
    return b;
  };
  const validate = f.submit(async (v) => {
    if (!v.target || !v.amount) throw new Error('Choose a destination and amount first');
    const r = await api.post('/transfers/validate', body(v));
    setCheck(r.data);
  });
  const onSubmit = f.submit(async (v) => {
    const b = body(v);
    if (v.description) b.description = v.description;
    const r = await api.post('/transactions/transfers', b, { headers: idem.headers() });
    idem.rotate();
    toast.success(r.data.status === 'completed' ? 'Transfer completed' : 'Transfer awaiting approval', r.data.reference);
    onDone(r.data);
  });
  const targets = (own.data || []).filter((a) => a.id !== account.id && a.status !== 'closed' && a.type !== 'fixed_deposit');
  const activeBens = (bens.data || []).filter((b) => b.status === 'active');
  return (
    <form className="form" onSubmit={onSubmit}>
      <Alert type="info">Transfers can only go to another account of the same customer or to one of their registered, active beneficiaries.</Alert>
      <div className="form-grid">
        <Field label="Requesting customer"><select className="select" value={f.values.customerId} onChange={f.set('customerId')}>{account.holders.map((h) => <option key={h.customerId} value={h.customerId}>{h.name} ({h.holderType})</option>)}</select></Field>
        <Field label="Destination" error={f.errors.destinationAccountId || f.errors.beneficiaryId}>
          <select className="select" value={f.values.target} onChange={f.set('target')} required>
            <option value="">Select…</option>
            {targets.length > 0 && <optgroup label="Customer's own accounts">{targets.map((a) => <option key={a.id} value={`acct:${a.id}`}>{acctName(a)}</option>)}</optgroup>}
            {activeBens.length > 0 && <optgroup label="Registered beneficiaries">{activeBens.map((b) => <option key={b.id} value={`ben:${b.id}`}>{b.nickname || b.name} · {b.bankName}</option>)}</optgroup>}
          </select>
        </Field>
        <Field label="Amount" error={f.errors.amount}><div className="input-prefix"><span>$</span><input type="number" step="0.01" min="0.01" className="input" value={f.values.amount} onChange={f.set('amount')} required /></div></Field>
        <Field label="Memo (optional)"><input className="input" maxLength={140} value={f.values.description} onChange={f.set('description')} /></Field>
      </div>
      {check && (check.allowed
        ? <Alert type={check.requiresApproval ? 'warning' : 'success'}>{check.requiresApproval ? `Allowed, but requires approval: ${check.approvalReason}` : 'Transfer passes all checks.'}</Alert>
        : <Alert>{check.reason}</Alert>)}
      <Alert>{f.formError}</Alert>
      <div className="row"><Button variant="secondary" loading={f.busy} onClick={validate}>Check limits</Button><Button type="submit" loading={f.busy}>Submit transfer</Button></div>
    </form>
  );
}

export default function TellerOps() {
  const { can, user } = useAuth();
  const tabs = [
    can('transactions:deposit') && { value: 'deposit', label: 'Cash deposit' },
    can('transactions:withdraw') && { value: 'withdrawal', label: 'Cash withdrawal' },
    can('transactions:transfer') && { value: 'transfer', label: 'Transfer' },
  ].filter(Boolean);
  const [tab, setTab] = useState(tabs[0] ? tabs[0].value : 'deposit');
  const [account, setAccount] = useState(null);
  const [result, setResult] = useState(null);
  const limits = useApi(user.branchId ? `/branches/${user.branchId}/limits` : null);
  const reset = () => { setResult(null); setAccount(null); };
  return (
    <>
      <PageHeader title="Teller operations" subtitle="Post deposits, pay out withdrawals and move funds for customers at the counter." />
      <div className="grid grid-main">
        <Card>
          <Tabs value={tab} onChange={(v) => { setTab(v); setResult(null); }} tabs={tabs} />
          {result ? <Result txn={result} onReset={reset} /> : (
            <div className="stack">
              <AccountPicker value={account} onChange={setAccount} />
              {account && account.status !== 'active' && <Alert type="warning">This account is {account.status}{account.statusReason ? `: ${account.statusReason}` : ''}. Most transactions will be declined.</Alert>}
              {account && tab === 'deposit' && <DepositForm key={account.id} account={account} onDone={setResult} />}
              {account && tab === 'withdrawal' && <WithdrawalForm key={account.id} account={account} onDone={setResult} />}
              {account && tab === 'transfer' && <TransferForm key={account.id} account={account} onDone={setResult} />}
            </div>
          )}
        </Card>
        <Card title="Branch limits" subtitle="Amounts above these thresholds are held for approval">
          {limits.data ? (
            <dl className="dl">
              <dt>Teller cash withdrawal</dt><dd>{money(limits.data.limits.tellerCashWithdrawalLimit)}</dd>
              <dt>Daily cash per account</dt><dd>{money(limits.data.limits.dailyCashWithdrawalLimit)}</dd>
              <dt>Transfer approval</dt><dd>{money(limits.data.limits.approvalThreshold)}</dd>
              <dt>Large deposit review</dt><dd>{money(limits.data.limits.largeDepositThreshold)}</dd>
            </dl>
          ) : <p className="muted" style={{ margin: 0 }}>{user.branchId ? 'Loading…' : 'Super admins operate across all branches; branch limits of the account\'s branch apply.'}</p>}
        </Card>
      </div>
    </>
  );
}
