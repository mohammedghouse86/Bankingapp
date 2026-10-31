import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Download, Lock, Pencil, Plus, Search, Snowflake, Sun, UserPlus, X, XCircle } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import {
  Alert, Async, Button, Card, ConfirmDialog, DataTable, Field, Modal, PageHeader, Stat, StatusBadge, Tabs, fmtDate, fmtDateTime,
  money, useApi, useDebounced, useForm, useToast, label, daysAgo, today, errorText,
} from '../ui';
import { acctName, txnColumns } from './common';

export function AccountsList() {
  const { isCustomer } = useAuth();
  return isCustomer ? <MyAccounts /> : <StaffAccounts />;
}

function MyAccounts() {
  const q = useApi('/accounts', { pageSize: 100, sort: 'openedAt', order: 'asc' });
  return (
    <>
      <PageHeader title="My accounts" subtitle="Balances, statements and account details." />
      <Async q={q}>{(list) => {
        const open = list.filter((a) => a.status !== 'closed');
        const closed = list.filter((a) => a.status === 'closed');
        if (!list.length) return <Card><div className="empty"><h3>No accounts yet</h3><p className="muted">Visit your branch to open your first account.</p></div></Card>;
        return (
          <div className="stack">
            <div className="grid grid-3">
              {open.map((a) => (
                <Link key={a.id} to={`/accounts/${a.id}`} className="acct-card">
                  <div className="row between"><span className="type">{label(a.type)}</span><StatusBadge status={a.status} /></div>
                  <div className="bal">{money(a.ledgerBalance)}</div>
                  <div className="subtle">{a.nickname || 'Account'} ••{a.accountNumber.slice(-4)}</div>
                  <div className="row between" style={{ marginTop: 10, fontSize: 12.5 }}>
                    <span className="muted">Available {money(a.availableBalance)}</span>
                    {a.holders.length > 1 && <span className="badge blue">Joint</span>}
                  </div>
                </Link>
              ))}
            </div>
            {closed.length > 0 && (
              <Card title="Closed accounts">
                <ul className="timeline">{closed.map((a) => <li key={a.id}><div style={{ flex: 1 }}><Link to={`/accounts/${a.id}`}>{acctName(a)}</Link><div className="subtle">Closed {fmtDate(a.closedAt)}</div></div><StatusBadge status="closed" /></li>)}</ul>
              </Card>
            )}
          </div>
        );
      }}</Async>
    </>
  );
}

