import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Ban, Check, Download, FileWarning, Printer, RotateCcw, Search, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import {
  Alert, Async, Button, Card, ConfirmDialog, DataTable, Field, Modal, PageHeader, StatusBadge, Tabs, fmtDateTime, money, useApi,
  useDebounced, useForm, useToast, label, errorText,
} from '../ui';
import { acctName, counterpartyText, txnColumns } from './common';

export function TransactionsList() {
  const { isCustomer, role } = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [mine, setMine] = useState(sp.get('mine') === '1');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [accountId, setAccountId] = useState(sp.get('accountId') || '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minAmount, setMin] = useState('');
  const s = useDebounced(search);
  const minDebounced = useDebounced(minAmount);
  const accounts = useApi(isCustomer ? '/accounts' : null, { pageSize: 100 });
  const path = mine ? '/transactions/my-activity' : '/transactions';
  const params = mine ? { search: s, status, from, to } : { search: s, type, status, channel, accountId, from, to, minAmount: minDebounced };
  return (
    <>
      <PageHeader title="Transactions" subtitle={isCustomer ? 'Activity across all of your accounts.' : role === 'super_admin' ? 'All transactions system-wide.' : 'Transactions involving your branch.'}
        actions={!isCustomer && <Tabs value={mine ? 'mine' : 'all'} onChange={(v) => setMine(v === 'mine')} tabs={[{ value: 'all', label: 'All' }, { value: 'mine', label: 'Initiated by me' }]} />} />
      <Card flush title={(
        <div className="filters">
          <div className="input-prefix search"><span><Search size={14} /></span><input className="input" placeholder="Reference or description" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search transactions" /></div>
          {!mine && <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">All types</option>{['deposit', 'withdrawal', 'transfer', 'reversal', 'fee', 'interest', 'fd_closure'].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select>}
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{['completed', 'pending_approval', 'rejected', 'reversed', 'cancelled'].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select>
          {!mine && !isCustomer && <select className="select" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel"><option value="">All channels</option>{['branch', 'online', 'ach', 'system'].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select>}
          {isCustomer && accounts.data && <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Account"><option value="">All accounts</option>{accounts.data.map((a) => <option key={a.id} value={a.id}>{acctName(a)}</option>)}</select>}
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          {!mine && <input type="number" min="0" className="input" style={{ width: 130, minWidth: 0 }} placeholder="Min amount" value={minAmount} onChange={(e) => setMin(e.target.value)} aria-label="Minimum amount" />}
        </div>
      )}>
        <DataTable path={path} params={params} initialSort={{ key: 'createdAt', order: 'desc' }} columns={txnColumns({ staff: !isCustomer })} onRowClick={(t) => navigate(`/transactions/${t.id}`)} />
      </Card>
    </>
  );
}

export function TransactionDetail() {
  const { id } = useParams();
  const { user, can, isCustomer } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [reloadKey, setReloadKey] = useState(0);
  const [dialog, setDialog] = useState(null);
  const q = useApi(`/transactions/${id}`, null, { reloadKey });
  const ledger = useApi(!isCustomer ? `/transactions/${id}/ledger-entries` : null, null, { reloadKey });
  const reload = () => setReloadKey((k) => k + 1);
  const [downloading, setDownloading] = useState(false);
  const downloadReceipt = async (t) => {
    setDownloading(true);
    try { await api.download(`/transactions/${t.id}/receipt/download`, null, `receipt-${t.reference}.html`); } catch (e) { toast.error('Download failed', errorText(e)); }
    setDownloading(false);
  };

  return (
    <Async q={q}>{(t) => {
      const pending = t.status === 'pending_approval';
      const initiatedByMe = t.initiatedBy ? t.initiatedBy.id === user.id : isCustomer && t.initiatedByRole === 'customer';
      const canDecide = pending && can('transactions:approve') && !initiatedByMe && t.approval && (user.role === 'super_admin' || t.approval.requiredRole === 'manager');
      const canReverse = t.status === 'completed' && can('transactions:reverse') && ['deposit', 'withdrawal', 'transfer', 'fee'].includes(t.type) && !initiatedByMe;
      const canDispute = isCustomer && t.status === 'completed' && t.sourceAccount && t.sourceAccount.id && ['withdrawal', 'transfer', 'fee'].includes(t.type);
      const canCancel = pending && initiatedByMe;
      return (
        <>
          <PageHeader
            crumbs={[{ label: 'Transactions', to: '/transactions' }, { label: t.reference }]}
            title={<span className="row">{t.description || label(t.type)} <StatusBadge status={t.status} /></span>}
            subtitle={<span className="mono">{t.reference}</span>}
            actions={(
              <>
                {canDecide && <Button variant="success" onClick={() => setDialog('approve')}><Check size={16} />Approve</Button>}
                {canDecide && <Button variant="danger" onClick={() => setDialog('reject')}><X size={16} />Reject</Button>}
                {canCancel && <Button variant="secondary" onClick={() => setDialog('cancel')}><Ban size={15} />Cancel</Button>}
                {canReverse && <Button variant="secondary" onClick={() => setDialog('reverse')}><RotateCcw size={15} />Reverse</Button>}
                {canDispute && <Button variant="secondary" onClick={() => setDialog('dispute')}><FileWarning size={15} />Dispute</Button>}
                <Button variant="secondary" onClick={() => window.print()}><Printer size={15} />Print</Button>
                <Button variant="secondary" loading={downloading} onClick={() => downloadReceipt(t)}><Download size={15} />Receipt</Button>
              </>
            )}
          />
          {pending && t.approval && (
            <div style={{ marginBottom: 16 }}>
              <Alert type="warning">
                Awaiting {t.approval.requiredRole === 'super_admin' ? 'super admin' : 'manager'} approval.{t.sourceAccount ? ' Funds are held on the source account until a decision is made.' : ' Funds are credited only after approval.'}
                {pending && can('transactions:approve') && initiatedByMe && ' You initiated this transaction, so another approver must decide (separation of duties).'}
                {pending && user.role === 'manager' && t.approval.requiredRole === 'super_admin' && ' The amount exceeds your approval authority.'}
              </Alert>
            </div>
          )}
          <div className="grid grid-main">
            <Card title="Transaction details">
              <div style={{ textAlign: 'center', padding: '8px 0 20px' }}>
                <div className="subtle" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label(t.type)}</div>
                <div style={{ fontSize: 32, fontWeight: 700 }}>{money(t.amount)}</div>
                <div className="muted">{fmtDateTime(t.createdAt)}</div>
              </div>
              <dl className="dl">
                <dt>From</dt><dd>{t.sourceAccount ? (t.sourceAccount.id ? <Link to={`/accounts/${t.sourceAccount.id}`}>{acctName(t.sourceAccount)}</Link> : acctName(t.sourceAccount)) : 'Cash / external'}</dd>
                <dt>To</dt><dd>{t.destinationAccount ? (t.destinationAccount.id ? <Link to={`/accounts/${t.destinationAccount.id}`}>{acctName(t.destinationAccount)}</Link> : acctName(t.destinationAccount)) : counterpartyText(t)}</dd>
                {t.beneficiary && <><dt>Beneficiary</dt><dd>{t.beneficiary.name} · {t.beneficiary.bankName} {t.beneficiary.accountNumberMasked}</dd></>}
                <dt>Channel</dt><dd style={{ textTransform: 'capitalize' }}>{t.channel}</dd>
                <dt>Status</dt><dd><StatusBadge status={t.status} /></dd>
                <dt>Completed</dt><dd>{fmtDateTime(t.completedAt)}</dd>
                {t.rejectionReason && <><dt>Rejection reason</dt><dd>{t.rejectionReason}</dd></>}
                {t.reversalOfId && <><dt>Reverses</dt><dd><Link to={`/transactions/${t.reversalOfId}`}>Original transaction</Link></dd></>}
                {t.reversedById && <><dt>Reversed by</dt><dd><Link to={`/transactions/${t.reversedById}`}>Reversal transaction</Link></dd></>}
                {t.sourceBalanceAfter != null && <><dt>Source balance after</dt><dd>{money(t.sourceBalanceAfter)}</dd></>}
                {t.destinationBalanceAfter != null && <><dt>Destination balance after</dt><dd>{money(t.destinationBalanceAfter)}</dd></>}
              </dl>
            </Card>
            <div className="stack">
              <Card title="Processing">
                <dl className="dl">
                  <dt>Initiated by</dt><dd>{t.initiatedBy ? `${t.initiatedBy.name} (${label(t.initiatedBy.role)})` : label(t.initiatedByRole)}</dd>
                  {!isCustomer && <><dt>Branch</dt><dd>{t.branchName}</dd></>}
                  {t.approval && <><dt>Approval</dt><dd><StatusBadge status={t.approval.status} /> {label(t.approval.requiredRole)}</dd></>}
                  {t.approvedBy && <><dt>Approved by</dt><dd>{t.approvedBy.name} · {fmtDateTime(t.approvedAt)}</dd></>}
                  {t.rejectedBy && <><dt>Rejected by</dt><dd>{t.rejectedBy.name}</dd></>}
                  {!isCustomer && t.customerId && <><dt>Customer</dt><dd><Link to={`/customers/${t.customerId}`}>View customer</Link></dd></>}
                </dl>
              </Card>
              {ledger.data && (
                <Card title="Ledger postings" flush>
                  {ledger.data.length ? (
                    <table className="table"><thead><tr><th>Account</th><th>Side</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead>
                      <tbody>{ledger.data.map((e) => <tr key={e.id}><td><Link to={`/accounts/${e.accountId}`}>#{e.accountId}</Link></td><td><StatusBadge status={e.direction} /></td><td className="num">{money(e.amount)}</td><td className="num">{money(e.balanceAfter)}</td></tr>)}</tbody></table>
                  ) : <p className="muted" style={{ padding: 16, margin: 0 }}>No postings yet (pending or rejected).</p>}
                </Card>
              )}
            </div>
          </div>

          {dialog === 'approve' && (
            <ConfirmDialog title="Approve transaction" confirmLabel="Approve" message={`Approve ${label(t.type)} of ${money(t.amount)}? Funds will move immediately.`} onClose={() => setDialog(null)}
              onConfirm={async () => { await api.post(`/transactions/${t.id}/approve`, {}); toast.success('Transaction approved'); reload(); }} />
          )}
          {dialog === 'reject' && (
            <ConfirmDialog title="Reject transaction" danger reason confirmLabel="Reject" message="Held funds will be released back to the account." onClose={() => setDialog(null)}
              onConfirm={async (reason) => { await api.post(`/transactions/${t.id}/reject`, { reason }); toast.success('Transaction rejected'); reload(); }} />
          )}
          {dialog === 'cancel' && (
            <ConfirmDialog title="Cancel transaction" danger confirmLabel="Cancel transaction" message="The pending transaction will be cancelled and held funds released." onClose={() => setDialog(null)}
              onConfirm={async () => { await api.post(`/transactions/${t.id}/cancel`); toast.success('Transaction cancelled'); reload(); }} />
          )}
          {dialog === 'reverse' && (
            <ConfirmDialog title="Reverse transaction" danger reason confirmLabel="Reverse" message={`A compensating reversal of ${money(t.amount)} will be posted. The original record stays unchanged.`} onClose={() => setDialog(null)}
              onConfirm={async (reason) => { const r = await api.post(`/transactions/${t.id}/reverse`, { reason }); toast.success('Reversal posted', r.data.reference); navigate(`/transactions/${r.data.id}`); }} />
          )}
          {dialog === 'dispute' && <DisputeDialog t={t} onClose={() => setDialog(null)} />}
        </>
      );
    }}</Async>
  );
}

function DisputeDialog({ t, onClose }) {
  const toast = useToast();
  const navigate = useNavigate();
  const f = useForm({ reason: 'unauthorized', description: '' });
  const onSubmit = f.submit(async (v) => {
    const r = await api.post('/disputes', { transactionId: t.id, reason: v.reason, description: v.description });
    toast.success('Dispute submitted', r.data.reference);
    navigate(`/disputes/${r.data.id}`);
  });
  return (
    <Modal title="Dispute this transaction" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="dispute" loading={f.busy}>Submit dispute</Button></>}>
      <form id="dispute" className="form" onSubmit={onSubmit}>
        <p className="muted" style={{ margin: 0 }}>{t.reference} · {money(t.amount)} · {fmtDateTime(t.createdAt)}</p>
        <Field label="Reason"><select className="select" value={f.values.reason} onChange={f.set('reason')}>{['unauthorized', 'incorrect_amount', 'duplicate', 'not_received', 'other'].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select></Field>
        <Field label="What happened?" error={f.errors.description}><textarea className="textarea" maxLength={1000} value={f.values.description} onChange={f.set('description')} required /></Field>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

export function ApprovalsList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [status, setStatus] = useState('pending');
  const [requiredRole, setRole] = useState('');
  return (
    <>
      <PageHeader title="Approval queue" subtitle={user.role === 'manager' ? 'Transactions in your branch awaiting a decision. Amounts above your authority require a super admin.' : 'All transactions awaiting approval across branches.'} />
      <Tabs value={status} onChange={setStatus} tabs={[{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: 'cancelled', label: 'Cancelled' }]} />
      <Card flush title={(
        <div className="filters">
          <select className="select" value={requiredRole} onChange={(e) => setRole(e.target.value)} aria-label="Required approver"><option value="">Any approver level</option><option value="manager">Manager</option><option value="super_admin">Super admin</option></select>
        </div>
      )}>
        <DataTable path="/approvals" params={{ status, requiredRole }} initialSort={{ key: 'createdAt', order: 'desc' }} onRowClick={(a) => navigate(`/transactions/${a.transaction.id}`)}
          empty={<div className="empty"><h3>Queue is clear</h3><p className="muted">No {status} approvals.</p></div>}
          columns={[
            { key: 'createdAt', label: 'Requested', sort: 'createdAt', render: (a) => fmtDateTime(a.createdAt) },
            { key: 'txn', label: 'Transaction', render: (a) => <div><b>{a.transaction.description || label(a.transaction.type)}</b><div className="subtle mono">{a.transaction.reference}</div></div> },
            { key: 'reason', label: 'Reason', render: (a) => <span className="muted">{a.reason}</span> },
            { key: 'requestedBy', label: 'Requested by', render: (a) => (a.requestedBy ? a.requestedBy.name : '—') },
            { key: 'branchName', label: 'Branch' },
            { key: 'requiredRole', label: 'Approver', render: (a) => <StatusBadge status={a.requiredRole} tone={a.requiredRole === 'super_admin' ? 'purple' : 'blue'} /> },
            { key: 'status', label: 'Status', render: (a) => <StatusBadge status={a.status} /> },
            { key: 'amount', label: 'Amount', num: true, sort: 'amount', render: (a) => money(a.amount) },
          ]} />
      </Card>
    </>
  );
}
