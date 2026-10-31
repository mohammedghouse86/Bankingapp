const { route } = require('../lib/registry');
const { db, nextId, findById } = require('../store');
const s = require('../lib/schemas');
const { z } = s;
const ser = require('../lib/serializers');
const { badRequest, conflict, notFound, unprocessable } = require('../lib/errors');
const { nowIso, paginate, includesText, fromCents } = require('../lib/util');
const { audit } = require('../lib/audit');
const { setting } = require('../lib/notify');
const { isGlobal } = require('../lib/scope');

const TAG = 'Branches';

function loadBranch(id) {
  const b = findById('branches', id);
  if (!b) throw notFound('Branch');
  return b;
}

/** Managers may only operate on their own branch; global roles on any. */
function loadOwnBranch(u, id) {
  const b = loadBranch(id);
  if (!isGlobal(u) && u.branchId !== b.id) throw notFound('Branch');
  return b;
}

const limitsSchema = z.object({
  approvalThreshold: z.number().int().min(100),
  tellerCashWithdrawalLimit: z.number().int().min(100),
  dailyCashWithdrawalLimit: z.number().int().min(100),
  largeDepositThreshold: z.number().int().min(100),
}).strict();

function validateLimits(limits) {
  const caps = {
    approvalThreshold: setting('maxBranchApprovalThreshold'),
    tellerCashWithdrawalLimit: setting('maxTellerCashWithdrawalLimit'),
    dailyCashWithdrawalLimit: setting('maxDailyCashWithdrawalLimit'),
    largeDepositThreshold: setting('maxLargeDepositThreshold'),
  };
  const violations = Object.entries(limits).filter(([k, v]) => v > caps[k]).map(([k, v]) => ({ field: k, value: v, max: caps[k] }));
  if (violations.length) throw unprocessable('LIMIT_ABOVE_GLOBAL_CAP', 'Branch limits cannot exceed the global caps set by a super admin', violations);
  if (limits.tellerCashWithdrawalLimit > limits.dailyCashWithdrawalLimit) throw unprocessable('INVALID_LIMITS', 'tellerCashWithdrawalLimit cannot exceed dailyCashWithdrawalLimit');
}

route({
  method: 'get', path: '/branches', tag: TAG, permission: 'branches:read',
  summary: 'Branch directory',
  query: z.object({ ...s.paging, status: z.enum(['active', 'inactive']).optional() }).strict(),
  response: { list: 'Branch' },
  handler: (req, res) => {
    const q = req.v.query;
    const list = db.branches.filter((b) => (!q.status || b.status === q.status) && includesText([b.name, b.code, b.address.city], q.search));
    const page = paginate(list, q, { name: (b) => b.name, code: (b) => b.code, openedAt: (b) => b.openedAt }, 'code');
    res.json({ data: page.items.map(ser.branch), pagination: page.pagination });
  },
});

route({
  method: 'post', path: '/branches', tag: TAG, permission: 'branches:manage', status: 201, risk: 'high', conflicts: true,
  summary: 'Open a new branch (super admin)',
  body: z.object({
    code: z.string().regex(/^KB\d{3}$/, 'code must look like KB005'),
    name: z.string().trim().min(2).max(60),
    address: s.address, phone: s.phone, email: s.email,
    tellersCanOnboard: z.boolean().default(true),
    limits: limitsSchema.optional(),
  }).strict(),
  response: 'Branch',
  handler: (req, res) => {
    const b = req.v.body;
    if (db.branches.some((x) => x.code === b.code)) throw conflict('Branch code already exists');
    const limits = b.limits || { approvalThreshold: 10000, tellerCashWithdrawalLimit: 5000, dailyCashWithdrawalLimit: 20000, largeDepositThreshold: 25000 };
    validateLimits(limits);
    const id = nextId('branches');
    const now = nowIso();
    const branch = { id, code: b.code, name: b.name, address: b.address, phone: b.phone, email: b.email, routingNumber: `99900010${id}`.slice(-9), status: 'active', managerId: null, openedAt: now, tellersCanOnboard: b.tellersCanOnboard, limits, updatedAt: now };
    db.branches.push(branch);
    audit(req, { action: 'branch.create', entityType: 'branch', entityId: id, branchId: id, riskLevel: 'high' });
    res.status(201).json({ data: ser.branch(branch) });
  },
});

