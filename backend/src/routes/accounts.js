const { route } = require('../lib/registry');
const { db, nextId, findById } = require('../store');
const s = require('../lib/schemas');
const { z } = s;
const ser = require('../lib/serializers');
const { conflict, badRequest, unprocessable, notFound } = require('../lib/errors');
const { nowIso, paginate, includesText, inDateRange, toCents, fromCents, maskTail, maskName, toCsv } = require('../lib/util');
const { audit } = require('../lib/audit');
const { notifyCustomer, setting } = require('../lib/notify');
const { branchScope, isCustomer, loadAccount, loadCustomer, accountIdsForCustomer, holderCustomerIds } = require('../lib/scope');
const ledger = require('../services/ledger');

const TAG = 'Accounts';
const READ = ['accounts:read', 'portal:accounts'];
const fullName = (c) => `${c.firstName} ${c.lastName}`;

function newAccountNumber(branchId) {
  let n;
  do { n = `40${String(branchId).padStart(2, '0')}${String(100000 + Math.floor(Math.random() * 900000))}`; } while (db.accounts.some((a) => a.accountNumber === n));
  return n;
}

// ------------------------------------------------------------- lookup ----
route({
  method: 'get', path: '/accounts/lookup', tag: TAG, permission: ['accounts:read', 'transactions:transfer', 'portal:beneficiaries'],
  summary: 'Verify an internal account number before paying it',
  description: 'Returns only masked holder details so that the payer can confirm the recipient without exposing personal data.',
  query: z.object({ accountNumber: z.string().regex(/^\d{10}$/, 'accountNumber must be 10 digits') }).strict(),
  response: 'AccountLookup',
  handler: (req, res) => {
    const a = db.accounts.find((x) => x.accountNumber === req.v.query.accountNumber);
    if (!a) throw notFound('Account');
    const holder = findById('customers', holderCustomerIds(a.id)[0]);
    const branch = findById('branches', a.branchId);
    res.json({
      data: {
        accountNumberMasked: maskTail(a.accountNumber, 4),
        holderName: maskName(holder.firstName, holder.lastName),
        bankName: 'Kestrel Bank',
        branchName: branch.name,
        routingNumber: branch.routingNumber,
        acceptsCredits: a.type !== 'fixed_deposit' && !['closed', 'frozen'].includes(a.status),
      },
    });
  },
});

// --------------------------------------------------------------- list ----
route({
  method: 'get', path: '/accounts', tag: TAG, permission: READ, apiKeyAllowed: false,
  summary: 'List accounts (customers: own accounts; staff: branch scope)',
  query: z.object({
    ...s.paging,
    type: z.enum(['savings', 'checking', 'fixed_deposit']).optional(),
    status: z.enum(['active', 'frozen', 'dormant', 'closed']).optional(),
    branchId: s.id.optional(),
    customerId: s.id.optional(),
    minBalance: z.coerce.number().optional(),
  }).strict(),
  response: { list: 'Account' },
  handler: (req, res) => {
    const q = req.v.query;
    const u = req.user;
    let list;
    if (isCustomer(u)) {
      const own = accountIdsForCustomer(u.customerId);
      list = db.accounts.filter((a) => own.includes(a.id));
    } else {
      const scope = branchScope(u);
      list = db.accounts.filter((a) => scope == null || a.branchId === scope);
      if (q.branchId) list = list.filter((a) => a.branchId === q.branchId);
      if (q.customerId) { const ids = accountIdsForCustomer(q.customerId); list = list.filter((a) => ids.includes(a.id)); }
    }
    list = list.filter((a) => (!q.type || a.type === q.type) && (!q.status || a.status === q.status)
      && (q.minBalance == null || a.balanceCents >= toCents(q.minBalance))
      && includesText([a.accountNumber, a.nickname, ...holderCustomerIds(a.id).map((cid) => { const c = findById('customers', cid); return c && fullName(c); })], q.search));
    const page = paginate(list, q, { accountNumber: (a) => a.accountNumber, balance: (a) => a.balanceCents, openedAt: (a) => a.openedAt, lastActivityAt: (a) => a.lastActivityAt, status: (a) => a.status }, 'openedAt');
    res.json({ data: page.items.map(ser.account), pagination: page.pagination });
  },
});