function StaffAccounts() {
  const { can, role } = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState(sp.get('status') || '');
  const [branchId, setBranch] = useState('');
  const [opening, setOpening] = useState(false);
  const branches = useApi(role === 'super_admin' ? '/branches' : null, { pageSize: 50 });
  const s = useDebounced(search);
  return (
    <>
      <PageHeader title="Accounts" subtitle="Search and manage customer accounts." actions={can('accounts:open') && <Button onClick={() => setOpening(true)}><Plus size={16} />Open account</Button>} />
      <Card flush title={(
        <div className="filters">
          <div className="input-prefix search"><span><Search size={14} /></span><input className="input" placeholder="Account number, nickname or holder" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search accounts" /></div>
          <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">All types</option><option value="checking">Checking</option><option value="savings">Savings</option><option value="fixed_deposit">Fixed deposit</option></select>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{['active', 'frozen', 'dormant', 'closed'].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select>
          {branches.data && <select className="select" value={branchId} onChange={(e) => setBranch(e.target.value)} aria-label="Branch"><option value="">All branches</option>{branches.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        </div>
      )}>
        <DataTable path="/accounts" params={{ search: s, type, status, branchId }} initialSort={{ key: 'openedAt', order: 'desc' }} onRowClick={(a) => navigate(`/accounts/${a.id}`)}
          columns={[
            { key: 'accountNumber', label: 'Account', sort: 'accountNumber', render: (a) => <div><span className="mono">{a.accountNumber}</span>{a.nickname && <div className="subtle">{a.nickname}</div>}</div> },
            { key: 'holders', label: 'Holder(s)', render: (a) => a.holders.map((h) => h.name).join(', ') },
            { key: 'type', label: 'Type', render: (a) => <span style={{ textTransform: 'capitalize' }}>{label(a.type)}</span> },
            { key: 'branchName', label: 'Branch' },
            { key: 'status', label: 'Status', sort: 'status', render: (a) => <StatusBadge status={a.status} /> },
            { key: 'balance', label: 'Ledger balance', num: true, sort: 'balance', render: (a) => money(a.ledgerBalance) },
            { key: 'lastActivityAt', label: 'Last activity', sort: 'lastActivityAt', render: (a) => fmtDate(a.lastActivityAt) },
          ]} />
      </Card>
      {opening && <OpenAccountModal onClose={() => setOpening(false)} onDone={(a) => navigate(`/accounts/${a.id}`)} />}
    </>
  );
}

/** Open an account; when `customer` is omitted a customer picker is shown. */
export function OpenAccountModal({ customer, onClose, onDone }) {
  const toast = useToast();
  const [picked, setPicked] = useState(customer || null);
  const [search, setSearch] = useState('');
  const s = useDebounced(search);
  const results = useApi(!picked && s.length >= 2 ? '/customers' : null, { search: s, status: 'active', kycStatus: 'verified', pageSize: 8 });
  const funding = useApi(picked ? `/customers/${picked.id}/accounts` : null);
  const f = useForm({ type: 'savings', nickname: '', initialDeposit: '', fdAmount: '', termMonths: '12', fundingAccountId: '' });
  const v = f.values;
  const onSubmit = f.submit(async (x) => {
    const body = { customerId: picked.id, type: x.type };
    if (x.nickname) body.nickname = x.nickname;
    if (x.type === 'fixed_deposit') body.fixedDeposit = { amount: Number(x.fdAmount), termMonths: Number(x.termMonths), fundingAccountId: Number(x.fundingAccountId) };
    else body.initialDeposit = Number(x.initialDeposit);
    const r = await api.post('/accounts', body);
    toast.success('Account opened', `${label(r.data.type)} account ${r.data.accountNumber} is active.`);
    onDone(r.data);
  });
  const fundable = (funding.data || []).filter((a) => a.status === 'active' && a.type !== 'fixed_deposit');
  return (
    <Modal title="Open a new account" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="open-acct" loading={f.busy} disabled={!picked}>Open account</Button></>}>
      <form id="open-acct" className="form" onSubmit={onSubmit}>
        {picked ? (
          <div className="row between card" style={{ padding: '10px 12px' }}>
            <div><b>{picked.fullName}</b><div className="subtle">{picked.customerNumber} · {picked.branchName}</div></div>
            {!customer && <Button variant="ghost" size="sm" onClick={() => setPicked(null)} aria-label="Change customer"><X size={14} /></Button>}
          </div>
        ) : (
          <Field label="Customer" hint="Only active customers with verified identity are eligible">
            <input className="input" placeholder="Search by name, email or customer #" value={search} onChange={(e) => setSearch(e.target.value)} />
            {results.data && (
              <div className="card" style={{ marginTop: 6 }}>
                {results.data.length === 0 && <div className="subtle" style={{ padding: 10 }}>No eligible customers found</div>}
                {results.data.map((c) => <button type="button" key={c.id} className="btn btn-ghost btn-block" style={{ justifyContent: 'flex-start' }} onClick={() => setPicked(c)}>{c.fullName} · {c.customerNumber}</button>)}
              </div>
            )}
          </Field>
        )}
        <div className="form-grid">
          <Field label="Account type"><select className="select" value={v.type} onChange={f.set('type')}><option value="savings">Savings</option><option value="checking">Checking</option><option value="fixed_deposit">Fixed deposit</option></select></Field>
          <Field label="Nickname (optional)" error={f.errors.nickname}><input className="input" maxLength={40} value={v.nickname} onChange={f.set('nickname')} /></Field>
          {v.type !== 'fixed_deposit' ? (
            <Field label="Opening cash deposit" className="full" error={f.errors.initialDeposit} hint="Minimum opening deposit applies">
              <div className="input-prefix"><span>$</span><input type="number" step="0.01" min="0" className="input" value={v.initialDeposit} onChange={f.set('initialDeposit')} required /></div>
            </Field>
          ) : (
            <>
              <Field label="Deposit amount" error={f.errors['fixedDeposit.amount']}><div className="input-prefix"><span>$</span><input type="number" step="0.01" min="1000" className="input" value={v.fdAmount} onChange={f.set('fdAmount')} required /></div></Field>
              <Field label="Term"><select className="select" value={v.termMonths} onChange={f.set('termMonths')}>{[6, 12, 24, 36].map((t) => <option key={t} value={t}>{t} months</option>)}</select></Field>
              <Field label="Fund from" className="full" error={f.errors['fixedDeposit.fundingAccountId']}>
                <select className="select" value={v.fundingAccountId} onChange={f.set('fundingAccountId')} required disabled={!picked}>
                  <option value="">Select a funding account…</option>
                  {fundable.map((a) => <option key={a.id} value={a.id}>{acctName(a)} — available {money(a.availableBalance)}</option>)}
                </select>
              </Field>
            </>
          )}
        </div>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

export function AccountDetail() {
  const { id } = useParams();
  const { can, isCustomer } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('transactions');
  const [dialog, setDialog] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const q = useApi(`/accounts/${id}`, null, { reloadKey });
  const reload = () => setReloadKey((k) => k + 1);

  return (
    <Async q={q}>{(a) => (
      <>
        <PageHeader
          crumbs={[{ label: isCustomer ? 'My accounts' : 'Accounts', to: '/accounts' }, { label: a.accountNumber }]}
          title={<span className="row">{a.nickname || `${label(a.type)} account`} <StatusBadge status={a.status} /></span>}
          subtitle={<span><span className="mono">{a.accountNumber}</span> · Routing <span className="mono">{a.routingNumber}</span> · {a.branchName}</span>}
          actions={a.status !== 'closed' && (
            <>
              {(can('portal:accounts') || can('accounts:update')) && <Button variant="secondary" onClick={() => setDialog('rename')}><Pencil size={15} />Rename</Button>}
              {can('accounts:update') && a.type === 'checking' && a.status === 'active' && <Button variant="secondary" onClick={() => setDialog('overdraft')}>Overdraft</Button>}
              {can('accounts:freeze') && ['active', 'dormant'].includes(a.status) && <Button variant="danger" onClick={() => setDialog('freeze')}><Snowflake size={15} />Freeze</Button>}
              {can('accounts:freeze') && a.status === 'frozen' && <Button variant="success" onClick={() => setDialog('unfreeze')}><Sun size={15} />Unfreeze</Button>}
              {can('accounts:freeze') && a.status === 'dormant' && <Button variant="success" onClick={() => setDialog('reactivate')}>Reactivate</Button>}
              {can('accounts:close') && a.type === 'fixed_deposit' && a.status === 'active' && <Button variant="secondary" onClick={() => setDialog('break')}>Break deposit</Button>}
              {can('accounts:close') && a.type !== 'fixed_deposit' && <Button variant="ghost" onClick={() => setDialog('close')}><XCircle size={15} />Close account</Button>}
            </>
          )}
        />
        {a.statusReason && a.status !== 'active' && <div style={{ marginBottom: 16 }}><Alert type="warning"><b style={{ textTransform: 'capitalize' }}>{a.status}:</b> {a.statusReason}</Alert></div>}
        <div className="grid grid-4" style={{ marginBottom: 16 }}>
          <Stat label="Ledger balance" value={money(a.ledgerBalance)} />
          <Stat label="Available balance" value={money(a.availableBalance)} tone="green" />
          <Stat label="On hold" value={money(a.holdAmount)} sub="Pending transactions" />
          {a.type === 'fixed_deposit' && a.fixedDeposit
            ? <Stat label="Matures" value={fmtDate(a.fixedDeposit.maturityDate)} sub={`${a.fixedDeposit.termMonths} months at ${a.interestRate}%`} />
            : <Stat label="Interest / overdraft" value={`${a.interestRate}%`} sub={`Overdraft limit ${money(a.overdraftLimit)}`} />}
        </div>
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'transactions', label: 'Transactions' }, { value: 'statement', label: 'Statements' }, { value: 'holders', label: `Holders (${a.holders.length})` }, { value: 'limits', label: 'Limits' }, { value: 'details', label: 'Details' }]} />
        {tab === 'transactions' && <AccountTransactions a={a} reloadKey={reloadKey} />}
        {tab === 'statement' && <Statement a={a} />}
        {tab === 'holders' && <Holders a={a} onChange={reload} canManage={can('accounts:holders') && a.status !== 'closed' && a.type !== 'fixed_deposit'} />}
        {tab === 'limits' && <Limits id={a.id} />}
        {tab === 'details' && (
          <Card>
            <dl className="dl">
              <dt>Account type</dt><dd style={{ textTransform: 'capitalize' }}>{label(a.type)}</dd>
              <dt>Currency</dt><dd>{a.currency}</dd>
              <dt>Opened</dt><dd>{fmtDateTime(a.openedAt)}</dd>
              <dt>Last activity</dt><dd>{fmtDateTime(a.lastActivityAt)}</dd>
              {a.closedAt && <><dt>Closed</dt><dd>{fmtDateTime(a.closedAt)}</dd></>}
              {a.fixedDeposit && <><dt>Principal</dt><dd>{money(a.fixedDeposit.principal)}</dd><dt>Linked payout account</dt><dd>{a.fixedDeposit.linkedAccountId ? <Link to={`/accounts/${a.fixedDeposit.linkedAccountId}`}>View account</Link> : '—'}</dd></>}
            </dl>
          </Card>
        )}

        {dialog === 'rename' && <RenameDialog a={a} onClose={() => setDialog(null)} onDone={reload} />}
        {dialog === 'overdraft' && <OverdraftDialog a={a} onClose={() => setDialog(null)} onDone={reload} />}
        {['freeze', 'unfreeze', 'reactivate'].includes(dialog) && (
          <ConfirmDialog reason danger={dialog === 'freeze'} title={`${label(dialog)} account`.replace(/^./, (c) => c.toUpperCase())}
            message={dialog === 'freeze' ? 'A frozen account cannot send or receive funds until it is unfrozen. Account holders will be notified.' : 'The account will become active again for all transactions.'}
            confirmLabel={label(dialog).replace(/^./, (c) => c.toUpperCase())} onClose={() => setDialog(null)}
            onConfirm={async (reason) => { await api.post(`/accounts/${a.id}/${dialog}`, { reason }); toast.success(`Account ${dialog === 'freeze' ? 'frozen' : dialog === 'unfreeze' ? 'unfrozen' : 'reactivated'}`); reload(); }} />
        )}
        {dialog === 'break' && (
          <ConfirmDialog reason danger title="Break fixed deposit" confirmLabel="Break deposit" onClose={() => setDialog(null)}
            message={`The balance will be paid to the linked account. ${new Date(a.fixedDeposit.maturityDate) > new Date() ? 'This deposit has not matured, so an early-withdrawal penalty applies.' : 'The deposit has matured; no penalty applies.'}`}
            onConfirm={async (reason) => { const r = await api.post(`/accounts/${a.id}/break-deposit`, { reason }); toast.success('Fixed deposit closed', `Paid out ${money(r.data.payout)} (penalty ${money(r.data.penalty)}).`); reload(); }} />
        )}
        {dialog === 'close' && <CloseDialog a={a} onClose={() => setDialog(null)} onDone={() => { reload(); navigate(`/accounts/${a.id}`); }} />}
      </>
    )}</Async>
  );
}

