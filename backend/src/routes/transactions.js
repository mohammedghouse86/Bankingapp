const { route } = require('../lib/registry');
const { db, findById } = require('../store');
const s = require('../lib/schemas');
const { z } = s;
const ser = require('../lib/serializers');
const { ApiError, badRequest, notFound, unprocessable } = require('../lib/errors');
const { paginate, includesText, inDateRange, toCents, fromCents, startOfUtcDay, sha256 } = require('../lib/util');
const { audit } = require('../lib/audit');
const { setting } = require('../lib/notify');
const { isCustomer, isGlobal, branchScope, loadAccount, loadTransaction, accountIdsForCustomer, holderCustomerIds, canAccessTransaction } = require('../lib/scope');
const ledger = require('../services/ledger');

const TAG = 'Transactions';
const TRANSFERS = 'Transfers';
const READ = ['transactions:read', 'portal:accounts'];

// ------------------------------------------------------------ helpers ----
function idempotency(req) {
  const key = req.get('idempotency-key');
  if (key == null) return { key: null, fingerprint: null };
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw badRequest('Idempotency-Key must be 8-64 characters [A-Za-z0-9_-]');
  return { key, fingerprint: sha256(`${req.method} ${req.path} ${JSON.stringify(req.v.body)}`) };
}

function replayOr(req, res, fn) {
  const { key, fingerprint } = idempotency(req);
  const existing = ledger.findIdempotent(req.user, key, fingerprint);
  if (existing) {
    res.set('Idempotent-Replay', 'true');
    return res.status(200).json({ data: ser.transaction(existing, req.user) });
  }
  const t = fn({ idempotencyKey: key, fingerprint });
  return res.status(t.status === 'pending_approval' ? 202 : 201).json({ data: ser.transaction(t, req.user) });
}

function requireHolder(account, customerId) {
  if (!holderCustomerIds(account.id).includes(customerId)) {
    throw unprocessable('NOT_ACCOUNT_HOLDER', 'The specified customer is not a holder of this account');
  }
  const c = findById('customers', customerId);
  if (!c || c.status !== 'active') throw unprocessable('CUSTOMER_NOT_ELIGIBLE', 'Customer profile is not active');
  return c;
}

function branchOf(account) {
  return findById('branches', account.branchId);
}

/** Staff approval threshold: tellers have a lower cash limit for withdrawals. */
function staffApprovalReason(actor, account, type, amountCents) {
  const limits = branchOf(account).limits;
  if (type === 'deposit') {
    return amountCents > limits.largeDepositThreshold * 100 ? `Cash deposit above the $${limits.largeDepositThreshold} large-deposit review threshold` : null;
  }
  const threshold = type === 'withdrawal' && actor.role === 'teller' ? limits.tellerCashWithdrawalLimit : limits.approvalThreshold;
  return amountCents > threshold * 100 ? `Amount exceeds the $${threshold} ${actor.role === 'teller' && type === 'withdrawal' ? 'teller cash' : 'branch'} approval threshold` : null;
}

function beneficiaryLimitCheck(ben, amountCents) {
  const since = startOfUtcDay().toISOString();
  const used = db.transactions.filter((t) => t.beneficiaryId === ben.id && t.createdAt >= since && ['completed', 'pending_approval'].includes(t.status)).reduce((sum, t) => sum + t.amountCents, 0);
  if (used + amountCents > ben.dailyLimitCents) {
    throw unprocessable('BENEFICIARY_LIMIT_EXCEEDED', `Daily limit for this beneficiary is ${ledger.fmt(ben.dailyLimitCents)}`, { usedToday: fromCents(used) });
  }
  if (ben.activatedAt && Date.now() - Date.parse(ben.activatedAt) < 86400000 && amountCents > setting('newBeneficiaryLimit') * 100) {
    throw unprocessable('NEW_BENEFICIARY_LIMIT', `Transfers to beneficiaries activated in the last 24 hours are limited to $${setting('newBeneficiaryLimit')}`);
  }
}

function onlineLimitCheck(source, amountCents) {
  if (amountCents > setting('customerPerTransactionLimit') * 100) {
    throw unprocessable('LIMIT_EXCEEDED', `Online transfers are limited to $${setting('customerPerTransactionLimit')} per transaction`);
  }
  const used = ledger.debitedToday(source.id, (t) => t.channel === 'online');
  if (used + amountCents > setting('customerDailyTransferLimit') * 100) {
    throw unprocessable('DAILY_LIMIT_EXCEEDED', `Daily online transfer limit of $${setting('customerDailyTransferLimit')} would be exceeded`, { usedToday: fromCents(used) });
  }
}