route({
  method: 'post', path: '/accounts', tag: TAG, permission: 'accounts:open', status: 201, businessRules: true,
  summary: 'Open a savings, checking or fixed deposit account',
  description: 'The customer must be active with verified identity. Savings/checking accounts need an opening cash deposit of at least the configured minimum; fixed deposits are funded from one of the customer\'s active accounts.',
  body: z.object({
    customerId: s.id,
    type: z.enum(['savings', 'checking', 'fixed_deposit']),
    nickname: z.string().trim().max(40).optional(),
    initialDeposit: s.amount.optional(),
    fixedDeposit: z.object({ amount: s.amount, termMonths: z.union([z.literal(6), z.literal(12), z.literal(24), z.literal(36)]), fundingAccountId: s.id }).strict().optional(),
  }).strict(),
  response: 'Account',
  handler: (req, res) => {
    const b = req.v.body;
    const c = loadCustomer(req.user, b.customerId);
    if (c.status !== 'active' || c.kycStatus !== 'verified') throw unprocessable('CUSTOMER_NOT_ELIGIBLE', 'Customer must be active with verified identity to open an account');
    const now = nowIso();
    const branch = findById('branches', c.branchId);
    let funding = null;
    if (b.type === 'fixed_deposit') {
      if (!b.fixedDeposit) throw badRequest('fixedDeposit details are required for fixed deposit accounts');
      funding = findById('accounts', b.fixedDeposit.fundingAccountId);
      if (!funding || !accountIdsForCustomer(c.id).includes(funding.id)) throw badRequest('fundingAccountId must be one of the customer\'s accounts');
      if (toCents(b.fixedDeposit.amount) < 100000) throw unprocessable('MINIMUM_NOT_MET', 'Fixed deposits require at least $1,000.00');
      ledger.assertCanDebit(funding);
      ledger.assertFunds(funding, toCents(b.fixedDeposit.amount));
    } else {
      if (b.fixedDeposit) throw badRequest('fixedDeposit is only valid for fixed deposit accounts');
      const min = setting('minimumOpeningDeposit');
      if (!b.initialDeposit || b.initialDeposit < min) throw unprocessable('MINIMUM_NOT_MET', `An opening deposit of at least $${min} is required`);
      if (toCents(b.initialDeposit) > branch.limits.largeDepositThreshold * 100) throw unprocessable('LIMIT_EXCEEDED', 'Opening deposits above the branch large-deposit threshold must be made via a reviewed cash deposit');
    }
    const a = {
      id: nextId('accounts'), accountNumber: newAccountNumber(c.branchId), branchId: c.branchId, type: b.type, currency: 'USD',
      status: 'active', statusReason: null, balanceCents: 0, holdCents: 0, overdraftLimitCents: 0,
      interestRate: b.type === 'savings' ? 2.35 : b.type === 'fixed_deposit' ? ({ 6: 4.25, 12: 4.6, 24: 4.75, 36: 4.9 })[b.fixedDeposit.termMonths] : 0.05,
      nickname: b.nickname || null, fixedDeposit: null, openedAt: now, openedBy: req.user.id, closedAt: null, lastActivityAt: now, updatedAt: now,
    };
    db.accounts.push(a);
    db.accountHolders.push({ accountId: a.id, customerId: c.id, holderType: 'primary', addedAt: now });
    if (b.type === 'fixed_deposit') {
      const amountCents = toCents(b.fixedDeposit.amount);
      a.fixedDeposit = { principalCents: amountCents, termMonths: b.fixedDeposit.termMonths, maturityDate: new Date(Date.now() + b.fixedDeposit.termMonths * 30 * 86400000).toISOString(), linkedAccountId: funding.id };
      ledger.internalPosting(req, { type: 'transfer', source: funding, destination: a, amountCents, description: `Fixed deposit placement (${b.fixedDeposit.termMonths} months)`, customerId: c.id });
    } else {
      ledger.internalPosting(req, { type: 'deposit', destination: a, amountCents: toCents(b.initialDeposit), description: 'Opening deposit', customerId: c.id });
    }
    audit(req, { action: 'account.open', entityType: 'account', entityId: a.id, branchId: a.branchId, details: { type: a.type, customerId: c.id } });
    notifyCustomer(c.id, { type: 'service', title: 'New account opened', message: `Your ${a.type.replace('_', ' ')} account ending ${a.accountNumber.slice(-4)} is ready.`, link: `/accounts/${a.id}` });
    res.status(201).json({ data: ser.account(a) });
  },
});