route({
  method: 'get', path: '/branches/:id', tag: TAG, permission: 'branches:read',
  summary: 'Branch details',
  params: s.idParams,
  response: 'Branch',
  handler: (req, res) => res.json({ data: ser.branch(loadBranch(req.v.params.id)) }),
});

route({
  method: 'patch', path: '/branches/:id', tag: TAG, permission: 'branches:manage',
  summary: 'Update branch details (super admin)',
  params: s.idParams,
  body: z.object({ name: z.string().trim().min(2).max(60).optional(), address: s.address.optional(), phone: s.phone.optional(), email: s.email.optional(), tellersCanOnboard: z.boolean().optional() }).strict()
    .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update'),
  response: 'Branch',
  handler: (req, res) => {
    const b = loadBranch(req.v.params.id);
    Object.assign(b, req.v.body, { updatedAt: nowIso() });
    audit(req, { action: 'branch.update', entityType: 'branch', entityId: b.id, branchId: b.id, details: { fields: Object.keys(req.v.body) } });
    res.json({ data: ser.branch(b) });
  },
});

route({
  method: 'post', path: '/branches/:id/deactivate', tag: TAG, permission: 'branches:manage', risk: 'critical', conflicts: true,
  summary: 'Deactivate a branch (requires no open accounts or active staff)',
  params: s.idParams,
  body: z.object({ reason: s.text(300) }).strict(),
  response: 'Branch',
  handler: (req, res) => {
    const b = loadBranch(req.v.params.id);
    if (b.status === 'inactive') throw conflict('Branch is already inactive');
    const openAccounts = db.accounts.filter((a) => a.branchId === b.id && a.status !== 'closed').length;
    const staff = db.users.filter((u) => u.branchId === b.id && u.status === 'active').length;
    if (openAccounts || staff) throw conflict('Branch still has open accounts or active staff', { openAccounts, activeStaff: staff });
    b.status = 'inactive';
    b.updatedAt = nowIso();
    audit(req, { action: 'branch.deactivate', entityType: 'branch', entityId: b.id, branchId: b.id, riskLevel: 'critical', details: { reason: req.v.body.reason } });
    res.json({ data: ser.branch(b) });
  },
});

route({
  method: 'post', path: '/branches/:id/activate', tag: TAG, permission: 'branches:manage', risk: 'high', conflicts: true,
  summary: 'Re-activate a branch',
  params: s.idParams,
  response: 'Branch',
  handler: (req, res) => {
    const b = loadBranch(req.v.params.id);
    if (b.status === 'active') throw conflict('Branch is already active');
    b.status = 'active';
    b.updatedAt = nowIso();
    audit(req, { action: 'branch.activate', entityType: 'branch', entityId: b.id, branchId: b.id, riskLevel: 'high' });
    res.json({ data: ser.branch(b) });
  },
});

route({
  method: 'get', path: '/branches/:id/employees', tag: TAG, permission: 'users:read',
  summary: 'Employees of a branch (managers: own branch only)',
  params: s.idParams,
  query: s.pagingQuery,
  response: { list: 'User' },
  handler: (req, res) => {
    const b = loadOwnBranch(req.user, req.v.params.id);
    const list = db.users.filter((u) => u.branchId === b.id && ['manager', 'teller'].includes(u.role) && u.status !== 'deleted' && includesText([u.firstName, u.lastName, u.email], req.v.query.search));
    const page = paginate(list, req.v.query, { name: (u) => `${u.lastName} ${u.firstName}`, role: (u) => u.role }, 'name');
    res.json({ data: page.items.map(ser.user), pagination: page.pagination });
  },
});