/**
 * Resolves and validates a transfer for either a customer (online) or a
 * staff member acting for a customer (branch). Destination must be another
 * account of the same customer or one of the customer's active beneficiaries.
 */
function planTransfer(req, body) {
  const actor = req.user;
  const online = isCustomer(actor);
  const source = loadAccount(actor, body.sourceAccountId);
  const customerId = online ? actor.customerId : body.customerId;
  if (!customerId) throw badRequest('customerId is required for staff-initiated transfers');
  requireHolder(source, customerId);
  if (Boolean(body.destinationAccountId) === Boolean(body.beneficiaryId)) throw badRequest('Provide exactly one of destinationAccountId or beneficiaryId');
  const amountCents = toCents(body.amount);
  let destination = null;
  let beneficiary = null;
  if (body.destinationAccountId) {
    destination = findById('accounts', body.destinationAccountId);
    if (!destination || !accountIdsForCustomer(customerId).includes(destination.id)) {
      throw unprocessable('UNAUTHORIZED_DESTINATION', 'Destination must be another account held by the same customer; pay other people via a registered beneficiary');
    }
  } else {
    beneficiary = findById('beneficiaries', body.beneficiaryId);
    if (!beneficiary || beneficiary.customerId !== customerId || beneficiary.status === 'deleted') throw notFound('Beneficiary');
    if (beneficiary.status !== 'active') throw unprocessable('BENEFICIARY_NOT_ACTIVE', `Beneficiary is ${beneficiary.status.replace('_', ' ')}`);
    if (beneficiary.isInternal) {
      destination = findById('accounts', beneficiary.internalAccountId);
      if (!destination) throw unprocessable('BENEFICIARY_NOT_ACTIVE', 'Beneficiary account no longer exists');
    }
    beneficiaryLimitCheck(beneficiary, amountCents);
  }
  ledger.assertCanDebit(source);
  if (destination) ledger.assertCanCredit(destination);
  if (destination && destination.id === source.id) throw unprocessable('SAME_ACCOUNT', 'Source and destination accounts must differ');
  ledger.assertFunds(source, amountCents);
  let approvalReason;
  if (online) {
    onlineLimitCheck(source, amountCents);
    approvalReason = amountCents > setting('customerApprovalThreshold') * 100 ? `Online transfer above the $${setting('customerApprovalThreshold')} review threshold` : null;
  } else {
    approvalReason = staffApprovalReason(actor, source, 'transfer', amountCents);
  }
  return { source, destination, beneficiary, amountCents, customerId, approvalReason, channel: online ? 'online' : 'branch' };
}

function runTransfer(req, res, body) {
  return replayOr(req, res, (idem) => {
    const p = planTransfer(req, body);
    return ledger.execute({
      req, type: 'transfer', channel: p.channel, amountCents: p.amountCents, source: p.source, destination: p.destination, beneficiary: p.beneficiary,
      description: body.description || (p.beneficiary ? `Payment to ${p.beneficiary.nickname || p.beneficiary.name}` : 'Transfer between own accounts'),
      customerId: p.customerId, approvalReason: p.approvalReason, ...idem,
    });
  });
}

const description = z.string().trim().max(140).optional();

// --------------------------------------------------------------- reads ----
const listQuery = z.object({
  ...s.paging,
  type: z.enum(['deposit', 'withdrawal', 'transfer', 'reversal', 'fee', 'interest', 'fd_closure']).optional(),
  status: z.enum(['pending_approval', 'completed', 'rejected', 'reversed', 'cancelled']).optional(),
  channel: z.enum(['branch', 'online', 'ach', 'system']).optional(),
  accountId: s.id.optional(),
  customerId: s.id.optional(),
  branchId: s.id.optional(),
  initiatedBy: s.id.optional(),
  from: s.dateOrDateTime.optional(),
  to: s.dateOrDateTime.optional(),
  minAmount: z.coerce.number().min(0).optional(),
  maxAmount: z.coerce.number().min(0).optional(),
}).strict();

function scopedTransactions(u) {
  if (isCustomer(u)) {
    const own = accountIdsForCustomer(u.customerId);
    return db.transactions.filter((t) => own.includes(t.sourceAccountId) || own.includes(t.destinationAccountId));
  }
  if (isGlobal(u)) return db.transactions;
  return db.transactions.filter((t) => canAccessTransaction(u, t));
}

