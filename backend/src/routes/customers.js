const { route } = require('../lib/registry');
const { db, nextId, findById } = require('../store');
const s = require('../lib/schemas');
const { z } = s;
const ser = require('../lib/serializers');
const { ApiError, forbidden, conflict, badRequest, unprocessable } = require('../lib/errors');
const { nowIso, paginate, includesText, inDateRange, fromCents, toCsv } = require('../lib/util');
const { hashPassword, generateTempPassword } = require('../lib/password');
const { revokeUserSessions } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { notifyCustomer, notifyUser, sendEmail } = require('../lib/notify');
const { branchScope, loadCustomer, accountIdsForCustomer } = require('../lib/scope');

const TAG = 'Customers';
const nationalId = z.string().trim().regex(/^(SIM-)?\d{3}-\d{2}-\d{4}$/, 'expected format SIM-123-45-6789');

const profileFields = {
  firstName: s.name, lastName: s.name, occupation: z.string().trim().max(80), annualIncome: z.number().int().min(0).max(100000000), address: s.address,
};

function emailTaken(email, exceptCustomerId) {
  return db.customers.some((c) => c.email === email && c.id !== exceptCustomerId)
    || db.users.some((u) => u.email === email && u.customerId !== exceptCustomerId);
}

// -------------------------------------------------------------- export ----
route({
  method: 'get', path: '/customers/export', tag: TAG, permission: 'customers:export', risk: 'critical', stepUp: true, produces: 'text/csv',
  summary: 'Bulk export of customer PII as CSV (super admin)',
  description: 'Exports unmasked personal data for all customers. Intended for regulatory submissions only.',
  query: z.object({ branchId: s.id.optional(), status: z.enum(['active', 'pending_verification', 'suspended', 'closed']).optional() }).strict(),
  handler: (req, res) => {
    const q = req.v.query;
    const rows = db.customers.filter((c) => (!q.branchId || c.branchId === q.branchId) && (!q.status || c.status === q.status));
    audit(req, { action: 'customer.bulk_export', entityType: 'customer', riskLevel: 'critical', details: { rows: rows.length, filters: q } });
    const csv = toCsv(rows, [
      { label: 'customer_number', value: (c) => c.customerNumber }, { label: 'first_name', value: (c) => c.firstName },
      { label: 'last_name', value: (c) => c.lastName }, { label: 'email', value: (c) => c.email }, { label: 'phone', value: (c) => c.phone },
      { label: 'date_of_birth', value: (c) => c.dateOfBirth }, { label: 'national_id', value: (c) => c.nationalId },
      { label: 'address', value: (c) => `${c.address.line1}, ${c.address.city}, ${c.address.state} ${c.address.postalCode}` },
      { label: 'branch_id', value: (c) => c.branchId }, { label: 'status', value: (c) => c.status }, { label: 'kyc_status', value: (c) => c.kycStatus },
    ]);
    res.type('text/csv').attachment('customers-export.csv').send(csv);
  },
});

// ---------------------------------------------------------------- list ----
route({
  method: 'get', path: '/customers', tag: TAG, permission: 'customers:read',
  summary: 'Search customers in scope',
  query: z.object({
    ...s.paging,
    status: z.enum(['active', 'pending_verification', 'suspended', 'closed']).optional(),
    kycStatus: z.enum(['unverified', 'pending_review', 'verified', 'rejected']).optional(),
    branchId: s.id.optional(),
    riskRating: z.enum(['low', 'medium', 'high']).optional(),
  }).strict(),
  response: { list: 'Customer' },
  handler: (req, res) => {
    const q = req.v.query;
    const scope = branchScope(req.user);
    const list = db.customers.filter((c) => (scope == null || c.branchId === scope)
      && (!q.branchId || c.branchId === q.branchId) && (!q.status || c.status === q.status)
      && (!q.kycStatus || c.kycStatus === q.kycStatus) && (!q.riskRating || c.riskRating === q.riskRating)
      && includesText([c.firstName, c.lastName, `${c.firstName} ${c.lastName}`, c.email, c.customerNumber, c.phone], q.search));
    const page = paginate(list, q, { name: (c) => `${c.lastName} ${c.firstName}`, createdAt: (c) => c.createdAt, customerNumber: (c) => c.customerNumber, status: (c) => c.status }, 'name');
    res.json({ data: page.items.map((c) => ser.customer(c, req.user)), pagination: page.pagination });
  },
});