route({
  method: 'get', path: '/accounts/:id', tag: TAG, permission: READ,
  summary: 'Get account details',
  params: s.idParams,
  response: 'Account',
  handler: (req, res) => res.json({ data: ser.account(loadAccount(req.user, req.v.params.id)) }),
});

route({
  method: 'patch', path: '/accounts/:id', tag: TAG, permission: ['accounts:update', 'portal:accounts'],
  summary: 'Rename an account (nickname)',
  description: 'Only the nickname is editable. Balances, status and ownership cannot be changed through this endpoint; unknown fields are rejected.',
  params: s.idParams,
  body: z.object({ nickname: z.string().trim().max(40).nullable() }).strict(),
  response: 'Account',
  handler: (req, res) => {
    const a = loadAccount(req.user, req.v.params.id);
    if (a.status === 'closed') throw conflict('Closed accounts cannot be modified');
    a.nickname = req.v.body.nickname || null;
    a.updatedAt = nowIso();
    audit(req, { action: 'account.rename', entityType: 'account', entityId: a.id, branchId: a.branchId });
    res.json({ data: ser.account(a) });
  },
});

route({
  method: 'put', path: '/accounts/:id/overdraft', tag: TAG, permission: 'accounts:update', risk: 'high', businessRules: true,
  summary: 'Set the overdraft limit of a checking account',
  params: s.idParams,
  body: z.object({ overdraftLimit: z.number().min(0).max(1000000), reason: s.text(300) }).strict(),
  response: 'Account',
  handler: (req, res) => {
    const a = loadAccount(req.user, req.v.params.id);
    const limitCents = toCents(req.v.body.overdraftLimit);
    if (a.type !== 'checking') throw unprocessable('NOT_ALLOWED', 'Overdrafts are only available on checking accounts');
    if (a.status !== 'active') throw unprocessable('ACCOUNT_NOT_ACTIVE', `Account is ${a.status}`);
    if (limitCents > setting('maxOverdraftLimit') * 100) throw unprocessable('LIMIT_EXCEEDED', `Overdraft cannot exceed $${setting('maxOverdraftLimit')}`);
    if (a.balanceCents - a.holdCents < -limitCents) throw unprocessable('OVERDRAFT_IN_USE', 'The account currently uses more overdraft than the requested limit');
    const before = a.overdraftLimitCents;
    a.overdraftLimitCents = limitCents;
    a.updatedAt = nowIso();
    audit(req, { action: 'account.overdraft_change', entityType: 'account', entityId: a.id, branchId: a.branchId, riskLevel: 'high', details: { from: fromCents(before), to: req.v.body.overdraftLimit, reason: req.v.body.reason } });
    res.json({ data: ser.account(a) });
  },
});

route({
  method: 'get', path: '/accounts/:id/balance', tag: TAG, permission: READ,
  summary: 'Ledger and available balance',
  params: s.idParams,
  response: 'Balance',
  handler: (req, res) => {
    const a = loadAccount(req.user, req.v.params.id);
    res.json({ data: { accountId: a.id, currency: a.currency, ledgerBalance: fromCents(a.balanceCents), availableBalance: a.status === 'closed' ? 0 : fromCents(ledger.available(a)), holdAmount: fromCents(a.holdCents), overdraftLimit: fromCents(a.overdraftLimitCents), asOf: nowIso() } });
  },
});

route({
  method: 'get', path: '/accounts/:id/limits', tag: TAG, permission: READ,
  summary: 'Effective transaction limits and today\'s usage for an account',
  params: s.idParams,
  response: 'AccountLimits',
  handler: (req, res) => {
    const a = loadAccount(req.user, req.v.params.id);
    const branch = findById('branches', a.branchId);
    const onlineUsed = ledger.debitedToday(a.id, (t) => t.channel === 'online');
    const cashUsed = ledger.debitedToday(a.id, (t) => t.channel === 'branch' && t.type === 'withdrawal');
    res.json({
      data: {
        accountId: a.id,
        online: { perTransaction: setting('customerPerTransactionLimit'), daily: setting('customerDailyTransferLimit'), usedToday: fromCents(onlineUsed), remainingToday: Math.max(0, setting('customerDailyTransferLimit') - fromCents(onlineUsed)), approvalThreshold: setting('customerApprovalThreshold'), newBeneficiaryLimit: setting('newBeneficiaryLimit') },
        branch: { dailyCashWithdrawal: branch.limits.dailyCashWithdrawalLimit, cashUsedToday: fromCents(cashUsed), tellerCashWithdrawalLimit: branch.limits.tellerCashWithdrawalLimit, approvalThreshold: branch.limits.approvalThreshold },
      },
    });
  },
});