function filterTransactions(list, q) {
  return list.filter((t) => (!q.type || t.type === q.type) && (!q.status || t.status === q.status) && (!q.channel || t.channel === q.channel)
    && (!q.accountId || t.sourceAccountId === q.accountId || t.destinationAccountId === q.accountId)
    && (!q.customerId || t.customerId === q.customerId) && (!q.branchId || t.branchId === q.branchId)
    && (!q.initiatedBy || t.initiatedBy === q.initiatedBy) && inDateRange(t.createdAt, q.from, q.to)
    && (q.minAmount == null || t.amountCents >= toCents(q.minAmount)) && (q.maxAmount == null || t.amountCents <= toCents(q.maxAmount))
    && includesText([t.reference, t.description], q.search));
}

const SORTS = { createdAt: (t) => t.createdAt, amount: (t) => t.amountCents, status: (t) => t.status, type: (t) => t.type };

route({
  method: 'get', path: '/transactions', tag: TAG, permission: READ, apiKeyAllowed: true,
  summary: 'Search transactions in scope',
  query: listQuery,
  response: { list: 'Transaction' },
  handler: (req, res) => {
    const q = req.v.query;
    if (isCustomer(req.user) && (q.customerId || q.branchId || q.initiatedBy)) throw badRequest('customerId, branchId and initiatedBy filters are only available to staff');
    const page = paginate(filterTransactions(scopedTransactions(req.user), q), q, SORTS, 'createdAt');
    res.json({ data: page.items.map((t) => ser.transaction(t, req.user)), pagination: page.pagination });
  },
});

route({
  method: 'get', path: '/transactions/summary', tag: TAG, permission: READ,
  summary: 'Aggregated totals by type and status for transactions in scope',
  query: z.object({ from: s.dateOrDateTime.optional(), to: s.dateOrDateTime.optional() }).strict(),
  response: 'TransactionSummary',
  handler: (req, res) => {
    const list = filterTransactions(scopedTransactions(req.user), req.v.query);
    const group = (key) => list.reduce((m, t) => { const k = t[key]; m[k] = m[k] || { count: 0, amount: 0 }; m[k].count += 1; m[k].amount = Math.round((m[k].amount + fromCents(t.amountCents)) * 100) / 100; return m; }, {});
    res.json({ data: { count: list.length, totalAmount: fromCents(list.reduce((sum, t) => sum + t.amountCents, 0)), byType: group('type'), byStatus: group('status'), byChannel: group('channel') } });
  },
});

route({
  method: 'get', path: '/transactions/my-activity', tag: TAG, permission: 'transactions:read',
  summary: 'Transactions initiated by the current employee',
  query: z.object({ ...s.paging, from: s.dateOrDateTime.optional(), to: s.dateOrDateTime.optional(), status: listQuery.shape.status }).strict(),
  response: { list: 'Transaction' },
  handler: (req, res) => {
    const q = req.v.query;
    const list = db.transactions.filter((t) => t.initiatedBy === req.user.id && inDateRange(t.createdAt, q.from, q.to) && (!q.status || t.status === q.status) && includesText([t.reference, t.description], q.search));
    const page = paginate(list, q, SORTS, 'createdAt');
    res.json({ data: page.items.map((t) => ser.transaction(t, req.user)), pagination: page.pagination });
  },
});

route({
  method: 'get', path: '/transactions/by-reference/:reference', tag: TAG, permission: READ,
  summary: 'Find a transaction by its reference number',
  params: z.object({ reference: z.string().regex(/^[A-Z0-9]{8,32}$/, 'invalid reference format') }).strict(),
  response: 'Transaction',
  handler: (req, res) => {
    const t = db.transactions.find((x) => x.reference === req.v.params.reference);
    if (!t || !canAccessTransaction(req.user, t)) throw notFound('Transaction');
    res.json({ data: ser.transaction(t, req.user) });
  },
});

route({
  method: 'get', path: '/transactions/:id', tag: TAG, permission: READ, apiKeyAllowed: true,
  summary: 'Get transaction details',
  params: s.idParams,
  response: 'Transaction',
  handler: (req, res) => res.json({ data: ser.transaction(loadTransaction(req.user, req.v.params.id), req.user) }),
});