route({
  method: 'post', path: '/customers', tag: TAG, permission: 'customers:create', status: 201, conflicts: true,
  summary: 'Onboard a new customer (branch staff)',
  description: 'Tellers may onboard only when their branch policy allows it. New customers start in `pending_verification` until identity verification is approved.',
  body: z.object({
    firstName: s.name, lastName: s.name, email: s.email, phone: s.phone, dateOfBirth: s.date, nationalId,
    address: s.address, occupation: profileFields.occupation.optional(), annualIncome: profileFields.annualIncome.optional(),
    branchId: s.id.optional(),
  }).strict(),
  response: 'Customer',
  handler: (req, res) => {
    const b = req.v.body;
    const actor = req.user;
    const branchId = actor.role === 'super_admin' ? b.branchId : actor.branchId;
    if (actor.role !== 'super_admin' && b.branchId && b.branchId !== actor.branchId) throw forbidden('You can only onboard customers into your own branch');
    const branch = branchId && findById('branches', branchId);
    if (!branch) throw badRequest('branchId is required');
    if (branch.status !== 'active') throw badRequest('Branch is not active');
    if (actor.role === 'teller' && !branch.tellersCanOnboard) {
      throw new ApiError(403, 'BRANCH_POLICY', 'Branch policy requires a manager to onboard new customers');
    }
    const age = (Date.now() - Date.parse(b.dateOfBirth)) / (365.25 * 86400000);
    if (!(age >= 18 && age < 120)) throw badRequest('Customer must be at least 18 years old');
    if (emailTaken(b.email)) throw conflict('A customer with this email already exists');
    const now = nowIso();
    const c = {
      id: nextId('customers'), customerNumber: null, firstName: b.firstName, lastName: b.lastName, email: b.email, phone: b.phone,
      dateOfBirth: b.dateOfBirth, nationalId: b.nationalId.startsWith('SIM-') ? b.nationalId : `SIM-${b.nationalId}`, address: b.address,
      occupation: b.occupation || null, annualIncome: b.annualIncome ?? null, branchId, status: 'pending_verification', kycStatus: 'unverified', kyc: null,
      riskRating: 'low', userId: null, createdBy: actor.id, createdAt: now, updatedAt: now,
    };
    c.customerNumber = `CUS${String(100000 + c.id * 37).padStart(7, '0')}`;
    db.customers.push(c);
    audit(req, { action: 'customer.create', entityType: 'customer', entityId: c.id, branchId });
    res.status(201).json({ data: ser.customer(c, actor) });
  },
});

route({
  method: 'get', path: '/customers/:id', tag: TAG, permission: ['customers:read', 'portal:profile'],
  summary: 'Get a customer profile',
  description: 'Staff can read customers in their branch scope; customers can read only their own profile.',
  params: s.idParams,
  response: 'Customer',
  handler: (req, res) => res.json({ data: ser.customer(loadCustomer(req.user, req.v.params.id), req.user) }),
});

