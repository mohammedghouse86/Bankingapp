const crypto = require('crypto');
const { route } = require('../lib/registry');
const { db, nextId, findById } = require('../store');
const s = require('../lib/schemas');
const { z } = s;
const ser = require('../lib/serializers');
const { ApiError, badRequest, conflict, notFound, unprocessable } = require('../lib/errors');
const { nowIso, sha256, toCents, paginate, includesText } = require('../lib/util');
const { audit } = require('../lib/audit');
const { notifyUser, sendEmail, setting } = require('../lib/notify');
const { isCustomer, loadCustomer, accountIdsForCustomer, canAccessCustomer } = require('../lib/scope');

const TAG = 'Beneficiaries';
const READ = ['portal:beneficiaries', 'customers:read'];
const MANAGE = { roles: ['customer'], permission: 'portal:beneficiaries' };
const MAX_BENEFICIARIES = 25;
const OTP_TTL_MS = 10 * 60000;

function loadBeneficiary(u, id) {
  const b = findById('beneficiaries', id);
  if (!b || b.status === 'deleted') throw notFound('Beneficiary');
  if (isCustomer(u) ? b.customerId !== u.customerId : !canAccessCustomer(u, findById('customers', b.customerId))) throw notFound('Beneficiary');
  return b;
}

/** Simulated OTP: the code is delivered as an in-app notification and an outbox email. */
function issueActivationCode(req, b) {
  const code = String(crypto.randomInt(100000, 1000000));
  b.activationCodeHash = sha256(`${b.id}:${code}`);
  b.activationExpiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  b.activationAttempts = 0;
  notifyUser(req.user.id, { type: 'security', title: 'Beneficiary activation code', message: `Your code to activate payee "${b.nickname || b.name}" is ${code}. It expires in 10 minutes. Never share this code.`, link: `/beneficiaries/${b.id}` });
  sendEmail(req.user.email, 'Your beneficiary activation code', `Activation code: ${code} (valid 10 minutes).`);
}

route({
  method: 'get', path: '/beneficiaries', tag: TAG, permission: READ,
  summary: 'List beneficiaries (customers: own; staff: require customerId)',
  query: z.object({ ...s.paging, customerId: s.id.optional(), status: z.enum(['pending_activation', 'active', 'disabled']).optional(), isInternal: z.enum(['true', 'false']).optional() }).strict(),
  response: { list: 'Beneficiary' },
  handler: (req, res) => {
    const q = req.v.query;
    let customerId;
    if (isCustomer(req.user)) {
      if (q.customerId && q.customerId !== req.user.customerId) throw notFound('Customer');
      customerId = req.user.customerId;
    } else {
      if (!q.customerId) throw badRequest('customerId is required for staff');
      customerId = loadCustomer(req.user, q.customerId).id;
    }
    const list = db.beneficiaries.filter((b) => b.customerId === customerId && b.status !== 'deleted' && (!q.status || b.status === q.status)
      && (!q.isInternal || String(b.isInternal) === q.isInternal) && includesText([b.name, b.nickname, b.bankName], q.search));
    const page = paginate(list, q, { name: (b) => b.name.toLowerCase(), createdAt: (b) => b.createdAt }, 'name');
    res.json({ data: page.items.map((b) => ser.beneficiary(b, req.user)), pagination: page.pagination });
  },
});