function receipt(t, viewer) {
  const v = ser.transaction(t, viewer);
  return {
    receiptNumber: `RCPT-${t.reference}`,
    bank: 'Kestrel Bank (simulated)',
    branch: findById('branches', t.branchId).name,
    reference: t.reference,
    type: t.type,
    status: t.status,
    amount: v.amount,
    currency: t.currency,
    from: v.sourceAccount ? (v.sourceAccount.accountNumber ? `****${v.sourceAccount.accountNumber.slice(-4)}` : v.sourceAccount.accountNumberMasked) : 'Cash',
    to: v.destinationAccount ? (v.destinationAccount.accountNumber ? `****${v.destinationAccount.accountNumber.slice(-4)}` : v.destinationAccount.accountNumberMasked) : v.counterparty ? `${v.counterparty.name} (${v.counterparty.bankName})` : 'Cash',
    description: t.description,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
    disclaimer: 'Simulated transaction for security testing. No real funds were moved.',
  };
}

route({
  method: 'get', path: '/transactions/:id/receipt', tag: TAG, permission: READ,
  summary: 'Transaction receipt (JSON)',
  params: s.idParams,
  response: 'Receipt',
  handler: (req, res) => res.json({ data: receipt(loadTransaction(req.user, req.v.params.id), req.user) }),
});

route({
  method: 'get', path: '/transactions/:id/receipt/download', tag: TAG, permission: READ, produces: 'text/html',
  summary: 'Printable transaction receipt (HTML)',
  params: s.idParams,
  handler: (req, res) => {
    const r = receipt(loadTransaction(req.user, req.v.params.id), req.user);
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    const rows = [['Receipt', r.receiptNumber], ['Reference', r.reference], ['Type', r.type], ['Status', r.status], ['Amount', `${r.amount.toFixed(2)} ${r.currency}`], ['From', r.from], ['To', r.to], ['Description', r.description], ['Date', r.createdAt], ['Branch', r.branch]];
    res.type('text/html').attachment(`receipt-${r.reference}.html`).send(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.receiptNumber)}</title><style>body{font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;color:#111}td{padding:6px 0;border-bottom:1px dashed #ccc}td:first-child{color:#666;width:40%}</style></head><body><h2>Kestrel Bank</h2><table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table><p style="font-size:12px;color:#666">${esc(r.disclaimer)}</p></body></html>`);
  },
});

route({
  method: 'get', path: '/transactions/:id/ledger-entries', tag: TAG, permission: 'transactions:read',
  summary: 'Double-entry ledger postings of a transaction (staff)',
  params: s.idParams,
  response: { array: 'LedgerEntry' },
  handler: (req, res) => {
    const t = loadTransaction(req.user, req.v.params.id);
    res.json({ data: db.ledgerEntries.filter((e) => e.transactionId === t.id).map((e) => ({ id: e.id, accountId: e.accountId, direction: e.direction, amount: fromCents(e.amountCents), balanceAfter: fromCents(e.balanceAfterCents), createdAt: e.createdAt })) });
  },
});

// ----------------------------------------------------------- branch ops ----
route({
  method: 'post', path: '/transactions/deposits', tag: TAG, permission: 'transactions:deposit', status: 201, idempotent: true, businessRules: true, conflicts: true,
  summary: 'Post a cash deposit at the branch',
  description: 'Large deposits above the branch threshold are held for manager review (HTTP 202). Frozen and closed accounts cannot receive deposits.',
  body: z.object({ accountId: s.id, amount: s.amount, depositorName: s.name.max(80), description }).strict(),
  response: 'Transaction',
  handler: (req, res) => replayOr(req, res, (idem) => {
    const b = req.v.body;
    const a = loadAccount(req.user, b.accountId);
    const amountCents = toCents(b.amount);
    return ledger.execute({
      req, type: 'deposit', channel: 'branch', amountCents, destination: a, description: b.description || `Cash deposit by ${b.depositorName}`,
      customerId: holderCustomerIds(a.id)[0], approvalReason: staffApprovalReason(req.user, a, 'deposit', amountCents), ...idem,
    });
  }),
});