route({
  method: 'patch', path: '/customers/:id', tag: TAG, permission: 'customers:update', risk: 'critical',
  summary: 'Update customer profile details (name, address, occupation, income)',
  description: 'Contact details (email/phone) use PUT /customers/{id}/contact. Status, KYC, branch and identifiers cannot be changed here.',
  params: s.idParams,
  body: z.object({
    firstName: profileFields.firstName.optional(), lastName: profileFields.lastName.optional(), occupation: profileFields.occupation.optional(),
    annualIncome: profileFields.annualIncome.optional(), address: s.address.optional(),
  }).strict().refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update'),
  response: 'Customer',
  handler: (req, res) => {
    const c = loadCustomer(req.user, req.v.params.id);
    if (c.status === 'closed') throw conflict('Closed customer profiles cannot be modified');
    const before = Object.fromEntries(Object.keys(req.v.body).map((k) => [k, c[k]]));
    Object.assign(c, req.v.body, { updatedAt: nowIso() });
    audit(req, { action: 'customer.update', entityType: 'customer', entityId: c.id, branchId: c.branchId, riskLevel: 'critical', details: { fields: Object.keys(req.v.body), before } });
    notifyCustomer(c.id, { type: 'security', title: 'Profile updated', message: 'Your profile details were updated by the bank.' });
    res.json({ data: ser.customer(c, req.user) });
  },
});

function changeContact(req, c) {
  const { email, phone } = req.v.body;
  if (email && email !== c.email && emailTaken(email, c.id)) throw conflict('Email is already in use');
  const oldEmail = c.email;
  if (email) c.email = email;
  if (phone) c.phone = phone;
  c.updatedAt = nowIso();
  const u = c.userId && findById('users', c.userId);
  if (u) {
    if (email) u.email = email;
    if (phone) u.phone = phone;
    u.updatedAt = c.updatedAt;
  }
  audit(req, { action: 'customer.contact_change', entityType: 'customer', entityId: c.id, branchId: c.branchId, riskLevel: 'critical', details: { emailChanged: Boolean(email && email !== oldEmail), phoneChanged: Boolean(phone) } });
  sendEmail(oldEmail, 'Your contact details were changed', 'The email or phone number on your Kestrel Bank profile was changed. If you did not request this, call us immediately.');
  notifyCustomer(c.id, { type: 'security', title: 'Contact details changed', message: 'Your email or phone number was changed.' });
}

const contactBody = z.object({ email: s.email.optional(), phone: s.phone.optional() }).strict()
  .refine((o) => o.email || o.phone, 'Provide email and/or phone');

route({
  method: 'put', path: '/customers/:id/contact', tag: TAG, permission: 'customers:update', risk: 'critical', stepUp: true, conflicts: true,
  summary: 'Change a customer\'s email or phone (account-takeover sensitive)',
  description: 'Updates the contact details used for notifications and login. The previous email address is notified.',
  params: s.idParams,
  body: contactBody,
  response: 'Customer',
  handler: (req, res) => {
    const c = loadCustomer(req.user, req.v.params.id);
    if (c.status === 'closed') throw conflict('Closed customer profiles cannot be modified');
    changeContact(req, c);
    res.json({ data: ser.customer(c, req.user) });
  },
});

route({
  method: 'get', path: '/customers/:id/accounts', tag: TAG, permission: ['accounts:read', 'portal:accounts'],
  summary: 'Accounts held by a customer (including joint)',
  params: s.idParams,
  response: { array: 'Account' },
  handler: (req, res) => {
    const c = loadCustomer(req.user, req.v.params.id);
    const ids = accountIdsForCustomer(c.id);
    res.json({ data: db.accounts.filter((a) => ids.includes(a.id)).map(ser.account) });
  },
});

route({
  method: 'get', path: '/customers/:id/transactions', tag: TAG, permission: ['transactions:read', 'portal:accounts'],
  summary: 'Transactions across all of a customer\'s accounts',
  params: s.idParams,
  query: z.object({ ...s.paging, from: s.dateOrDateTime.optional(), to: s.dateOrDateTime.optional(), status: z.string().max(30).optional() }).strict(),
  response: { list: 'Transaction' },
  handler: (req, res) => {
    const c = loadCustomer(req.user, req.v.params.id);
    const ids = accountIdsForCustomer(c.id);
    const q = req.v.query;
    const list = db.transactions.filter((t) => (ids.includes(t.sourceAccountId) || ids.includes(t.destinationAccountId))
      && inDateRange(t.createdAt, q.from, q.to) && (!q.status || t.status === q.status)
      && includesText([t.reference, t.description], q.search));
    const page = paginate(list, q, { createdAt: (t) => t.createdAt, amount: (t) => t.amountCents }, 'createdAt');
    res.json({ data: page.items.map((t) => ser.transaction(t, req.user)), pagination: page.pagination });
  },
});