route({
  method: 'post', path: '/beneficiaries', tag: TAG, ...MANAGE, status: 201, conflicts: true, businessRules: true, risk: 'high',
  summary: 'Register a new beneficiary (requires OTP activation)',
  description: 'Kestrel Bank routing numbers register internal payees (the account must exist and accept credits). The beneficiary stays `pending_activation` until the code sent to the customer is confirmed.',
  body: z.object({
    name: z.string().trim().min(2).max(80),
    nickname: z.string().trim().max(40).optional(),
    accountNumber: z.string().regex(/^\d{8,17}$/, 'accountNumber must be 8-17 digits'),
    routingNumber: z.string().regex(/^\d{9}$/, 'routingNumber must be 9 digits'),
    bankName: z.string().trim().min(2).max(80).optional(),
    dailyLimit: z.number().positive().max(1000000).optional(),
  }).strict(),
  response: 'Beneficiary',
  handler: (req, res) => {
    const b = req.v.body;
    const customerId = req.user.customerId;
    const existing = db.beneficiaries.filter((x) => x.customerId === customerId && x.status !== 'deleted');
    if (existing.length >= MAX_BENEFICIARIES) throw unprocessable('LIMIT_EXCEEDED', `You can register at most ${MAX_BENEFICIARIES} beneficiaries`);
    if (existing.some((x) => x.accountNumber === b.accountNumber && x.routingNumber === b.routingNumber)) throw conflict('This beneficiary is already registered');
    const internalBranch = db.branches.find((br) => br.routingNumber === b.routingNumber);
    let internalAccountId = null;
    if (internalBranch) {
      const acc = db.accounts.find((a) => a.accountNumber === b.accountNumber && a.branchId === internalBranch.id);
      if (!acc) throw unprocessable('ACCOUNT_NOT_FOUND', 'No Kestrel Bank account matches this account and routing number');
      if (accountIdsForCustomer(customerId).includes(acc.id)) throw unprocessable('OWN_ACCOUNT', 'Use an own-account transfer for your own accounts');
      if (acc.type === 'fixed_deposit' || ['closed', 'frozen'].includes(acc.status)) throw unprocessable('ACCOUNT_CANNOT_RECEIVE', 'This account cannot receive transfers');
      internalAccountId = acc.id;
    } else if (!b.bankName) {
      throw badRequest('bankName is required for external beneficiaries');
    }
    const dailyLimit = b.dailyLimit || Math.min(5000, setting('customerDailyTransferLimit'));
    if (dailyLimit > setting('customerDailyTransferLimit')) throw unprocessable('LIMIT_EXCEEDED', `Beneficiary daily limit cannot exceed $${setting('customerDailyTransferLimit')}`);
    const now = nowIso();
    const ben = {
      id: nextId('beneficiaries'), customerId, name: b.name, nickname: b.nickname || null, accountNumber: b.accountNumber,
      bankName: internalBranch ? 'Kestrel Bank' : b.bankName, routingNumber: b.routingNumber, isInternal: Boolean(internalBranch), internalAccountId,
      status: 'pending_activation', dailyLimitCents: toCents(dailyLimit), activationCodeHash: null, activationExpiresAt: null, activationAttempts: 0,
      activatedAt: null, createdAt: now, updatedAt: now,
    };
    db.beneficiaries.push(ben);
    issueActivationCode(req, ben);
    audit(req, { action: 'beneficiary.create', entityType: 'beneficiary', entityId: ben.id, branchId: findById('customers', customerId).branchId, riskLevel: 'high', details: { isInternal: ben.isInternal } });
    res.status(201).json({ data: ser.beneficiary(ben, req.user) });
  },
});

route({
  method: 'get', path: '/beneficiaries/:id', tag: TAG, permission: READ,
  summary: 'Get a beneficiary',
  params: s.idParams,
  response: 'Beneficiary',
  handler: (req, res) => res.json({ data: ser.beneficiary(loadBeneficiary(req.user, req.v.params.id), req.user) }),
});

route({
  method: 'patch', path: '/beneficiaries/:id', tag: TAG, ...MANAGE, businessRules: true,
  summary: 'Update beneficiary nickname or daily limit',
  description: 'Account and routing numbers cannot be changed; register a new beneficiary instead.',
  params: s.idParams,
  body: z.object({ nickname: z.string().trim().max(40).nullable().optional(), dailyLimit: z.number().positive().max(1000000).optional() }).strict()
    .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update'),
  response: 'Beneficiary',
  handler: (req, res) => {
    const b = loadBeneficiary(req.user, req.v.params.id);
    const { nickname, dailyLimit } = req.v.body;
    if (dailyLimit !== undefined) {
      if (dailyLimit > setting('customerDailyTransferLimit')) throw unprocessable('LIMIT_EXCEEDED', `Beneficiary daily limit cannot exceed $${setting('customerDailyTransferLimit')}`);
      b.dailyLimitCents = toCents(dailyLimit);
    }
    if (nickname !== undefined) b.nickname = nickname || null;
    b.updatedAt = nowIso();
    audit(req, { action: 'beneficiary.update', entityType: 'beneficiary', entityId: b.id, details: { fields: Object.keys(req.v.body) } });
    res.json({ data: ser.beneficiary(b, req.user) });
  },
});

route({
  method: 'delete', path: '/beneficiaries/:id', tag: TAG, ...MANAGE,
  summary: 'Delete a beneficiary',
  params: s.idParams,
  handler: (req, res) => {
    const b = loadBeneficiary(req.user, req.v.params.id);
    if (db.transactions.some((t) => t.beneficiaryId === b.id && t.status === 'pending_approval')) throw conflict('A pending transfer to this beneficiary must be resolved first');
    b.status = 'deleted';
    b.updatedAt = nowIso();
    audit(req, { action: 'beneficiary.delete', entityType: 'beneficiary', entityId: b.id });
    res.json({ data: { message: 'Beneficiary deleted' } });
  },
});