route({
  method: 'post', path: '/transactions/withdrawals', tag: TAG, permission: 'transactions:withdraw', status: 201, idempotent: true, businessRules: true, conflicts: true,
  summary: 'Process a cash withdrawal for an account holder present at the branch',
  description: 'The account holder must be identified: `customerId` must hold the account and `idVerification` must match the identity document on file. Teller withdrawals above the teller cash limit require manager approval (HTTP 202).',
  body: z.object({
    accountId: s.id, customerId: s.id, amount: s.amount, description,
    idVerification: z.object({ documentType: z.enum(['passport', 'drivers_license', 'national_id']), documentNumberLast4: z.string().regex(/^[A-Z0-9]{4}$/i) }).strict(),
  }).strict(),
  response: 'Transaction',
  handler: (req, res) => replayOr(req, res, (idem) => {
    const b = req.v.body;
    const a = loadAccount(req.user, b.accountId);
    const c = requireHolder(a, b.customerId);
    const doc = c.kyc && c.kyc.documentNumber;
    if (!doc || c.kycStatus !== 'verified' || c.kyc.documentType !== b.idVerification.documentType || doc.slice(-4).toUpperCase() !== b.idVerification.documentNumberLast4.toUpperCase()) {
      audit(req, { action: 'transaction.withdrawal_id_check_failed', entityType: 'account', entityId: a.id, branchId: a.branchId, outcome: 'denied', riskLevel: 'high', details: { customerId: c.id } });
      throw unprocessable('IDENTITY_VERIFICATION_FAILED', 'Customer identification does not match the document on file');
    }
    const amountCents = toCents(b.amount);
    const limit = branchOf(a).limits.dailyCashWithdrawalLimit * 100;
    const used = ledger.debitedToday(a.id, (t) => t.type === 'withdrawal' && t.channel === 'branch');
    if (used + amountCents > limit) throw unprocessable('DAILY_CASH_LIMIT_EXCEEDED', `Daily cash withdrawal limit of ${ledger.fmt(limit)} would be exceeded`, { usedToday: fromCents(used) });
    return ledger.execute({
      req, type: 'withdrawal', channel: 'branch', amountCents, source: a, description: b.description || 'Cash withdrawal at branch',
      customerId: c.id, approvalReason: staffApprovalReason(req.user, a, 'withdrawal', amountCents), ...idem,
    });
  }),
});

const transferBody = z.object({
  customerId: s.id, sourceAccountId: s.id, destinationAccountId: s.id.optional(), beneficiaryId: s.id.optional(), amount: s.amount, description,
}).strict();

route({
  method: 'post', path: '/transactions/transfers', tag: TAG, permission: 'transactions:transfer', status: 201, idempotent: true, businessRules: true, conflicts: true,
  summary: 'Initiate a transfer on behalf of a customer (branch)',
  description: 'The destination must be another account of the same customer or one of that customer\'s active beneficiaries. Transfers above the branch approval threshold are held for approval (HTTP 202).',
  body: transferBody,
  response: 'Transaction',
  handler: (req, res) => runTransfer(req, res, req.v.body),
});

// ------------------------------------------------------- customer portal ----
route({
  method: 'post', path: '/transfers/own', tag: TRANSFERS, roles: ['customer'], permission: 'portal:transfer', status: 201, idempotent: true, businessRules: true, conflicts: true,
  summary: 'Transfer between your own accounts',
  body: z.object({ sourceAccountId: s.id, destinationAccountId: s.id, amount: s.amount, description }).strict(),
  response: 'Transaction',
  handler: (req, res) => runTransfer(req, res, req.v.body),
});

route({
  method: 'post', path: '/transfers/beneficiary', tag: TRANSFERS, roles: ['customer'], permission: 'portal:transfer', status: 201, idempotent: true, businessRules: true, conflicts: true,
  summary: 'Pay a registered beneficiary',
  description: 'Subject to per-transaction, daily, beneficiary and new-beneficiary limits. Large transfers are held for manager approval (HTTP 202).',
  body: z.object({ sourceAccountId: s.id, beneficiaryId: s.id, amount: s.amount, description }).strict(),
  response: 'Transaction',
  handler: (req, res) => runTransfer(req, res, req.v.body),
});

