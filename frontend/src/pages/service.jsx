import { Fragment, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BookOpen, FileText, MessageSquarePlus, Search } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import {
  Alert, Async, Button, Card, ConfirmDialog, DataTable, Field, Modal, PageHeader, StatusBadge, fmtDateTime, money, useApi,
  useDebounced, useForm, useToast, label, daysAgo, today,
} from '../ui';
import { acctName } from './common';

const SR_TYPES = ['cheque_book', 'statement', 'address_change', 'card_replacement', 'general_inquiry', 'limit_increase', 'account_closure'];

export function ServiceRequests() {
  const { isCustomer } = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [status, setStatus] = useState(sp.get('status') || '');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(null);
  const s = useDebounced(search);
  return (
    <>
      <PageHeader title="Service requests" subtitle={isCustomer ? 'Order cheque books and statements, or ask us for help.' : 'Customer requests for your branch.'}
        actions={isCustomer && (
          <>
            <Button variant="secondary" onClick={() => setCreating('cheque')}><BookOpen size={15} />Cheque book</Button>
            <Button variant="secondary" onClick={() => setCreating('statement')}><FileText size={15} />Official statement</Button>
            <Button onClick={() => setCreating('general')}><MessageSquarePlus size={15} />New request</Button>
          </>
        )} />
      <Card flush title={(
        <div className="filters">
          <div className="input-prefix search"><span><Search size={14} /></span><input className="input" placeholder="Reference or subject" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search requests" /></div>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{['open', 'in_progress', 'resolved', 'rejected', 'cancelled'].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select>
          <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">All types</option>{SR_TYPES.map((x) => <option key={x} value={x}>{label(x)}</option>)}</select>
        </div>
      )}>
        <DataTable path="/service-requests" params={{ status, type, search: s }} initialSort={{ key: 'createdAt', order: 'desc' }} onRowClick={(r) => navigate(`/service-requests/${r.id}`)}
          columns={[
            { key: 'reference', label: 'Reference', render: (r) => <span className="mono">{r.reference}</span> },
            { key: 'subject', label: 'Subject', render: (r) => <div><b>{r.subject}</b><div className="subtle" style={{ textTransform: 'capitalize' }}>{label(r.type)}</div></div> },
            ...(!isCustomer ? [{ key: 'customerName', label: 'Customer' }, { key: 'assignedTo', label: 'Assigned to', render: (r) => (r.assignedTo ? r.assignedTo.name : <span className="subtle">Unassigned</span>) }] : []),
            { key: 'status', label: 'Status', sort: 'status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'createdAt', label: 'Created', sort: 'createdAt', render: (r) => fmtDateTime(r.createdAt) },
          ]} />
      </Card>
      {creating && <NewRequestModal kind={creating} onClose={() => setCreating(null)} onCreated={(r) => navigate(`/service-requests/${r.id}`)} />}
    </>
  );
}

function NewRequestModal({ kind, onClose, onCreated }) {
  const toast = useToast();
  const accounts = useApi('/accounts', { pageSize: 100 });
  const f = useForm({ type: 'general_inquiry', subject: '', description: '', accountId: '', leaves: '25', deliveryMethod: kind === 'statement' ? 'email' : 'branch_pickup', fromDate: daysAgo(90), toDate: today() });
  const v = f.values;
  const onSubmit = f.submit(async (x) => {
    let r;
    if (kind === 'cheque') r = await api.post('/service-requests/cheque-book', { accountId: Number(x.accountId), leaves: Number(x.leaves), deliveryMethod: x.deliveryMethod });
    else if (kind === 'statement') r = await api.post('/service-requests/statement', { accountId: Number(x.accountId), fromDate: x.fromDate, toDate: x.toDate, deliveryMethod: x.deliveryMethod });
    else {
      const body = { type: x.type, subject: x.subject, description: x.description };
      if (x.accountId) body.accountId = Number(x.accountId);
      r = await api.post('/service-requests', body);
    }
    toast.success('Request submitted', r.data.reference);
    onCreated(r.data);
  });
  const all = (accounts.data || []).filter((a) => a.status !== 'closed');
  const eligible = kind === 'cheque' ? all.filter((a) => a.type === 'checking' && a.status === 'active') : all;
  const title = kind === 'cheque' ? 'Order a cheque book' : kind === 'statement' ? 'Request an official statement' : 'New service request';
  return (
    <Modal title={title} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="sr" loading={f.busy}>Submit request</Button></>}>
      <form id="sr" className="form" onSubmit={onSubmit}>
        {kind === 'general' && (
          <Field label="Request type"><select className="select" value={v.type} onChange={f.set('type')}>{['general_inquiry', 'address_change', 'card_replacement', 'limit_increase', 'account_closure'].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select></Field>
        )}
        <Field label={kind === 'general' ? 'Related account (optional)' : 'Account'} error={f.errors.accountId}>
          <select className="select" value={v.accountId} onChange={f.set('accountId')} required={kind !== 'general' || v.type === 'account_closure'}>
            <option value="">{kind === 'general' ? 'None' : 'Choose an account…'}</option>
            {eligible.map((a) => <option key={a.id} value={a.id}>{acctName(a)}</option>)}
          </select>
        </Field>
        {kind === 'cheque' && (
          <div className="form-grid">
            <Field label="Leaves"><select className="select" value={v.leaves} onChange={f.set('leaves')}><option value="25">25 cheques</option><option value="50">50 cheques</option></select></Field>
            <Field label="Delivery"><select className="select" value={v.deliveryMethod} onChange={f.set('deliveryMethod')}><option value="branch_pickup">Pick up at branch</option><option value="mail">Mail to my address</option></select></Field>
          </div>
        )}
        {kind === 'statement' && (
          <div className="form-grid">
            <Field label="From" error={f.errors.fromDate}><input type="date" className="input" value={v.fromDate} onChange={f.set('fromDate')} required /></Field>
            <Field label="To" error={f.errors.toDate}><input type="date" className="input" value={v.toDate} onChange={f.set('toDate')} required /></Field>
            <Field label="Delivery" className="full"><select className="select" value={v.deliveryMethod} onChange={f.set('deliveryMethod')}><option value="email">Email</option><option value="mail">Postal mail</option></select></Field>
          </div>
        )}
        {kind === 'general' && (
          <>
            <Field label="Subject" error={f.errors.subject}><input className="input" maxLength={120} value={v.subject} onChange={f.set('subject')} required /></Field>
            <Field label="Details" error={f.errors.description}><textarea className="textarea" maxLength={1000} value={v.description} onChange={f.set('description')} required /></Field>
          </>
        )}
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

export function ServiceRequestDetail() {
  const { id } = useParams();
  const { user, can, isCustomer } = useAuth();
  const toast = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [dialog, setDialog] = useState(null);
  const q = useApi(`/service-requests/${id}`, null, { reloadKey });
  const reload = () => setReloadKey((k) => k + 1);
  const act = async (fn, msg) => { try { await fn(); toast.success(msg); reload(); } catch (e) { toast.error('Action failed', e.message); } };
  return (
    <Async q={q}>{(r) => {
      const openish = ['open', 'in_progress'].includes(r.status);
      const manage = can('service_requests:manage') && openish;
      return (
        <>
          <PageHeader crumbs={[{ label: 'Service requests', to: '/service-requests' }, { label: r.reference }]} title={<span className="row">{r.subject} <StatusBadge status={r.status} /></span>} subtitle={<span className="mono">{r.reference}</span>}
            actions={(
              <>
                {manage && (!r.assignedTo || r.assignedTo.id !== user.id) && <Button variant="secondary" onClick={() => act(() => api.post(`/service-requests/${r.id}/assign`, { assigneeId: user.id }), 'Assigned to you')}>Assign to me</Button>}
                {manage && r.status === 'open' && <Button variant="secondary" onClick={() => act(() => api.patch(`/service-requests/${r.id}`, { status: 'in_progress' }), 'Marked in progress')}>Start work</Button>}
                {manage && <Button variant="success" onClick={() => setDialog('resolved')}>Resolve</Button>}
                {manage && <Button variant="danger" onClick={() => setDialog('rejected')}>Reject</Button>}
                {isCustomer && r.status === 'open' && <Button variant="secondary" onClick={() => setDialog('cancel')}>Cancel request</Button>}
              </>
            )} />
          <div className="grid grid-main">
            <Card title="Request">
              <dl className="dl">
                <dt>Type</dt><dd style={{ textTransform: 'capitalize' }}>{label(r.type)}</dd>
                <dt>Description</dt><dd>{r.description || '—'}</dd>
                {Object.entries(r.details || {}).map(([k, v]) => <Fragment key={k}><dt style={{ textTransform: 'capitalize' }}>{label(k.replace(/([A-Z])/g, '_$1').toLowerCase())}</dt><dd>{typeof v === 'number' && k.toLowerCase().includes('limit') ? money(v) : label(String(v))}</dd></Fragment>)}
                <dt>Account</dt><dd>{r.account ? <Link to={`/accounts/${r.account.id}`}>{acctName(r.account)}</Link> : '—'}</dd>
                <dt>Resolution</dt><dd>{r.resolutionNote || '—'}</dd>
              </dl>
            </Card>
            <Card title="Tracking">
              <dl className="dl">
                <dt>Status</dt><dd><StatusBadge status={r.status} /></dd>
                <dt>Created</dt><dd>{fmtDateTime(r.createdAt)}</dd>
                <dt>Last update</dt><dd>{fmtDateTime(r.updatedAt)}</dd>
                {!isCustomer && <><dt>Customer</dt><dd><Link to={`/customers/${r.customerId}`}>{r.customerName}</Link></dd><dt>Branch</dt><dd>{r.branchName}</dd><dt>Assigned to</dt><dd>{r.assignedTo ? r.assignedTo.name : 'Unassigned'}</dd></>}
              </dl>
            </Card>
          </div>
          {(dialog === 'resolved' || dialog === 'rejected') && (
            <ConfirmDialog title={dialog === 'resolved' ? 'Resolve request' : 'Reject request'} danger={dialog === 'rejected'} reason reasonLabel="Resolution note" confirmLabel={dialog === 'resolved' ? 'Resolve' : 'Reject'} onClose={() => setDialog(null)}
              message="The customer will be notified." onConfirm={async (note) => { await api.patch(`/service-requests/${r.id}`, { status: dialog, resolutionNote: note }); toast.success(`Request ${dialog}`); reload(); }} />
          )}
          {dialog === 'cancel' && <ConfirmDialog title="Cancel request" danger confirmLabel="Cancel request" message="This request will be withdrawn." onClose={() => setDialog(null)} onConfirm={async () => { await api.post(`/service-requests/${r.id}/cancel`); toast.success('Request cancelled'); reload(); }} />}
        </>
      );
    }}</Async>
  );
}

export function Disputes() {
  const { isCustomer } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const s = useDebounced(search);
  return (
    <>
      <PageHeader title="Disputes" subtitle={isCustomer ? 'Track disputes you have raised. To dispute a payment, open it from your transactions.' : 'Customer disputes for your branch.'}
        actions={isCustomer && <Button variant="secondary" onClick={() => navigate('/transactions')}>Find a transaction to dispute</Button>} />
      <Card flush title={(
        <div className="filters">
          <div className="input-prefix search"><span><Search size={14} /></span><input className="input" placeholder="Reference or description" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search disputes" /></div>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{['open', 'under_review', 'resolved_refunded', 'rejected', 'withdrawn'].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select>
        </div>
      )}>
        <DataTable path="/disputes" params={{ status, search: s }} initialSort={{ key: 'createdAt', order: 'desc' }} onRowClick={(d) => navigate(`/disputes/${d.id}`)}
          columns={[
            { key: 'reference', label: 'Reference', render: (d) => <span className="mono">{d.reference}</span> },
            { key: 'txn', label: 'Transaction', render: (d) => (d.transaction ? <div><b>{d.transaction.description}</b><div className="subtle mono">{d.transaction.reference}</div></div> : '—') },
            ...(!isCustomer ? [{ key: 'customerName', label: 'Customer' }] : []),
            { key: 'reason', label: 'Reason', render: (d) => <span style={{ textTransform: 'capitalize' }}>{label(d.reason)}</span> },
            { key: 'status', label: 'Status', sort: 'status', render: (d) => <StatusBadge status={d.status} /> },
            { key: 'amount', label: 'Amount', num: true, render: (d) => (d.transaction ? money(d.transaction.amount) : '—') },
            { key: 'createdAt', label: 'Raised', sort: 'createdAt', render: (d) => fmtDateTime(d.createdAt) },
          ]} />
      </Card>
    </>
  );
}

export function DisputeDetail() {
  const { id } = useParams();
  const { can, isCustomer } = useAuth();
  const toast = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [dialog, setDialog] = useState(null);
  const q = useApi(`/disputes/${id}`, null, { reloadKey });
  const reload = () => setReloadKey((k) => k + 1);
  return (
    <Async q={q}>{(d) => {
      const openish = ['open', 'under_review'].includes(d.status);
      return (
        <>
          <PageHeader crumbs={[{ label: 'Disputes', to: '/disputes' }, { label: d.reference }]} title={<span className="row">Dispute {d.reference} <StatusBadge status={d.status} /></span>}
            actions={(
              <>
                {can('disputes:manage') && d.status === 'open' && <Button variant="secondary" onClick={async () => { try { await api.post(`/disputes/${d.id}/review`); toast.success('Investigation started'); reload(); } catch (e) { toast.error('Action failed', e.message); } }}>Start review</Button>}
                {can('disputes:manage') && openish && <Button variant="success" onClick={() => setDialog('refund')}>Refund customer</Button>}
                {can('disputes:manage') && openish && <Button variant="danger" onClick={() => setDialog('reject')}>Reject dispute</Button>}
                {isCustomer && openish && <Button variant="secondary" onClick={() => setDialog('withdraw')}>Withdraw dispute</Button>}
              </>
            )} />
          <div className="grid grid-2">
            <Card title="Dispute">
              <dl className="dl">
                <dt>Reason</dt><dd style={{ textTransform: 'capitalize' }}>{label(d.reason)}</dd>
                <dt>Description</dt><dd>{d.description}</dd>
                <dt>Raised</dt><dd>{fmtDateTime(d.createdAt)}</dd>
                {!isCustomer && <><dt>Customer</dt><dd><Link to={`/customers/${d.customerId}`}>{d.customerName}</Link></dd></>}
                <dt>Resolution</dt><dd>{d.resolution || '—'}</dd>
                {d.resolvedBy && <><dt>Resolved by</dt><dd>{d.resolvedBy.name} · {fmtDateTime(d.resolvedAt)}</dd></>}
                {d.refundTransactionId && <><dt>Refund</dt><dd><Link to={`/transactions/${d.refundTransactionId}`}>View refund transaction</Link></dd></>}
              </dl>
            </Card>
            <Card title="Disputed transaction">
              {d.transaction ? (
                <dl className="dl">
                  <dt>Reference</dt><dd><Link to={`/transactions/${d.transaction.id}`} className="mono">{d.transaction.reference}</Link></dd>
                  <dt>Description</dt><dd>{d.transaction.description}</dd>
                  <dt>Amount</dt><dd>{money(d.transaction.amount)}</dd>
                  <dt>Status</dt><dd><StatusBadge status={d.transaction.status} /></dd>
                  <dt>Date</dt><dd>{fmtDateTime(d.transaction.createdAt)}</dd>
                </dl>
              ) : '—'}
            </Card>
          </div>
          {(dialog === 'refund' || dialog === 'reject') && (
            <ConfirmDialog title={dialog === 'refund' ? 'Refund via reversal' : 'Reject dispute'} danger={dialog === 'reject'} reason reasonLabel="Resolution (sent to the customer)" confirmLabel={dialog === 'refund' ? 'Refund' : 'Reject'} onClose={() => setDialog(null)}
              message={dialog === 'refund' ? 'A compensating reversal will return the funds to the customer.' : 'The customer will be told the transaction was verified as authorized.'}
              onConfirm={async (resolution) => { await api.post(`/disputes/${d.id}/resolve`, { outcome: dialog, resolution }); toast.success(dialog === 'refund' ? 'Customer refunded' : 'Dispute rejected'); reload(); }} />
          )}
          {dialog === 'withdraw' && <ConfirmDialog title="Withdraw dispute" danger confirmLabel="Withdraw" message="We will stop investigating this transaction." onClose={() => setDialog(null)} onConfirm={async () => { await api.post(`/disputes/${d.id}/withdraw`); toast.success('Dispute withdrawn'); reload(); }} />}
        </>
      );
    }}</Async>
  );
}