route({
  method: 'get', path: '/customers/:id/summary', tag: TAG, permission: ['customers:read', 'portal:accounts'],
  summary: 'Customer 360 summary: balances, activity and open items',
  params: s.idParams,
  response: 'CustomerSummary',
  handler: (req, res) => {
    const c = loadCustomer(req.user, req.v.params.id);
    const ids = accountIdsForCustomer(c.id);
    const accounts = db.accounts.filter((a) => ids.includes(a.id));
    const txns = db.transactions.filter((t) => ids.includes(t.sourceAccountId) || ids.includes(t.destinationAccountId));
    const last = txns.reduce((m, t) => (!m || t.createdAt > m.createdAt ? t : m), null);
    res.json({
      data: {
        customerId: c.id,
        totalBalance: fromCents(accounts.filter((a) => a.status !== 'closed').reduce((sum, a) => sum + a.balanceCents, 0)),
        accountsByStatus: accounts.reduce((m, a) => ({ ...m, [a.status]: (m[a.status] || 0) + 1 }), {}),
        accountsByType: accounts.reduce((m, a) => ({ ...m, [a.type]: (m[a.type] || 0) + 1 }), {}),
        transactionCount: txns.length,
        pendingTransactions: txns.filter((t) => t.status === 'pending_approval').length,
        lastTransactionAt: last ? last.createdAt : null,
        beneficiaries: db.beneficiaries.filter((b) => b.customerId === c.id && b.status !== 'deleted').length,
        openServiceRequests: db.serviceRequests.filter((r) => r.customerId === c.id && ['open', 'in_progress'].includes(r.status)).length,
        openDisputes: db.disputes.filter((d) => d.customerId === c.id && ['open', 'under_review'].includes(d.status)).length,
      },
    });
  },
});

// ----------------------------------------------------------------- KYC ----
const DOC_PATTERNS = { passport: /^P\d{7,8}$/, drivers_license: /^D\d{7,8}$/, national_id: /^N\d{7,8}$/ };

route({
  method: 'post', path: '/customers/:id/identity-verification', tag: TAG, permission: 'customers:kyc_submit', businessRules: true,
  summary: 'Submit identity documents for simulated verification',
  description: 'Runs a simulated document check (format, expiry, date-of-birth match, watchlist). Documents ending in 0000 simulate a watchlist hit. Passing checks move the profile to `pending_review` for a manager decision.',
  params: s.idParams,
  body: z.object({
    documentType: z.enum(['passport', 'drivers_license', 'national_id']),
    documentNumber: z.string().trim().toUpperCase().max(12),
    issuingCountry: z.string().trim().length(2),
    expiryDate: s.date,
    dateOfBirth: s.date,
  }).strict(),
  response: 'KycResult',
  handler: (req, res) => {
    const c = loadCustomer(req.user, req.v.params.id);
    const b = req.v.body;
    if (c.kycStatus === 'verified') throw conflict('Customer identity is already verified');
    if (c.status === 'closed') throw conflict('Closed customer profiles cannot be modified');
    const checks = {
      documentFormat: DOC_PATTERNS[b.documentType].test(b.documentNumber),
      notExpired: b.expiryDate > nowIso().slice(0, 10),
      dateOfBirthMatch: b.dateOfBirth === c.dateOfBirth,
      watchlistClear: !b.documentNumber.endsWith('0000'),
    };
    const passed = Object.values(checks).every(Boolean);
    const score = Math.round((Object.values(checks).filter(Boolean).length / 4) * 85 + (passed ? 10 : 0));
    c.kyc = { documentType: b.documentType, documentNumber: b.documentNumber, issuingCountry: b.issuingCountry, score, checks, submittedAt: nowIso(), submittedBy: req.user.id, verifiedAt: null, verifiedBy: null, decisionNote: null };
    c.kycStatus = passed ? 'pending_review' : 'rejected';
    c.updatedAt = nowIso();
    audit(req, { action: 'customer.kyc_submit', entityType: 'customer', entityId: c.id, branchId: c.branchId, details: { passed, score } });
    res.json({ data: { customerId: c.id, kycStatus: c.kycStatus, passed, score, checks } });
  },
});