function AccountTransactions({ a, reloadKey }) {
  const navigate = useNavigate();
  const [direction, setDirection] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  return (
    <Card flush title={(
      <div className="filters">
        <select className="select" value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Direction"><option value="">Money in & out</option><option value="credit">Money in</option><option value="debit">Money out</option></select>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">All types</option>{['deposit', 'withdrawal', 'transfer', 'reversal', 'fee', 'interest', 'fd_closure'].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select>
        <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
      </div>
    )}>
      <DataTable path={`/accounts/${a.id}/transactions`} params={{ direction, type, from, to }} reloadKey={reloadKey} initialSort={{ key: 'createdAt', order: 'desc' }} columns={txnColumns({ accountId: a.id })} onRowClick={(t) => navigate(`/transactions/${t.id}`)} />
    </Card>
  );
}

function Statement({ a }) {
  const toast = useToast();
  const [range, setRange] = useState({ from: daysAgo(30), to: today() });
  const [applied, setApplied] = useState(range);
  const q = useApi(`/accounts/${a.id}/statement`, applied);
  const [busy, setBusy] = useState(null);
  const download = async (format) => {
    setBusy(format);
    try { await api.download(`/accounts/${a.id}/statement/download`, { ...applied, format }, `statement.${format}`); toast.success('Statement downloaded'); } catch (e) { toast.error('Download failed', errorText(e)); }
    setBusy(null);
  };
  return (
    <Card title="Account statement" actions={(
      <div className="filters">
        <input type="date" className="input" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From" />
        <input type="date" className="input" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To" />
        <Button variant="secondary" onClick={() => setApplied(range)}>Apply</Button>
        <Button variant="secondary" loading={busy === 'csv'} onClick={() => download('csv')}><Download size={15} />CSV</Button>
        <Button variant="secondary" loading={busy === 'html'} onClick={() => download('html')}><Download size={15} />Printable</Button>
      </div>
    )}>
      <Async q={q}>{(st) => (
        <div className="stack">
          <div className="grid grid-4">
            <Stat label="Opening balance" value={money(st.openingBalance)} />
            <Stat label="Money in" value={money(st.totalCredits)} tone="green" />
            <Stat label="Money out" value={money(st.totalDebits)} tone="red" />
            <Stat label="Closing balance" value={money(st.closingBalance)} />
          </div>
          {st.lines.length ? (
            <div className="table-wrap"><table className="table"><thead><tr><th>Date</th><th>Description</th><th>Reference</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
              <tbody>{st.lines.map((l) => <tr key={`${l.reference}${l.date}${l.balance}`}><td className="nowrap">{fmtDate(l.date)}</td><td>{l.description}</td><td className="mono">{l.reference}</td><td className="num neg">{l.debit != null ? money(l.debit) : ''}</td><td className="num pos">{l.credit != null ? money(l.credit) : ''}</td><td className="num">{money(l.balance)}</td></tr>)}</tbody></table></div>
          ) : <p className="muted">No postings in this period.</p>}
        </div>
      )}</Async>
    </Card>
  );
}

function Holders({ a, onChange, canManage }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [search, setSearch] = useState('');
  const s = useDebounced(search);
  const results = useApi(adding && s.length >= 2 ? '/customers' : null, { search: s, status: 'active', kycStatus: 'verified', pageSize: 6 });
  const add = async (cid) => {
    try { await api.post(`/accounts/${a.id}/holders`, { customerId: cid }); toast.success('Joint holder added'); setAdding(false); onChange(); } catch (e) { toast.error('Could not add holder', errorText(e)); }
  };
  return (
    <Card title="Account holders" actions={canManage && <Button variant="secondary" onClick={() => setAdding(true)}><UserPlus size={15} />Add joint holder</Button>}>
      <ul className="timeline">
        {a.holders.map((h) => (
          <li key={h.customerId}>
            <div style={{ flex: 1 }}><b>{h.name}</b><div className="subtle">{h.customerNumber} · added {fmtDate(h.addedAt)}</div></div>
            <span className={`badge ${h.holderType === 'primary' ? 'blue' : 'gray'}`}>{h.holderType}</span>
            {canManage && h.holderType === 'joint' && <Button variant="ghost" size="sm" onClick={() => setRemoving(h)}>Remove</Button>}
          </li>
        ))}
      </ul>
      {adding && (
        <Modal title="Add joint holder" onClose={() => setAdding(false)}>
          <Field label="Find customer" hint="Joint holders must be active with verified identity"><input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email or customer #" /></Field>
          <div className="stack" style={{ gap: 6, marginTop: 10 }}>
            {(results.data || []).filter((c) => !a.holders.some((h) => h.customerId === c.id)).map((c) => (
              <div key={c.id} className="row between card" style={{ padding: '8px 12px' }}><span>{c.fullName} <span className="subtle">{c.customerNumber}</span></span><Button size="sm" onClick={() => add(c.id)}>Add</Button></div>
            ))}
          </div>
        </Modal>
      )}
      {removing && (
        <ConfirmDialog danger title="Remove joint holder" message={`${removing.name} will lose access to this account.`} confirmLabel="Remove" onClose={() => setRemoving(null)}
          onConfirm={async () => { await api.del(`/accounts/${a.id}/holders/${removing.customerId}`); toast.success('Joint holder removed'); onChange(); }} />
      )}
    </Card>
  );
}

function Limits({ id }) {
  const q = useApi(`/accounts/${id}/limits`);
  return (
    <Async q={q}>{(l) => (
      <div className="grid grid-2">
        <Card title="Online banking limits">
          <dl className="dl">
            <dt>Per transaction</dt><dd>{money(l.online.perTransaction)}</dd>
            <dt>Daily limit</dt><dd>{money(l.online.daily)}</dd>
            <dt>Used today</dt><dd>{money(l.online.usedToday)}</dd>
            <dt>Remaining today</dt><dd>{money(l.online.remainingToday)}</dd>
            <dt>Manager review above</dt><dd>{money(l.online.approvalThreshold)}</dd>
            <dt>New payee limit (24h)</dt><dd>{money(l.online.newBeneficiaryLimit)}</dd>
          </dl>
        </Card>
        <Card title="Branch limits">
          <dl className="dl">
            <dt>Daily cash withdrawal</dt><dd>{money(l.branch.dailyCashWithdrawal)}</dd>
            <dt>Cash used today</dt><dd>{money(l.branch.cashUsedToday)}</dd>
            <dt>Teller cash limit</dt><dd>{money(l.branch.tellerCashWithdrawalLimit)}</dd>
            <dt>Approval threshold</dt><dd>{money(l.branch.approvalThreshold)}</dd>
          </dl>
        </Card>
      </div>
    )}</Async>
  );
}

function RenameDialog({ a, onClose, onDone }) {
  const toast = useToast();
  const f = useForm({ nickname: a.nickname || '' });
  const onSubmit = f.submit(async (v) => { await api.patch(`/accounts/${a.id}`, { nickname: v.nickname || null }); toast.success('Account renamed'); onDone(); onClose(); });
  return (
    <Modal title="Rename account" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="rename" loading={f.busy}>Save</Button></>}>
      <form id="rename" className="form" onSubmit={onSubmit}>
        <Field label="Nickname" error={f.errors.nickname} hint="Leave empty to remove the nickname"><input className="input" maxLength={40} value={f.values.nickname} onChange={f.set('nickname')} /></Field>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

function OverdraftDialog({ a, onClose, onDone }) {
  const toast = useToast();
  const f = useForm({ overdraftLimit: String(a.overdraftLimit), reason: '' });
  const onSubmit = f.submit(async (v) => { await api.put(`/accounts/${a.id}/overdraft`, { overdraftLimit: Number(v.overdraftLimit), reason: v.reason }); toast.success('Overdraft limit updated'); onDone(); onClose(); });
  return (
    <Modal title="Overdraft limit" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="od" loading={f.busy}>Save</Button></>}>
      <form id="od" className="form" onSubmit={onSubmit}>
        <Field label="Overdraft limit" error={f.errors.overdraftLimit} hint="Capped by the global maximum overdraft policy"><div className="input-prefix"><span>$</span><input type="number" min="0" step="0.01" className="input" value={f.values.overdraftLimit} onChange={f.set('overdraftLimit')} required /></div></Field>
        <Field label="Reason" error={f.errors.reason}><textarea className="textarea" value={f.values.reason} onChange={f.set('reason')} required /></Field>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

function CloseDialog({ a, onClose, onDone }) {
  const toast = useToast();
  const primary = a.holders.find((h) => h.holderType === 'primary');
  const others = useApi(primary ? `/customers/${primary.customerId}/accounts` : null);
  const f = useForm({ reason: '', transferToAccountId: '' });
  const targets = (others.data || []).filter((x) => x.id !== a.id && !['closed', 'frozen'].includes(x.status) && x.type !== 'fixed_deposit');
  const onSubmit = f.submit(async (v) => {
    const body = { reason: v.reason };
    if (v.transferToAccountId) body.transferToAccountId = Number(v.transferToAccountId);
    await api.post(`/accounts/${a.id}/close`, body);
    toast.success('Account closed');
    onDone();
    onClose();
  });
  return (
    <Modal title="Close account" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" type="submit" form="close-acct" loading={f.busy}>Close account</Button></>}>
      <form id="close-acct" className="form" onSubmit={onSubmit}>
        <Alert type="warning"><Lock size={14} /> Closing is permanent. Pending transactions must be resolved first and an overdrawn account must be settled.</Alert>
        {a.ledgerBalance > 0 && (
          <Field label={`Transfer remaining ${money(a.ledgerBalance)} to`} error={f.errors.transferToAccountId}>
            <select className="select" value={f.values.transferToAccountId} onChange={f.set('transferToAccountId')} required>
              <option value="">Select one of the holder&apos;s accounts…</option>
              {targets.map((x) => <option key={x.id} value={x.id}>{acctName(x)}</option>)}
            </select>
          </Field>
        )}
        <Field label="Reason" error={f.errors.reason}><textarea className="textarea" value={f.values.reason} onChange={f.set('reason')} required /></Field>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}