route({
  method: 'post', path: '/beneficiaries/:id/activate', tag: TAG, ...MANAGE, conflicts: true,
  summary: 'Activate a beneficiary with the one-time code',
  description: 'Five wrong attempts invalidate the code; request a new one with resend-code.',
  params: s.idParams,
  body: z.object({ code: z.string().regex(/^\d{6}$/, 'code must be 6 digits') }).strict(),
  response: 'Beneficiary',
  handler: (req, res) => {
    const b = loadBeneficiary(req.user, req.v.params.id);
    if (b.status !== 'pending_activation') throw conflict(`Beneficiary is ${b.status}`);
    if (!b.activationCodeHash || b.activationExpiresAt < nowIso()) throw new ApiError(410, 'CODE_EXPIRED', 'Activation code has expired; request a new one');
    if (sha256(`${b.id}:${req.v.body.code}`) !== b.activationCodeHash) {
      b.activationAttempts = (b.activationAttempts || 0) + 1;
      if (b.activationAttempts >= 5) b.activationCodeHash = null;
      audit(req, { action: 'beneficiary.activation_failed', entityType: 'beneficiary', entityId: b.id, outcome: 'denied', riskLevel: 'high', details: { attempts: b.activationAttempts } });
      throw unprocessable('INVALID_CODE', b.activationCodeHash ? 'Invalid activation code' : 'Too many invalid attempts; request a new code');
    }
    Object.assign(b, { status: 'active', activationCodeHash: null, activationExpiresAt: null, activatedAt: nowIso(), updatedAt: nowIso() });
    audit(req, { action: 'beneficiary.activate', entityType: 'beneficiary', entityId: b.id, riskLevel: 'high' });
    res.json({ data: ser.beneficiary(b, req.user) });
  },
});

route({
  method: 'post', path: '/beneficiaries/:id/resend-code', tag: TAG, ...MANAGE, conflicts: true,
  summary: 'Send a new activation code',
  params: s.idParams,
  handler: (req, res) => {
    const b = loadBeneficiary(req.user, req.v.params.id);
    if (b.status !== 'pending_activation') throw conflict(`Beneficiary is ${b.status}`);
    issueActivationCode(req, b);
    res.json({ data: { message: 'A new activation code has been sent to your notifications' } });
  },
});

route({
  method: 'post', path: '/beneficiaries/:id/disable', tag: TAG, ...MANAGE, conflicts: true,
  summary: 'Temporarily disable a beneficiary',
  params: s.idParams,
  response: 'Beneficiary',
  handler: (req, res) => {
    const b = loadBeneficiary(req.user, req.v.params.id);
    if (b.status !== 'active') throw conflict(`Beneficiary is ${b.status}`);
    b.status = 'disabled';
    b.updatedAt = nowIso();
    audit(req, { action: 'beneficiary.disable', entityType: 'beneficiary', entityId: b.id });
    res.json({ data: ser.beneficiary(b, req.user) });
  },
});

route({
  method: 'post', path: '/beneficiaries/:id/enable', tag: TAG, ...MANAGE, conflicts: true,
  summary: 'Re-enable a disabled beneficiary (requires a new activation code)',
  params: s.idParams,
  response: 'Beneficiary',
  handler: (req, res) => {
    const b = loadBeneficiary(req.user, req.v.params.id);
    if (b.status !== 'disabled') throw conflict(`Beneficiary is ${b.status}`);
    b.status = 'pending_activation';
    b.updatedAt = nowIso();
    issueActivationCode(req, b);
    audit(req, { action: 'beneficiary.enable_requested', entityType: 'beneficiary', entityId: b.id });
    res.json({ data: ser.beneficiary(b, req.user) });
  },
});

route({
  method: 'get', path: '/beneficiaries/:id/transfers', tag: TAG, permission: READ,
  summary: 'Transfers made to a beneficiary',
  params: s.idParams,
  query: s.pagingQuery,
  response: { list: 'Transaction' },
  handler: (req, res) => {
    const b = loadBeneficiary(req.user, req.v.params.id);
    const page = paginate(db.transactions.filter((t) => t.beneficiaryId === b.id), req.v.query, { createdAt: (t) => t.createdAt, amount: (t) => t.amountCents }, 'createdAt');
    res.json({ data: page.items.map((t) => ser.transaction(t, req.user)), pagination: page.pagination });
  },
});