route({
  method: 'post', path: '/customers/:id/kyc-decision', tag: TAG, permission: 'customers:kyc_decide', risk: 'high',
  summary: 'Approve or reject a pending identity verification',
  description: 'The reviewer must differ from the employee who submitted the documents (separation of duties).',
  params: s.idParams,
  body: z.object({ decision: z.enum(['approve', 'reject']), note: s.text(300) }).strict(),
  response: 'Customer',
  handler: (req, res) => {
    const c = loadCustomer(req.user, req.v.params.id);
    if (c.kycStatus !== 'pending_review') throw conflict(`KYC is ${c.kycStatus}; only pending reviews can be decided`);
    if (c.kyc.submittedBy === req.user.id) throw new ApiError(403, 'SEPARATION_OF_DUTIES', 'You cannot decide a verification you submitted');
    const approved = req.v.body.decision === 'approve';
    c.kycStatus = approved ? 'verified' : 'rejected';
    c.kyc.verifiedAt = approved ? nowIso() : null;
    c.kyc.verifiedBy = req.user.id;
    c.kyc.decisionNote = req.v.body.note;
    if (approved && c.status === 'pending_verification') c.status = 'active';
    c.updatedAt = nowIso();
    audit(req, { action: `customer.kyc_${approved ? 'approve' : 'reject'}`, entityType: 'customer', entityId: c.id, branchId: c.branchId, riskLevel: 'high', details: { note: req.v.body.note } });
    notifyCustomer(c.id, { type: 'service', title: approved ? 'Identity verified' : 'Identity verification unsuccessful', message: approved ? 'Your identity has been verified. You can now open accounts.' : 'We could not verify your identity. Please visit your branch.' });
    res.json({ data: ser.customer(c, req.user) });
  },
});

route({
  method: 'put', path: '/customers/:id/status', tag: TAG, permission: 'customers:status', risk: 'high',
  summary: 'Activate or suspend a customer profile',
  description: 'Suspension disables online banking and revokes the customer\'s sessions. Activation requires verified identity.',
  params: s.idParams,
  body: z.object({ status: z.enum(['active', 'suspended']), reason: s.text(300) }).strict(),
  response: 'Customer',
  handler: (req, res) => {
    const c = loadCustomer(req.user, req.v.params.id);
    const { status, reason } = req.v.body;
    if (c.status === 'closed') throw conflict('Closed customer profiles cannot be modified');
    if (c.status === status) throw conflict(`Customer is already ${status}`);
    if (status === 'active' && c.kycStatus !== 'verified') throw unprocessable('KYC_REQUIRED', 'Identity must be verified before activation');
    c.status = status;
    c.updatedAt = nowIso();
    const u = c.userId && findById('users', c.userId);
    if (u) {
      u.status = status === 'active' ? 'active' : 'inactive';
      if (status === 'suspended') revokeUserSessions(u.id, 'customer_suspended');
    }
    audit(req, { action: `customer.${status === 'active' ? 'activate' : 'suspend'}`, entityType: 'customer', entityId: c.id, branchId: c.branchId, riskLevel: 'high', details: { reason } });
    res.json({ data: ser.customer(c, req.user) });
  },
});