route({
  method: 'post', path: '/transfers/validate', tag: TRANSFERS, permission: ['portal:transfer', 'transactions:transfer'], businessRules: true,
  summary: 'Pre-flight check of a transfer without executing it',
  body: z.object({ customerId: s.id.optional(), sourceAccountId: s.id, destinationAccountId: s.id.optional(), beneficiaryId: s.id.optional(), amount: s.amount }).strict(),
  response: 'TransferValidation',
  handler: (req, res) => {
    try {
      const p = planTransfer(req, req.v.body);
      res.json({ data: { allowed: true, requiresApproval: Boolean(p.approvalReason), approvalReason: p.approvalReason, availableBalance: fromCents(ledger.available(p.source)), fee: 0 } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        return res.json({ data: { allowed: false, requiresApproval: false, code: e.code, reason: e.message, fee: 0 } });
      }
      throw e;
    }
  },
});

// ------------------------------------------------------------ decisions ----
route({
  method: 'post', path: '/transactions/:id/approve', tag: TAG, permission: 'transactions:approve', risk: 'high', businessRules: true, conflicts: true,
  summary: 'Approve a pending transaction',
  description: 'Managers may approve within their branch up to the manager approval limit; larger amounts require a super admin. Nobody can approve a transaction they initiated.',
  params: s.idParams,
  body: z.object({ note: z.string().trim().max(300).optional() }).strict(),
  response: 'Transaction',
  handler: (req, res) => {
    const t = loadTransaction(req.user, req.v.params.id);
    res.json({ data: ser.transaction(ledger.approve(req, t, req.v.body.note), req.user) });
  },
});

route({
  method: 'post', path: '/transactions/:id/reject', tag: TAG, permission: 'transactions:approve', risk: 'high', conflicts: true,
  summary: 'Reject a pending transaction (releases held funds)',
  params: s.idParams,
  body: z.object({ reason: s.text(300) }).strict(),
  response: 'Transaction',
  handler: (req, res) => {
    const t = loadTransaction(req.user, req.v.params.id);
    res.json({ data: ser.transaction(ledger.reject(req, t, req.v.body.reason), req.user) });
  },
});

route({
  method: 'post', path: '/transactions/:id/cancel', tag: TAG, permission: ['portal:transfer', 'transactions:deposit', 'transactions:withdraw', 'transactions:transfer'], conflicts: true,
  summary: 'Cancel your own pending transaction',
  params: s.idParams,
  response: 'Transaction',
  handler: (req, res) => {
    const t = loadTransaction(req.user, req.v.params.id);
    res.json({ data: ser.transaction(ledger.cancel(req, t), req.user) });
  },
});

route({
  method: 'post', path: '/transactions/:id/reverse', tag: TAG, permission: 'transactions:reverse', risk: 'critical', businessRules: true, conflicts: true,
  summary: 'Reverse a completed transaction',
  description: 'Creates a compensating reversal entry. Only deposits, withdrawals, transfers and fees within the reversal window can be reversed, never by their initiator.',
  params: s.idParams,
  body: z.object({ reason: s.text(300) }).strict(),
  response: 'Transaction',
  handler: (req, res) => {
    const t = loadTransaction(req.user, req.v.params.id);
    if (req.user.role === 'manager' && t.branchId !== req.user.branchId) throw notFound('Transaction');
    res.json({ data: ser.transaction(ledger.reverse(req, t, req.v.body.reason), req.user) });
  },
});

// ------------------------------------------------------------ approvals ----
function scopedApprovals(u) {
  return db.approvals.filter((a) => branchScope(u) == null || a.branchId === u.branchId);
}

route({
  method: 'get', path: '/approvals', tag: 'Approvals', permission: 'approvals:read',
  summary: 'Approval queue',
  query: z.object({ ...s.paging, status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(), requiredRole: z.enum(['manager', 'super_admin']).optional(), branchId: s.id.optional() }).strict(),
  response: { list: 'Approval' },
  handler: (req, res) => {
    const q = req.v.query;
    const list = scopedApprovals(req.user).filter((a) => (!q.status || a.status === q.status) && (!q.requiredRole || a.requiredRole === q.requiredRole) && (!q.branchId || a.branchId === q.branchId));
    const page = paginate(list, q, { createdAt: (a) => a.createdAt, amount: (a) => a.amountCents }, 'createdAt');
    res.json({ data: page.items.map((a) => ser.approval(a, req.user)), pagination: page.pagination });
  },
});

route({
  method: 'get', path: '/approvals/:id', tag: 'Approvals', permission: 'approvals:read',
  summary: 'Approval details including the transaction',
  params: s.idParams,
  response: 'Approval',
  handler: (req, res) => {
    const a = findById('approvals', req.v.params.id);
    if (!a || (branchScope(req.user) != null && a.branchId !== req.user.branchId)) throw notFound('Approval');
    res.json({ data: { ...ser.approval(a, req.user), canDecide: a.status === 'pending' && a.requestedBy !== req.user.id && (req.user.role === 'super_admin' || a.requiredRole === 'manager') } });
  },
});