function accountActivity(a, q) {
  return db.transactions
    .filter((t) => (t.sourceAccountId === a.id || t.destinationAccountId === a.id) && inDateRange(t.createdAt, q.from, q.to)
      && (!q.type || t.type === q.type) && (!q.status || t.status === q.status)
      && (!q.direction || (q.direction === 'debit' ? t.sourceAccountId === a.id : t.destinationAccountId === a.id))
      && includesText([t.reference, t.description], q.search));
}

route({
  method: 'get', path: '/accounts/:id/transactions', tag: TAG, permission: ['transactions:read', 'portal:accounts'],
  summary: 'Transaction history of an account',
  params: s.idParams,
  query: z.object({
    ...s.paging, from: s.dateOrDateTime.optional(), to: s.dateOrDateTime.optional(),
    type: z.enum(['deposit', 'withdrawal', 'transfer', 'reversal', 'fee', 'interest', 'fd_closure']).optional(),
    status: z.enum(['pending_approval', 'completed', 'rejected', 'reversed', 'cancelled']).optional(),
    direction: z.enum(['debit', 'credit']).optional(),
  }).strict(),
  response: { list: 'AccountTransaction' },
  handler: (req, res) => {
    const a = loadAccount(req.user, req.v.params.id);
    const q = req.v.query;
    const page = paginate(accountActivity(a, q), q, { createdAt: (t) => t.createdAt, amount: (t) => t.amountCents }, 'createdAt');
    res.json({
      data: page.items.map((t) => ({ ...ser.transaction(t, req.user), direction: t.sourceAccountId === a.id ? 'debit' : 'credit', balanceAfter: t.sourceAccountId === a.id ? (t.sourceBalanceAfterCents == null ? null : fromCents(t.sourceBalanceAfterCents)) : (t.destinationBalanceAfterCents == null ? null : fromCents(t.destinationBalanceAfterCents)) })),
      pagination: page.pagination,
    });
  },
});

function buildStatement(a, from, to) {
  const entries = db.ledgerEntries.filter((e) => e.accountId === a.id).sort((x, y) => (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : x.id - y.id));
  const before = entries.filter((e) => e.createdAt < from);
  const inRange = entries.filter((e) => inDateRange(e.createdAt, from, to));
  const opening = before.length ? before[before.length - 1].balanceAfterCents : 0;
  const closing = inRange.length ? inRange[inRange.length - 1].balanceAfterCents : opening;
  const lines = inRange.map((e) => {
    const t = findById('transactions', e.transactionId);
    return { date: e.createdAt, reference: t.reference, description: t.description, type: t.type, debit: e.direction === 'debit' ? fromCents(e.amountCents) : null, credit: e.direction === 'credit' ? fromCents(e.amountCents) : null, balance: fromCents(e.balanceAfterCents) };
  });
  return {
    account: { id: a.id, accountNumber: a.accountNumber, type: a.type, holders: ser.account(a).holders.map((h) => h.name), branch: findById('branches', a.branchId).name },
    period: { from, to },
    openingBalance: fromCents(opening),
    closingBalance: fromCents(closing),
    totalDebits: fromCents(inRange.filter((e) => e.direction === 'debit').reduce((sum, e) => sum + e.amountCents, 0)),
    totalCredits: fromCents(inRange.filter((e) => e.direction === 'credit').reduce((sum, e) => sum + e.amountCents, 0)),
    lines,
    generatedAt: nowIso(),
  };
}

const statementQuery = z.object({ from: s.date, to: s.date }).strict()
  .refine((q) => q.from <= q.to, 'from must be on or before to')
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 366 * 86400000, 'statement period cannot exceed one year');

route({
  method: 'get', path: '/accounts/:id/statement', tag: TAG, permission: ['transactions:read', 'portal:accounts'],
  summary: 'Account statement for a period (JSON)',
  params: s.idParams,
  query: statementQuery,
  response: 'Statement',
  handler: (req, res) => {
    const a = loadAccount(req.user, req.v.params.id);
    const st = buildStatement(a, req.v.query.from, req.v.query.to);
    audit(req, { action: 'account.statement_view', entityType: 'account', entityId: a.id, branchId: a.branchId });
    res.json({ data: st });
  },
});

const escHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

route({
  method: 'get', path: '/accounts/:id/statement/download', tag: TAG, permission: ['transactions:read', 'portal:accounts'], produces: 'text/csv',
  summary: 'Download an account statement (CSV or printable HTML)',
  params: s.idParams,
  query: z.object({ from: s.date, to: s.date, format: z.enum(['csv', 'html']).default('csv') }).strict().refine((q) => q.from <= q.to, 'from must be on or before to'),
  handler: (req, res) => {
    const a = loadAccount(req.user, req.v.params.id);
    const { from, to, format } = req.v.query;
    const st = buildStatement(a, from, to);
    audit(req, { action: 'account.statement_download', entityType: 'account', entityId: a.id, branchId: a.branchId, details: { from, to, format } });
    const filename = `statement-${a.accountNumber.slice(-4)}-${from}-to-${to}`;
    if (format === 'csv') {
      return res.type('text/csv').attachment(`${filename}.csv`).send(toCsv(st.lines, [
        { label: 'date', value: (l) => l.date }, { label: 'reference', value: (l) => l.reference }, { label: 'description', value: (l) => l.description },
        { label: 'debit', value: (l) => l.debit }, { label: 'credit', value: (l) => l.credit }, { label: 'balance', value: (l) => l.balance },
      ]));
    }
    const rows = st.lines.map((l) => `<tr><td>${escHtml(l.date.slice(0, 10))}</td><td>${escHtml(l.reference)}</td><td>${escHtml(l.description)}</td><td class="n">${l.debit ?? ''}</td><td class="n">${l.credit ?? ''}</td><td class="n">${l.balance.toFixed(2)}</td></tr>`).join('');
    return res.type('text/html').attachment(`${filename}.html`).send(`<!doctype html><html><head><meta charset="utf-8"><title>Statement ${escHtml(a.accountNumber)}</title><style>body{font-family:system-ui,sans-serif;margin:32px;color:#111}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left}.n{text-align:right}h1{margin:0}</style></head><body><h1>Kestrel Bank</h1><p>Simulated statement - not a real financial document</p><p><b>Account:</b> ${escHtml(a.accountNumber)} (${escHtml(a.type)})<br><b>Holders:</b> ${escHtml(st.account.holders.join(', '))}<br><b>Period:</b> ${from} to ${to}</p><p><b>Opening balance:</b> ${st.openingBalance.toFixed(2)} &nbsp; <b>Closing balance:</b> ${st.closingBalance.toFixed(2)}</p><table><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
  },
});

// ---------------------------------------------------------- lifecycle ----
function lifecycle({ path, summary, from, to, action, permission = 'accounts:freeze', check }) {
  route({
    method: 'post', path, tag: TAG, permission, risk: 'high', businessRules: true,
    summary,
    params: s.idParams,
    body: z.object({ reason: s.text(300) }).strict(),
    response: 'Account',
    handler: (req, res) => {
      const a = loadAccount(req.user, req.v.params.id);
      if (!from.includes(a.status)) throw conflict(`Account is ${a.status}; this action requires status ${from.join(' or ')}`);
      if (check) check(a);
      a.status = to;
      a.statusReason = req.v.body.reason;
      a.updatedAt = nowIso();
      if (to === 'active') a.lastActivityAt = a.updatedAt;
      audit(req, { action: `account.${action}`, entityType: 'account', entityId: a.id, branchId: a.branchId, riskLevel: 'high', details: { reason: req.v.body.reason } });
      holderCustomerIds(a.id).forEach((cid) => notifyCustomer(cid, { type: 'security', title: `Account ${action === 'freeze' ? 'frozen' : action === 'unfreeze' ? 'unfrozen' : 'reactivated'}`, message: `Your account ending ${a.accountNumber.slice(-4)} is now ${to}.`, link: `/accounts/${a.id}` }));
      res.json({ data: ser.account(a) });
    },
  });
}

const holdersActive = (a) => {
  const blocked = holderCustomerIds(a.id).map((cid) => findById('customers', cid)).filter((c) => c.status !== 'active');
  if (blocked.length) throw unprocessable('CUSTOMER_NOT_ELIGIBLE', 'All account holders must be active before the account can be re-enabled');
};

lifecycle({ path: '/accounts/:id/freeze', summary: 'Freeze an account (blocks debits and credits)', from: ['active', 'dormant'], to: 'frozen', action: 'freeze' });
lifecycle({ path: '/accounts/:id/unfreeze', summary: 'Unfreeze an account', from: ['frozen'], to: 'active', action: 'unfreeze', check: holdersActive });
lifecycle({ path: '/accounts/:id/reactivate', summary: 'Reactivate a dormant account', from: ['dormant'], to: 'active', action: 'reactivate', check: holdersActive });

route({
  method: 'post', path: '/accounts/:id/close', tag: TAG, permission: 'accounts:close', risk: 'critical', businessRules: true,
  summary: 'Close an account',
  description: 'The account must have no holds or pending transactions and a non-negative balance. A remaining balance is transferred to another account of the same primary holder.',
  params: s.idParams,
  body: z.object({ reason: s.text(300), transferToAccountId: s.id.optional() }).strict(),
  response: 'Account',
  handler: (req, res) => {
    const a = loadAccount(req.user, req.v.params.id);
    const { reason, transferToAccountId } = req.v.body;
    if (a.status === 'closed') throw conflict('Account is already closed');
    if (a.type === 'fixed_deposit') throw unprocessable('NOT_ALLOWED', 'Use the break-deposit endpoint to close a fixed deposit');
    if (a.status === 'frozen') throw unprocessable('ACCOUNT_NOT_ACTIVE', 'Frozen accounts cannot be closed until the freeze is lifted');
    if (a.holdCents > 0 || db.transactions.some((t) => t.status === 'pending_approval' && (t.sourceAccountId === a.id || t.destinationAccountId === a.id))) {
      throw unprocessable('PENDING_ACTIVITY', 'Resolve pending transactions before closing the account');
    }
    if (a.balanceCents < 0) throw unprocessable('NEGATIVE_BALANCE', 'Overdrawn accounts must be settled before closure');
    if (a.balanceCents > 0) {
      if (!transferToAccountId) throw unprocessable('BALANCE_REMAINING', 'Account has a remaining balance; provide transferToAccountId');
      const primary = db.accountHolders.find((h) => h.accountId === a.id && h.holderType === 'primary').customerId;
      const target = findById('accounts', transferToAccountId);
      if (!target || target.id === a.id || !accountIdsForCustomer(primary).includes(target.id)) throw badRequest('transferToAccountId must be another account of the primary holder');
      ledger.assertCanCredit(target);
      ledger.internalPosting(req, { type: 'transfer', source: a, destination: target, amountCents: a.balanceCents, description: `Closure payout from account ending ${a.accountNumber.slice(-4)}`, customerId: primary });
    }
    a.status = 'closed';
    a.statusReason = reason;
    a.closedAt = nowIso();
    a.overdraftLimitCents = 0;
    a.updatedAt = a.closedAt;
    audit(req, { action: 'account.close', entityType: 'account', entityId: a.id, branchId: a.branchId, riskLevel: 'critical', details: { reason } });
    holderCustomerIds(a.id).forEach((cid) => notifyCustomer(cid, { type: 'service', title: 'Account closed', message: `Your account ending ${a.accountNumber.slice(-4)} has been closed.` }));
    res.json({ data: ser.account(a) });
  },
});

route({
  method: 'post', path: '/accounts/:id/break-deposit', tag: TAG, permission: 'accounts:close', risk: 'high', businessRules: true,
  summary: 'Break a fixed deposit early (penalty applies) or pay out at maturity',
  params: s.idParams,
  body: z.object({ reason: s.text(300) }).strict(),
  response: 'FixedDepositClosure',
  handler: (req, res) => {
    const a = loadAccount(req.user, req.v.params.id);
    if (a.type !== 'fixed_deposit') throw unprocessable('NOT_ALLOWED', 'Only fixed deposit accounts can be broken');
    if (a.status !== 'active') throw unprocessable('ACCOUNT_NOT_ACTIVE', `Fixed deposit is ${a.status}`);
    const target = findById('accounts', a.fixedDeposit.linkedAccountId);
    if (!target || target.status === 'closed' || target.status === 'frozen') throw unprocessable('LINKED_ACCOUNT_UNAVAILABLE', 'The linked payout account cannot receive funds');
    const matured = a.fixedDeposit.maturityDate <= nowIso();
    const penaltyCents = matured ? 0 : Math.round(a.balanceCents * (setting('fdPrematurePenaltyRate') / 100));
    const primary = holderCustomerIds(a.id)[0];
    if (penaltyCents > 0) ledger.internalPosting(req, { type: 'fee', source: a, amountCents: penaltyCents, description: 'Premature withdrawal penalty', customerId: primary });
    const payout = a.balanceCents;
    if (payout > 0) ledger.internalPosting(req, { type: 'fd_closure', source: a, destination: target, amountCents: payout, description: `Fixed deposit ${matured ? 'maturity' : 'early'} payout`, customerId: primary });
    a.status = 'closed';
    a.statusReason = req.v.body.reason;
    a.closedAt = nowIso();
    audit(req, { action: 'account.break_deposit', entityType: 'account', entityId: a.id, branchId: a.branchId, riskLevel: 'high', details: { matured, penalty: fromCents(penaltyCents), payout: fromCents(payout) } });
    res.json({ data: { account: ser.account(a), matured, penalty: fromCents(penaltyCents), payout: fromCents(payout), creditedAccountId: target.id } });
  },
});

// ------------------------------------------------------------ holders ----
route({
  method: 'get', path: '/accounts/:id/holders', tag: TAG, permission: READ,
  summary: 'List account holders',
  params: s.idParams,
  response: { array: 'AccountHolder' },
  handler: (req, res) => res.json({ data: ser.account(loadAccount(req.user, req.v.params.id)).holders }),
});

route({
  method: 'post', path: '/accounts/:id/holders', tag: TAG, permission: 'accounts:holders', status: 201, risk: 'high', businessRules: true,
  summary: 'Add a joint holder to an account',
  params: s.idParams,
  body: z.object({ customerId: s.id }).strict(),
  response: { array: 'AccountHolder' },
  handler: (req, res) => {
    const a = loadAccount(req.user, req.v.params.id);
    const c = loadCustomer(req.user, req.v.body.customerId);
    if (a.status === 'closed') throw conflict('Account is closed');
    if (a.type === 'fixed_deposit') throw unprocessable('NOT_ALLOWED', 'Joint holders cannot be added to fixed deposits');
    if (c.status !== 'active' || c.kycStatus !== 'verified') throw unprocessable('CUSTOMER_NOT_ELIGIBLE', 'Joint holder must be active with verified identity');
    const holders = holderCustomerIds(a.id);
    if (holders.includes(c.id)) throw conflict('Customer is already a holder of this account');
    if (holders.length >= 4) throw unprocessable('LIMIT_EXCEEDED', 'An account can have at most 4 holders');
    db.accountHolders.push({ accountId: a.id, customerId: c.id, holderType: 'joint', addedAt: nowIso() });
    audit(req, { action: 'account.holder_add', entityType: 'account', entityId: a.id, branchId: a.branchId, riskLevel: 'high', details: { customerId: c.id } });
    holderCustomerIds(a.id).forEach((cid) => notifyCustomer(cid, { type: 'security', title: 'Joint holder added', message: `${fullName(c)} was added as a joint holder on account ending ${a.accountNumber.slice(-4)}.` }));
    res.status(201).json({ data: ser.account(a).holders });
  },
});

route({
  method: 'delete', path: '/accounts/:id/holders/:customerId', tag: TAG, permission: 'accounts:holders', risk: 'high',
  summary: 'Remove a joint holder (the primary holder cannot be removed)',
  params: z.object({ id: s.id, customerId: s.id }).strict(),
  response: { array: 'AccountHolder' },
  handler: (req, res) => {
    const a = loadAccount(req.user, req.v.params.id);
    const idx = db.accountHolders.findIndex((h) => h.accountId === a.id && h.customerId === req.v.params.customerId);
    if (idx < 0) throw notFound('Account holder');
    if (db.accountHolders[idx].holderType === 'primary') throw conflict('The primary holder cannot be removed');
    db.accountHolders.splice(idx, 1);
    audit(req, { action: 'account.holder_remove', entityType: 'account', entityId: a.id, branchId: a.branchId, riskLevel: 'high', details: { customerId: req.v.params.customerId } });
    res.json({ data: ser.account(a).holders });
  },
});