route({
  method: 'post', path: '/customers/:id/portal-access', tag: TAG, permission: 'customers:portal_access', risk: 'high',
  summary: 'Grant (or re-enable) online banking access',
  description: 'Creates or re-activates the customer\'s login and returns a one-time temporary password.',
  params: s.idParams,
  response: 'TempPassword',
  handler: async (req, res) => {
    const c = loadCustomer(req.user, req.v.params.id);
    if (c.status === 'closed' || c.status === 'suspended') throw conflict(`Customer is ${c.status}`);
    const temporaryPassword = generateTempPassword();
    const now = nowIso();
    let u = c.userId && findById('users', c.userId);
    if (!u) {
      if (db.users.some((x) => x.email === c.email)) throw conflict('Another login already uses this customer\'s email');
      u = { id: nextId('users'), email: c.email, passwordHash: null, role: 'customer', firstName: c.firstName, lastName: c.lastName, phone: c.phone, branchId: null, customerId: c.id, status: 'active', employeeCode: null, title: null, hireDate: null, failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: null, passwordChangedAt: now, createdAt: now, updatedAt: now };
      db.users.push(u);
      c.userId = u.id;
    }
    u.passwordHash = await hashPassword(temporaryPassword);
    u.status = 'active';
    u.failedLoginAttempts = 0;
    u.lockedUntil = null;
    u.passwordChangedAt = now;
    revokeUserSessions(u.id, 'portal_access_reissued');
    audit(req, { action: 'customer.portal_access_grant', entityType: 'customer', entityId: c.id, branchId: c.branchId, riskLevel: 'high' });
    sendEmail(c.email, 'Your Kestrel Bank online banking access', 'Online banking was enabled. Use the temporary password provided by your branch and change it after signing in.');
    res.json({ data: { userId: u.id, email: u.email, temporaryPassword } });
  },
});

route({
  method: 'delete', path: '/customers/:id/portal-access', tag: TAG, permission: 'customers:portal_access', risk: 'high',
  summary: 'Revoke online banking access',
  params: s.idParams,
  handler: (req, res) => {
    const c = loadCustomer(req.user, req.v.params.id);
    const u = c.userId && findById('users', c.userId);
    if (!u || u.status !== 'active') throw conflict('Customer has no active online banking access');
    u.status = 'inactive';
    revokeUserSessions(u.id, 'portal_access_revoked');
    audit(req, { action: 'customer.portal_access_revoke', entityType: 'customer', entityId: c.id, branchId: c.branchId, riskLevel: 'high' });
    res.json({ data: { message: 'Online banking access revoked' } });
  },
});

route({
  method: 'get', path: '/customers/:id/beneficiaries', tag: TAG, permission: 'customers:read',
  summary: 'Beneficiaries registered by a customer (staff view)',
  params: s.idParams,
  response: { array: 'Beneficiary' },
  handler: (req, res) => {
    const c = loadCustomer(req.user, req.v.params.id);
    res.json({ data: db.beneficiaries.filter((b) => b.customerId === c.id && b.status !== 'deleted').map((b) => ser.beneficiary(b, req.user)) });
  },
});