route({
  method: 'get', path: '/branches/:id/stats', tag: TAG, permission: ['reports:branch', 'reports:system'],
  summary: 'Key figures for a branch',
  params: s.idParams,
  response: 'BranchStats',
  handler: (req, res) => {
    const b = loadOwnBranch(req.user, req.v.params.id);
    const accounts = db.accounts.filter((a) => a.branchId === b.id);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const txns = db.transactions.filter((t) => t.branchId === b.id && t.createdAt >= since);
    res.json({
      data: {
        branchId: b.id,
        customers: db.customers.filter((c) => c.branchId === b.id).length,
        activeCustomers: db.customers.filter((c) => c.branchId === b.id && c.status === 'active').length,
        accounts: accounts.length,
        accountsByStatus: accounts.reduce((m, a) => ({ ...m, [a.status]: (m[a.status] || 0) + 1 }), {}),
        totalDeposits: fromCents(accounts.filter((a) => a.status !== 'closed').reduce((sum, a) => sum + Math.max(0, a.balanceCents), 0)),
        employees: db.users.filter((u) => u.branchId === b.id && u.status === 'active' && u.role !== 'customer').length,
        transactionsLast30Days: txns.length,
        volumeLast30Days: fromCents(txns.filter((t) => t.status === 'completed').reduce((sum, t) => sum + t.amountCents, 0)),
        pendingApprovals: db.approvals.filter((a) => a.branchId === b.id && a.status === 'pending').length,
        openServiceRequests: db.serviceRequests.filter((r) => r.branchId === b.id && ['open', 'in_progress'].includes(r.status)).length,
      },
    });
  },
});

route({
  method: 'get', path: '/branches/:id/limits', tag: TAG, permission: ['branch_limits:manage', 'branches:read'],
  summary: 'Branch transaction limits and the global caps that bound them',
  params: s.idParams,
  response: 'BranchLimits',
  handler: (req, res) => {
    const b = loadBranch(req.v.params.id);
    res.json({ data: { branchId: b.id, limits: b.limits, caps: { approvalThreshold: setting('maxBranchApprovalThreshold'), tellerCashWithdrawalLimit: setting('maxTellerCashWithdrawalLimit'), dailyCashWithdrawalLimit: setting('maxDailyCashWithdrawalLimit'), largeDepositThreshold: setting('maxLargeDepositThreshold') } } });
  },
});

route({
  method: 'put', path: '/branches/:id/limits', tag: TAG, permission: 'branch_limits:manage', risk: 'high', businessRules: true,
  summary: 'Update branch transaction limits (within global caps)',
  params: s.idParams,
  body: limitsSchema.extend({ reason: s.text(300) }).strict(),
  response: 'BranchLimits',
  handler: (req, res) => {
    const b = loadOwnBranch(req.user, req.v.params.id);
    const { reason, ...limits } = req.v.body;
    validateLimits(limits);
    const before = b.limits;
    b.limits = limits;
    b.updatedAt = nowIso();
    audit(req, { action: 'branch.limits_update', entityType: 'branch', entityId: b.id, branchId: b.id, riskLevel: 'high', details: { before, after: limits, reason } });
    res.json({ data: { branchId: b.id, limits: b.limits } });
  },
});

route({
  method: 'put', path: '/branches/:id/manager', tag: TAG, permission: 'branches:manage', risk: 'high',
  summary: 'Assign the branch manager (super admin)',
  params: s.idParams,
  body: z.object({ userId: s.id }).strict(),
  response: 'Branch',
  handler: (req, res) => {
    const b = loadBranch(req.v.params.id);
    const u = findById('users', req.v.body.userId);
    if (!u || u.role !== 'manager' || u.status !== 'active' || u.branchId !== b.id) throw badRequest('User must be an active manager assigned to this branch');
    b.managerId = u.id;
    b.updatedAt = nowIso();
    audit(req, { action: 'branch.assign_manager', entityType: 'branch', entityId: b.id, branchId: b.id, riskLevel: 'high', details: { userId: u.id } });
    res.json({ data: ser.branch(b) });
  },
});
