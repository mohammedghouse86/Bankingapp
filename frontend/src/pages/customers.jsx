import { Fragment, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { KeyRound, Pencil, Plus, Search, ShieldCheck, Trash2, UserCheck, UserX, Wallet } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import {
  Alert, Async, Button, Card, ConfirmDialog, DataTable, Field, Modal, PageHeader, StatusBadge, Tabs, fmtDate, fmtDateTime,
  money, useApi, useDebounced, useForm, useStepUp, useToast, label, initials,
} from '../ui';
import { txnColumns } from './common';
import { OpenAccountModal } from './accounts';

const ADDRESS0 = { line1: '', city: '', state: '', postalCode: '', country: 'US' };

export function CustomersList() {
  const { can, role } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [kycStatus, setKyc] = useState('');
  const [branchId, setBranch] = useState('');
  const [creating, setCreating] = useState(false);
  const branches = useApi(role === 'super_admin' ? '/branches' : null, { pageSize: 50 });
  const s = useDebounced(search);
  return (
    <>
      <PageHeader title="Customers" subtitle={role === 'super_admin' ? 'All customers across every branch.' : 'Customers of your branch.'}
        actions={can('customers:create') && <Button onClick={() => setCreating(true)}><Plus size={16} />New customer</Button>} />
      <Card flush title={(
        <div className="filters">
          <div className="input-prefix search"><span><Search size={14} /></span><input className="input" placeholder="Name, email, phone or customer #" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" /></div>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{['active', 'pending_verification', 'suspended', 'closed'].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select>
          <select className="select" value={kycStatus} onChange={(e) => setKyc(e.target.value)} aria-label="KYC status"><option value="">Any KYC</option>{['verified', 'pending_review', 'unverified', 'rejected'].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select>
          {branches.data && <select className="select" value={branchId} onChange={(e) => setBranch(e.target.value)} aria-label="Branch"><option value="">All branches</option>{branches.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        </div>
      )}>
        <DataTable
          path="/customers"
          params={{ search: s, status, kycStatus, branchId }}
          initialSort={{ key: 'name', order: 'asc' }}
          onRowClick={(c) => navigate(`/customers/${c.id}`)}
          columns={[
            { key: 'name', label: 'Customer', sort: 'name', render: (c) => <div className="row" style={{ flexWrap: 'nowrap' }}><span className="avatar">{initials(c.firstName, c.lastName)}</span><div><div style={{ fontWeight: 600 }}>{c.fullName}</div><div className="subtle">{c.email}</div></div></div> },
            { key: 'customerNumber', label: 'Customer #', sort: 'customerNumber', render: (c) => <span className="mono">{c.customerNumber}</span> },
            { key: 'branchName', label: 'Branch' },
            { key: 'accountCount', label: 'Accounts', num: true },
            { key: 'kycStatus', label: 'KYC', render: (c) => <StatusBadge status={c.kycStatus} /> },
            { key: 'status', label: 'Status', sort: 'status', render: (c) => <StatusBadge status={c.status} /> },
            { key: 'createdAt', label: 'Since', sort: 'createdAt', render: (c) => fmtDate(c.createdAt) },
          ]}
        />
      </Card>
      {creating && <NewCustomerModal onClose={() => setCreating(false)} onCreated={(c) => navigate(`/customers/${c.id}`)} branches={branches.data} />}
    </>
  );
}

function AddressFields({ value, onChange, errors = {}, prefix = 'address' }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <Field label="Street address" className="full" error={errors[`${prefix}.line1`]}><input className="input" value={value.line1} onChange={set('line1')} required /></Field>
      <Field label="City" error={errors[`${prefix}.city`]}><input className="input" value={value.city} onChange={set('city')} required /></Field>
      <Field label="State" error={errors[`${prefix}.state`]}><input className="input" value={value.state} onChange={set('state')} required /></Field>
      <Field label="Postal code" error={errors[`${prefix}.postalCode`]}><input className="input" value={value.postalCode} onChange={set('postalCode')} required /></Field>
    </>
  );
}

function NewCustomerModal({ onClose, onCreated, branches }) {
  const toast = useToast();
  const { role } = useAuth();
  const f = useForm({ firstName: '', lastName: '', email: '', phone: '', dateOfBirth: '', nationalId: '', occupation: '', annualIncome: '', branchId: '', address: ADDRESS0 });
  const v = f.values;
  const onSubmit = f.submit(async (x) => {
    const body = { firstName: x.firstName, lastName: x.lastName, email: x.email, phone: x.phone, dateOfBirth: x.dateOfBirth, nationalId: x.nationalId, address: x.address };
    if (x.occupation) body.occupation = x.occupation;
    if (x.annualIncome) body.annualIncome = Number(x.annualIncome);
    if (role === 'super_admin') body.branchId = Number(x.branchId);
    const r = await api.post('/customers', body);
    toast.success('Customer created', `${r.data.fullName} (${r.data.customerNumber}) is pending identity verification.`);
    onCreated(r.data);
  });
  return (
    <Modal title="Onboard new customer" onClose={onClose} wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="new-customer" loading={f.busy}>Create customer</Button></>}>
      <form id="new-customer" className="form" onSubmit={onSubmit}>
        <div className="form-grid">
          <Field label="First name" error={f.errors.firstName}><input className="input" value={v.firstName} onChange={f.set('firstName')} required /></Field>
          <Field label="Last name" error={f.errors.lastName}><input className="input" value={v.lastName} onChange={f.set('lastName')} required /></Field>
          <Field label="Email" error={f.errors.email}><input type="email" className="input" value={v.email} onChange={f.set('email')} required /></Field>
          <Field label="Phone" error={f.errors.phone}><input className="input" placeholder="+1-555-0100" value={v.phone} onChange={f.set('phone')} required /></Field>
          <Field label="Date of birth" error={f.errors.dateOfBirth}><input type="date" className="input" value={v.dateOfBirth} onChange={f.set('dateOfBirth')} required /></Field>
          <Field label="National ID (simulated)" error={f.errors.nationalId} hint="Format SIM-123-45-6789"><input className="input" value={v.nationalId} onChange={f.set('nationalId')} required /></Field>
          <Field label="Occupation" error={f.errors.occupation}><input className="input" value={v.occupation} onChange={f.set('occupation')} /></Field>
          <Field label="Annual income (USD)" error={f.errors.annualIncome}><input type="number" min="0" className="input" value={v.annualIncome} onChange={f.set('annualIncome')} /></Field>
          {role === 'super_admin' && (
            <Field label="Branch" className="full" error={f.errors.branchId}>
              <select className="select" value={v.branchId} onChange={f.set('branchId')} required><option value="">Select…</option>{(branches || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </Field>
          )}
          <AddressFields value={v.address} onChange={f.set('address')} errors={f.errors} />
        </div>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

export function CustomerDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const stepUp = useStepUp();
  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState(null);
  const q = useApi(`/customers/${id}`);
  const summary = useApi(`/customers/${id}/summary`);
  const reload = () => { q.reload(); summary.reload(); };

  return (
    <Async q={q}>{(c) => (
      <>
        <PageHeader
          crumbs={[{ label: 'Customers', to: '/customers' }, { label: c.fullName }]}
          title={<span className="row">{c.fullName} <StatusBadge status={c.status} /> <StatusBadge status={c.kycStatus} /></span>}
          subtitle={`${c.customerNumber} · ${c.branchName} branch · customer since ${fmtDate(c.createdAt)}`}
          actions={(
            <>
              {can('accounts:open') && c.status === 'active' && c.kycStatus === 'verified' && <Button onClick={() => setDialog('open')}><Wallet size={16} />Open account</Button>}
              {can('customers:update') && c.status !== 'closed' && <Button variant="secondary" onClick={() => setDialog('edit')}><Pencil size={15} />Edit profile</Button>}
              {can('customers:update') && c.status !== 'closed' && <Button variant="secondary" onClick={() => setDialog('contact')}>Change contact</Button>}
              {can('customers:kyc_submit') && ['unverified', 'rejected'].includes(c.kycStatus) && c.status !== 'closed' && <Button variant="secondary" onClick={() => setDialog('kyc')}><ShieldCheck size={15} />Verify identity</Button>}
              {can('customers:kyc_decide') && c.kycStatus === 'pending_review' && <Button variant="success" onClick={() => setDialog('kycDecision')}>Review KYC</Button>}
              {can('customers:status') && c.status === 'active' && <Button variant="danger" onClick={() => setDialog('suspend')}><UserX size={15} />Suspend</Button>}
              {can('customers:status') && c.status === 'suspended' && <Button variant="success" onClick={() => setDialog('activate')}><UserCheck size={15} />Reactivate</Button>}
              {can('customers:portal_access') && !['closed', 'suspended'].includes(c.status) && <Button variant="secondary" onClick={() => setDialog('portal')}><KeyRound size={15} />{c.portalAccess ? 'Reset online access' : 'Enable online banking'}</Button>}
              {can('customers:portal_access') && c.portalAccess && <Button variant="ghost" onClick={() => setDialog('revoke')}>Revoke online access</Button>}
              {can('customers:delete') && c.status !== 'closed' && <Button variant="ghost" onClick={() => setDialog('erase')}><Trash2 size={15} />Erase</Button>}
            </>
          )}
        />
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'accounts', label: 'Accounts' }, { value: 'transactions', label: 'Transactions' }, { value: 'beneficiaries', label: 'Beneficiaries' }, { value: 'notes', label: 'Notes' }]} />
        {tab === 'overview' && (
          <div className="grid grid-main">
            <Card title="Profile">
              <dl className="dl">
                <dt>Email</dt><dd>{c.email}</dd>
                <dt>Phone</dt><dd>{c.phone}</dd>
                <dt>Date of birth</dt><dd>{fmtDate(c.dateOfBirth)}</dd>
                <dt>National ID</dt><dd className="mono">{c.nationalIdMasked}</dd>
                <dt>Address</dt><dd>{c.address.line1}, {c.address.city}, {c.address.state} {c.address.postalCode}</dd>
                <dt>Occupation</dt><dd>{c.occupation || '—'}</dd>
                <dt>Annual income</dt><dd>{c.annualIncome != null ? money(c.annualIncome) : '—'}</dd>
                <dt>Risk rating</dt><dd><StatusBadge status={c.riskRating} /></dd>
                <dt>Online banking</dt><dd>{c.portalAccess ? <StatusBadge status="active" /> : <StatusBadge status="disabled" />}</dd>
                <dt>Onboarded by</dt><dd>{c.createdBy ? c.createdBy.name : 'Self-registration'}</dd>
              </dl>
            </Card>
            <div className="stack">
              <Card title="Relationship summary">
                <Async q={summary}>{(sm) => (
                  <dl className="dl">
                    <dt>Total balance</dt><dd>{money(sm.totalBalance)}</dd>
                    <dt>Accounts</dt><dd>{Object.entries(sm.accountsByStatus).map(([k, n]) => `${n} ${label(k)}`).join(', ') || 'None'}</dd>
                    <dt>Transactions</dt><dd>{sm.transactionCount} ({sm.pendingTransactions} pending)</dd>
                    <dt>Last activity</dt><dd>{fmtDateTime(sm.lastTransactionAt)}</dd>
                    <dt>Beneficiaries</dt><dd>{sm.beneficiaries}</dd>
                    <dt>Open requests</dt><dd>{sm.openServiceRequests}</dd>
                    <dt>Open disputes</dt><dd>{sm.openDisputes}</dd>
                  </dl>
                )}</Async>
              </Card>
              <Card title="Identity verification">
                {c.kyc ? (
                  <dl className="dl">
                    <dt>Document</dt><dd>{label(c.kyc.documentType)} <span className="mono">{c.kyc.documentNumberMasked}</span></dd>
                    <dt>Score</dt><dd>{c.kyc.score ?? '—'}</dd>
                    <dt>Submitted</dt><dd>{fmtDateTime(c.kyc.submittedAt)}</dd>
                    <dt>Verified</dt><dd>{c.kyc.verifiedAt ? `${fmtDate(c.kyc.verifiedAt)}${c.kyc.verifiedBy ? ` by ${c.kyc.verifiedBy.name}` : ''}` : '—'}</dd>
                    {c.kyc.decisionNote && <><dt>Note</dt><dd>{c.kyc.decisionNote}</dd></>}
                  </dl>
                ) : <p className="muted" style={{ margin: 0 }}>No identity documents on file.</p>}
              </Card>
            </div>
          </div>
        )}
        {tab === 'accounts' && <CustomerAccounts id={id} />}
        {tab === 'transactions' && <Card flush><DataTable path={`/customers/${id}/transactions`} columns={txnColumns()} onRowClick={(t) => navigate(`/transactions/${t.id}`)} initialSort={{ key: 'createdAt', order: 'desc' }} /></Card>}
        {tab === 'beneficiaries' && <CustomerBeneficiaries id={id} />}
        {tab === 'notes' && <CustomerNotes id={id} canWrite={can('notes:write')} />}

        {dialog === 'open' && <OpenAccountModal customer={c} onClose={() => setDialog(null)} onDone={(a) => navigate(`/accounts/${a.id}`)} />}
        {dialog === 'edit' && <EditCustomerModal c={c} onClose={() => setDialog(null)} onSaved={reload} />}
        {dialog === 'contact' && <ContactModal c={c} onClose={() => setDialog(null)} onSaved={reload} />}
        {dialog === 'kyc' && <KycModal c={c} onClose={() => setDialog(null)} onDone={reload} />}
        {dialog === 'kycDecision' && <KycDecisionModal c={c} onClose={() => setDialog(null)} onDone={reload} />}
        {(dialog === 'suspend' || dialog === 'activate') && (
          <ConfirmDialog title={dialog === 'suspend' ? 'Suspend customer' : 'Reactivate customer'} danger={dialog === 'suspend'} reason
            message={dialog === 'suspend' ? 'Online banking will be disabled and all sessions signed out. Accounts are not closed.' : 'The customer will regain online banking access.'}
            confirmLabel={dialog === 'suspend' ? 'Suspend' : 'Reactivate'} onClose={() => setDialog(null)}
            onConfirm={async (reason) => { await api.put(`/customers/${c.id}/status`, { status: dialog === 'suspend' ? 'suspended' : 'active', reason }); toast.success('Customer status updated'); reload(); }} />
        )}
        {dialog === 'portal' && <PortalAccessDialog c={c} onClose={() => setDialog(null)} onDone={reload} />}
        {dialog === 'revoke' && (
          <ConfirmDialog title="Revoke online banking" danger message="The customer will be signed out and unable to log in until access is granted again." confirmLabel="Revoke access" onClose={() => setDialog(null)}
            onConfirm={async () => { await api.del(`/customers/${c.id}/portal-access`); toast.success('Online access revoked'); reload(); }} />
        )}
        {dialog === 'erase' && (
          <ConfirmDialog title="Erase customer data" danger confirmLabel="Erase permanently" onClose={() => setDialog(null)}
            message="Personal data is anonymised permanently. All accounts must already be closed. You will be asked to confirm your password."
            onConfirm={async () => { await stepUp((h) => api.del(`/customers/${c.id}`, { headers: h })); toast.success('Customer data erased'); reload(); }} />
        )}
      </>
    )}</Async>
  );
}

function CustomerAccounts({ id }) {
  const navigate = useNavigate();
  const q = useApi(`/customers/${id}/accounts`);
  return (
    <Card flush>
      <Async q={q}>{(list) => (list.length ? (
        <div className="table-wrap"><table className="table"><thead><tr><th>Account</th><th>Type</th><th>Holders</th><th>Status</th><th className="num">Ledger</th><th className="num">Available</th></tr></thead>
          <tbody>{list.map((a) => (
            <tr key={a.id} className="clickable" onClick={() => navigate(`/accounts/${a.id}`)}>
              <td><span className="mono">{a.accountNumber}</span>{a.nickname && <div className="subtle">{a.nickname}</div>}</td>
              <td style={{ textTransform: 'capitalize' }}>{label(a.type)}</td>
              <td>{a.holders.map((h) => `${h.name}${h.holderType === 'joint' ? ' (joint)' : ''}`).join(', ')}</td>
              <td><StatusBadge status={a.status} /></td>
              <td className="num">{money(a.ledgerBalance)}</td><td className="num">{money(a.availableBalance)}</td>
            </tr>
          ))}</tbody></table></div>
      ) : <div className="empty"><h3>No accounts</h3><p className="muted">Open an account once identity is verified.</p></div>)}</Async>
    </Card>
  );
}

function CustomerBeneficiaries({ id }) {
  const q = useApi(`/customers/${id}/beneficiaries`);
  return (
    <Card flush>
      <Async q={q}>{(list) => (list.length ? (
        <div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>Bank</th><th>Account</th><th>Status</th><th className="num">Daily limit</th></tr></thead>
          <tbody>{list.map((b) => (
            <tr key={b.id}><td><b>{b.name}</b>{b.nickname && <div className="subtle">{b.nickname}</div>}</td><td>{b.bankName}</td><td className="mono">{b.accountNumber}</td><td><StatusBadge status={b.status} /></td><td className="num">{money(b.dailyLimit)}</td></tr>
          ))}</tbody></table></div>
      ) : <div className="empty"><h3>No beneficiaries</h3><p className="muted">Customers register payees in online banking.</p></div>)}</Async>
    </Card>
  );
}

function CustomerNotes({ id, canWrite }) {
  const toast = useToast();
  const q = useApi(`/customers/${id}/notes`);
  const f = useForm({ body: '' });
  const onSubmit = f.submit(async (v) => { await api.post(`/customers/${id}/notes`, { body: v.body }); f.setValues({ body: '' }); toast.success('Note added'); q.reload(); });
  return (
    <div className="grid grid-main">
      <Card title="Internal notes" subtitle="Visible to branch staff only">
        <Async q={q}>{(notes) => (notes.length ? (
          <ul className="timeline">{notes.map((n) => <li key={n.id}><span className="avatar">{n.author ? n.author.name.split(' ').map((x) => x[0]).join('') : '?'}</span><div><div>{n.body}</div><div className="subtle">{n.author ? n.author.name : 'Unknown'} · {fmtDateTime(n.createdAt)}</div></div></li>)}</ul>
        ) : <p className="muted" style={{ margin: 0 }}>No notes yet.</p>)}</Async>
      </Card>
      {canWrite && (
        <Card title="Add note">
          <form className="form" onSubmit={onSubmit}>
            <Field label="Note" error={f.errors.body}><textarea className="textarea" maxLength={1000} value={f.values.body} onChange={f.set('body')} required /></Field>
            <Alert>{f.formError}</Alert>
            <Button type="submit" loading={f.busy}>Save note</Button>
          </form>
        </Card>
      )}
    </div>
  );
}

function EditCustomerModal({ c, onClose, onSaved }) {
  const toast = useToast();
  const f = useForm({ firstName: c.firstName, lastName: c.lastName, occupation: c.occupation || '', annualIncome: c.annualIncome ?? '', address: { ...c.address } });
  const onSubmit = f.submit(async (v) => {
    const body = { firstName: v.firstName, lastName: v.lastName, address: v.address };
    if (v.occupation) body.occupation = v.occupation;
    if (v.annualIncome !== '') body.annualIncome = Number(v.annualIncome);
    await api.patch(`/customers/${c.id}`, body);
    toast.success('Profile updated', 'The customer has been notified of the change.');
    onSaved();
    onClose();
  });
  return (
    <Modal title="Edit customer profile" onClose={onClose} wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="edit-customer" loading={f.busy}>Save changes</Button></>}>
      <form id="edit-customer" className="form" onSubmit={onSubmit}>
        <Alert type="warning">Profile changes are a sensitive operation and are recorded in the audit log.</Alert>
        <div className="form-grid">
          <Field label="First name" error={f.errors.firstName}><input className="input" value={f.values.firstName} onChange={f.set('firstName')} required /></Field>
          <Field label="Last name" error={f.errors.lastName}><input className="input" value={f.values.lastName} onChange={f.set('lastName')} required /></Field>
          <Field label="Occupation" error={f.errors.occupation}><input className="input" value={f.values.occupation} onChange={f.set('occupation')} /></Field>
          <Field label="Annual income (USD)" error={f.errors.annualIncome}><input type="number" min="0" className="input" value={f.values.annualIncome} onChange={f.set('annualIncome')} /></Field>
          <AddressFields value={f.values.address} onChange={f.set('address')} errors={f.errors} />
        </div>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

export function ContactModal({ c, onClose, onSaved, self }) {
  const toast = useToast();
  const stepUp = useStepUp();
  const f = useForm({ email: c.email, phone: c.phone });
  const onSubmit = f.submit(async (v) => {
    const body = {};
    if (v.email !== c.email) body.email = v.email;
    if (v.phone !== c.phone) body.phone = v.phone;
    if (!Object.keys(body).length) throw new Error('No changes to save');
    await stepUp((h) => api.put(self ? '/me/contact' : `/customers/${c.id}/contact`, body, { headers: h }));
    toast.success('Contact details updated', 'An alert was sent to the previous email address.');
    onSaved();
    onClose();
  });
  return (
    <Modal title="Change contact details" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="contact-form" loading={f.busy}>Save</Button></>}>
      <form id="contact-form" className="form" onSubmit={onSubmit}>
        <Alert type="warning">Changing the email changes the online banking login. This critical action requires password confirmation.</Alert>
        <Field label="Email" error={f.errors.email}><input type="email" className="input" value={f.values.email} onChange={f.set('email')} required /></Field>
        <Field label="Phone" error={f.errors.phone}><input className="input" value={f.values.phone} onChange={f.set('phone')} required /></Field>
        <Alert>{f.formError}</Alert>
      </form>
    </Modal>
  );
}

function KycModal({ c, onClose, onDone }) {
  const toast = useToast();
  const [result, setResult] = useState(null);
  const f = useForm({ documentType: 'passport', documentNumber: '', issuingCountry: 'US', expiryDate: '', dateOfBirth: c.dateOfBirth });
  const onSubmit = f.submit(async (v) => {
    const r = await api.post(`/customers/${c.id}/identity-verification`, v);
    setResult(r.data);
    if (r.data.passed) toast.success('Checks passed', 'Sent to a manager for review.'); else toast.error('Verification failed', 'One or more document checks failed.');
    onDone();
  });
  const prefix = { passport: 'P', drivers_license: 'D', national_id: 'N' }[f.values.documentType];
  return (
    <Modal title="Identity verification (simulated)" onClose={onClose} footer={result ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="kyc-form" loading={f.busy}>Run checks</Button></>}>
      {result ? (
        <div className="stack">
          <Alert type={result.passed ? 'success' : 'error'}>{result.passed ? `All checks passed (score ${result.score}). Status: pending review.` : `Verification failed (score ${result.score}).`}</Alert>
          <dl className="dl">{Object.entries(result.checks).map(([k, ok]) => <Fragment key={k}><dt>{label(k.replace(/([A-Z])/g, '_$1').toLowerCase())}</dt><dd><StatusBadge status={ok ? 'success' : 'failed'} /></dd></Fragment>)}</dl>
        </div>
      ) : (
        <form id="kyc-form" className="form" onSubmit={onSubmit}>
          <div className="form-grid">
            <Field label="Document type"><select className="select" value={f.values.documentType} onChange={f.set('documentType')}><option value="passport">Passport</option><option value="drivers_license">Driver&apos;s license</option><option value="national_id">National ID</option></select></Field>
            <Field label="Document number" error={f.errors.documentNumber} hint={`Format ${prefix}1234567 · ending 0000 simulates a watchlist hit`}><input className="input mono" value={f.values.documentNumber} onChange={f.set('documentNumber')} required /></Field>
            <Field label="Issuing country" error={f.errors.issuingCountry}><input className="input" maxLength={2} value={f.values.issuingCountry} onChange={f.set('issuingCountry')} required /></Field>
            <Field label="Expiry date" error={f.errors.expiryDate}><input type="date" className="input" value={f.values.expiryDate} onChange={f.set('expiryDate')} required /></Field>
            <Field label="Date of birth on document" error={f.errors.dateOfBirth} className="full"><input type="date" className="input" value={f.values.dateOfBirth} onChange={f.set('dateOfBirth')} required /></Field>
          </div>
          <Alert>{f.formError}</Alert>
        </form>
      )}
    </Modal>
  );
}

function KycDecisionModal({ c, onClose, onDone }) {
  const toast = useToast();
  const f = useForm({ note: '' });
  const decide = (decision) => f.submit(async (v) => {
    await api.post(`/customers/${c.id}/kyc-decision`, { decision, note: v.note || (decision === 'approve' ? 'Documents verified' : 'Documents rejected') });
    toast.success(decision === 'approve' ? 'Identity verified' : 'Verification rejected');
    onDone();
    onClose();
  })();
  return (
    <Modal title="Review identity verification" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={f.busy} onClick={() => decide('reject')}>Reject</Button><Button variant="success" loading={f.busy} onClick={() => decide('approve')}>Approve</Button></>}>
      <div className="form">
        <dl className="dl">
          <dt>Document</dt><dd>{label(c.kyc.documentType)} {c.kyc.documentNumberMasked}</dd>
          <dt>Automated score</dt><dd>{c.kyc.score}</dd>
          <dt>Submitted</dt><dd>{fmtDateTime(c.kyc.submittedAt)}</dd>
        </dl>
        <Field label="Decision note" error={f.errors.note}><textarea className="textarea" value={f.values.note} onChange={f.set('note')} placeholder="e.g. Original passport inspected in branch" /></Field>
        <Alert type="info">You cannot decide a verification you submitted yourself (separation of duties).</Alert>
        <Alert>{f.formError}</Alert>
      </div>
    </Modal>
  );
}

function PortalAccessDialog({ c, onClose, onDone }) {
  const [result, setResult] = useState(null);
  const f = useForm({});
  const go = f.submit(async () => { const r = await api.post(`/customers/${c.id}/portal-access`); setResult(r.data); onDone(); });
  return (
    <Modal title="Online banking access" onClose={onClose} footer={result ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={f.busy} onClick={go}>Generate temporary password</Button></>}>
      {result ? (
        <div className="stack">
          <Alert type="success">Online banking is enabled for {result.email}. Share this temporary password securely; it is shown only once.</Alert>
          <div className="code-box">{result.temporaryPassword}</div>
        </div>
      ) : (
        <div className="stack"><p className="muted" style={{ margin: 0 }}>A one-time temporary password will be generated and any existing sessions signed out.</p><Alert>{f.formError}</Alert></div>
      )}
    </Modal>
  );
}