route({
  method: 'get', path: '/customers/:id/notes', tag: TAG, permission: 'customers:read',
  summary: 'Internal staff notes on a customer',
  params: s.idParams,
  response: { array: 'CustomerNote' },
  handler: (req, res) => {
    const c = loadCustomer(req.user, req.v.params.id);
    const notes = db.customerNotes.filter((n) => n.customerId === c.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json({ data: notes.map((n) => ({ id: n.id, body: n.body, author: ser.userRef(n.authorId), createdAt: n.createdAt })) });
  },
});

route({
  method: 'post', path: '/customers/:id/notes', tag: TAG, permission: 'notes:write', status: 201,
  summary: 'Add an internal note to a customer profile',
  params: s.idParams,
  body: z.object({ body: s.text(1000) }).strict(),
  response: 'CustomerNote',
  handler: (req, res) => {
    const c = loadCustomer(req.user, req.v.params.id);
    const note = { id: nextId('customerNotes'), customerId: c.id, authorId: req.user.id, body: req.v.body.body, createdAt: nowIso() };
    db.customerNotes.push(note);
    audit(req, { action: 'customer.note_add', entityType: 'customer', entityId: c.id, branchId: c.branchId });
    res.status(201).json({ data: { id: note.id, body: note.body, author: ser.userRef(note.authorId), createdAt: note.createdAt } });
  },
});

route({
  method: 'delete', path: '/customers/:id', tag: TAG, permission: 'customers:delete', risk: 'critical', stepUp: true,
  summary: 'Erase a customer (right to be forgotten)',
  description: 'Allowed only when every account is closed. Personal data is anonymised; financial records are retained.',
  params: s.idParams,
  handler: (req, res) => {
    const c = loadCustomer(req.user, req.v.params.id);
    const open = db.accounts.filter((a) => accountIdsForCustomer(c.id).includes(a.id) && a.status !== 'closed');
    if (open.length) throw conflict('Close all of the customer\'s accounts before erasure', { openAccounts: open.map((a) => a.id) });
    const u = c.userId && findById('users', c.userId);
    if (u) {
      Object.assign(u, { status: 'deleted', email: `erased-user-${u.id}@kestrelbank.invalid`, passwordHash: null, phone: null });
      revokeUserSessions(u.id, 'customer_erased');
    }
    Object.assign(c, { firstName: 'Erased', lastName: `Customer ${c.id}`, email: `erased-${c.id}@kestrelbank.invalid`, phone: '+10000000000', nationalId: 'SIM-000-00-0000', address: { line1: 'Erased', city: 'Erased', state: 'NA', postalCode: '00000', country: 'US' }, occupation: null, annualIncome: null, status: 'closed', kyc: null, updatedAt: nowIso() });
    audit(req, { action: 'customer.erase', entityType: 'customer', entityId: c.id, branchId: c.branchId, riskLevel: 'critical' });
    res.json({ data: { message: 'Customer personal data erased' } });
  },
});

// ------------------------------------------------------ customer self ----
route({
  method: 'get', path: '/me/profile', tag: 'Customer Portal', roles: ['customer'], permission: 'portal:profile',
  summary: 'Own customer profile',
  response: 'Customer',
  handler: (req, res) => res.json({ data: ser.customer(loadCustomer(req.user, req.user.customerId), req.user) }),
});

route({
  method: 'patch', path: '/me/profile', tag: 'Customer Portal', roles: ['customer'], permission: 'portal:profile',
  summary: 'Update own address and occupation',
  description: 'Customers cannot change their name, date of birth, status, KYC or branch. Unknown fields are rejected.',
  body: z.object({ address: s.address.optional(), occupation: profileFields.occupation.optional() }).strict()
    .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update'),
  response: 'Customer',
  handler: (req, res) => {
    const c = loadCustomer(req.user, req.user.customerId);
    Object.assign(c, req.v.body, { updatedAt: nowIso() });
    audit(req, { action: 'customer.self_update', entityType: 'customer', entityId: c.id, branchId: c.branchId, details: { fields: Object.keys(req.v.body) } });
    res.json({ data: ser.customer(c, req.user) });
  },
});

route({
  method: 'put', path: '/me/contact', tag: 'Customer Portal', roles: ['customer'], permission: 'portal:profile', risk: 'critical', stepUp: true, conflicts: true,
  summary: 'Change own email or phone',
  description: 'Changes the login email and/or phone number. The previous email address receives an alert.',
  body: contactBody,
  response: 'Customer',
  handler: (req, res) => {
    const c = loadCustomer(req.user, req.user.customerId);
    changeContact(req, c);
    notifyUser(req.user.id, { type: 'security', title: 'Contact details updated', message: 'You updated your contact details.' });
    res.json({ data: ser.customer(c, req.user) });
  },
});
