const { route } = require('../lib/registry');
const { db, findById } = require('../store');
const s = require('../lib/schemas');
const { z } = s;
const ser = require('../lib/serializers');
const { forbidden } = require('../lib/errors');
const { fromCents, toCsv, startOfUtcDay } = require('../lib/util');
const { audit } = require('../lib/audit');
const { isGlobal, isCustomer, accountIdsForCustomer } = require('../lib/scope');
const { hasPermission } = require('../lib/permissions');

const TAG = 'Reports & Analytics';
const PERM = ['reports:branch', 'reports:system'];
const sum = (list, f) => list.reduce((acc, x) => acc + f(x), 0);
const daysAgoIso = (d) => new Date(Date.now() - d * 86400000).toISOString();

/** Managers are pinned to their branch; super admins / API keys may filter or see all. */
function reportBranch(req, requested) {
  if (isGlobal(req.user)) return requested || null;
  if (requested && requested !== req.user.branchId) throw forbidden('Managers can only report on their own branch');
  return req.user.branchId;
}

const inBranch = (branchId) => (x) => branchId == null || x.branchId === branchId;
const branchQuery = z.object({ branchId: s.id.optional() }).strict();

function volumeSeries(branchId, days) {
  const start = startOfUtcDay(new Date(Date.now() - (days - 1) * 86400000));
  const buckets = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    buckets.push({ date: d, count: 0, deposits: 0, withdrawals: 0, transfers: 0, total: 0 });
  }
  const index = Object.fromEntries(buckets.map((b, i) => [b.date, i]));
  db.transactions.filter((t) => (t.status === 'completed' || t.status === 'reversed') && t.createdAt >= start.toISOString() && inBranch(branchId)(t)).forEach((t) => {
    const b = buckets[index[t.createdAt.slice(0, 10)]];
    if (!b) return;
    const amt = fromCents(t.amountCents);
    b.count += 1;
    b.total += amt;
    if (t.type === 'deposit') b.deposits += amt;
    if (t.type === 'withdrawal') b.withdrawals += amt;
    if (t.type === 'transfer') b.transfers += amt;
  });
  return buckets.map((b) => ({ ...b, total: Math.round(b.total * 100) / 100, deposits: Math.round(b.deposits * 100) / 100, withdrawals: Math.round(b.withdrawals * 100) / 100, transfers: Math.round(b.transfers * 100) / 100 }));
}

function tellerPerformance(branchId, days) {
  const since = daysAgoIso(days);
  return db.users.filter((u) => u.role === 'teller' && u.status !== 'deleted' && inBranch(branchId)(u)).map((u) => {
    const txns = db.transactions.filter((t) => t.initiatedBy === u.id && t.createdAt >= since);
    return {
      userId: u.id, name: `${u.firstName} ${u.lastName}`, branchId: u.branchId, status: u.status,
      transactions: txns.length,
      volume: fromCents(sum(txns.filter((t) => t.status === 'completed'), (t) => t.amountCents)),
      deposits: txns.filter((t) => t.type === 'deposit').length,
      withdrawals: txns.filter((t) => t.type === 'withdrawal').length,
      transfers: txns.filter((t) => t.type === 'transfer').length,
      pendingApproval: txns.filter((t) => t.status === 'pending_approval').length,
      rejected: txns.filter((t) => t.status === 'rejected').length,
      customersOnboarded: db.customers.filter((c) => c.createdBy === u.id && c.createdAt >= since).length,
    };
  }).sort((a, b) => b.volume - a.volume);
}

route({
  method: 'get', path: '/reports/dashboard', tag: TAG,
  summary: 'Role-specific dashboard figures for the current user',
  response: 'Dashboard',
  handler: (req, res) => {
    const u = req.user;
    if (isCustomer(u)) {
      const ids = accountIdsForCustomer(u.customerId);
      const accounts = db.accounts.filter((a) => ids.includes(a.id));
      const txns = db.transactions.filter((t) => ids.includes(t.sourceAccountId) || ids.includes(t.destinationAccountId));
      const since = daysAgoIso(30);
      const recent = txns.filter((t) => t.createdAt >= since && t.status === 'completed');
      return res.json({
        data: {
          role: 'customer',
          totalBalance: fromCents(sum(accounts.filter((a) => a.status !== 'closed'), (a) => a.balanceCents)),
          availableBalance: fromCents(sum(accounts.filter((a) => a.status === 'active' && a.type !== 'fixed_deposit'), (a) => a.balanceCents + a.overdraftLimitCents - a.holdCents)),
          accounts: accounts.length,
          inflow30d: fromCents(sum(recent.filter((t) => ids.includes(t.destinationAccountId) && !ids.includes(t.sourceAccountId)), (t) => t.amountCents)),
          outflow30d: fromCents(sum(recent.filter((t) => ids.includes(t.sourceAccountId) && !ids.includes(t.destinationAccountId)), (t) => t.amountCents)),
          pendingTransactions: txns.filter((t) => t.status === 'pending_approval').length,
          recentTransactions: [...txns].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 6).map((t) => ser.transaction(t, u)),
          unreadNotifications: db.notifications.filter((n) => n.userId === u.id && !n.readAt).length,
        },
      });
    }
    const branchId = isGlobal(u) ? null : u.branchId;
    const today = startOfUtcDay().toISOString();
    const todays = db.transactions.filter((t) => t.createdAt >= today && inBranch(branchId)(t));
    const accounts = db.accounts.filter(inBranch(branchId));
    const base = {
      role: u.role,
      branchId,
      customers: db.customers.filter(inBranch(branchId)).length,
      accounts: accounts.length,
      totalDeposits: fromCents(sum(accounts.filter((a) => a.status !== 'closed'), (a) => Math.max(0, a.balanceCents))),
      frozenAccounts: accounts.filter((a) => a.status === 'frozen').length,
      dormantAccounts: accounts.filter((a) => a.status === 'dormant').length,
      transactionsToday: todays.length,
      volumeToday: fromCents(sum(todays.filter((t) => t.status === 'completed'), (t) => t.amountCents)),
      pendingApprovals: db.approvals.filter((a) => a.status === 'pending' && inBranch(branchId)(a) && (u.role !== 'manager' || a.requiredRole === 'manager')).length,
      openServiceRequests: db.serviceRequests.filter((r) => ['open', 'in_progress'].includes(r.status) && inBranch(branchId)(r)).length,
      openDisputes: db.disputes.filter((d) => ['open', 'under_review'].includes(d.status) && inBranch(branchId)(d)).length,
      volumeSeries: volumeSeries(branchId, 14),
    };
    if (u.role === 'teller') {
      const mine = db.transactions.filter((t) => t.initiatedBy === u.id);
      base.myTransactionsToday = mine.filter((t) => t.createdAt >= today).length;
      base.myPending = mine.filter((t) => t.status === 'pending_approval').length;
      base.myRecent = [...mine].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 6).map((t) => ser.transaction(t, u));
    }
    if (u.role === 'super_admin') {
      base.branches = db.branches.length;
      base.employees = db.users.filter((x) => x.role !== 'customer' && x.status === 'active').length;
      base.criticalEvents24h = db.guardrailEvents.filter((e) => e.createdAt >= daysAgoIso(1)).length;
      base.failedLogins24h = db.auditLogs.filter((a) => a.action === 'auth.login_failed' && a.createdAt >= daysAgoIso(1)).length;
    }
    return res.json({ data: base });
  },
});

route({
  method: 'get', path: '/reports/transaction-volume', tag: TAG, permission: PERM, apiKeyAllowed: true,
  summary: 'Daily transaction volume series',
  query: z.object({ days: z.coerce.number().int().min(1).max(120).default(30), branchId: s.id.optional() }).strict(),
  response: { array: 'VolumePoint' },
  handler: (req, res) => res.json({ data: volumeSeries(reportBranch(req, req.v.query.branchId), req.v.query.days) }),
});

route({
  method: 'get', path: '/reports/branch-performance', tag: TAG, permission: 'reports:system', apiKeyAllowed: true,
  summary: 'Side-by-side branch comparison (system-wide)',
  query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).strict(),
  response: { array: 'BranchPerformance' },
  handler: (req, res) => {
    const since = daysAgoIso(req.v.query.days);
    res.json({
      data: db.branches.map((b) => {
        const accounts = db.accounts.filter((a) => a.branchId === b.id);
        const txns = db.transactions.filter((t) => t.branchId === b.id && t.createdAt >= since && t.status === 'completed');
        return {
          branchId: b.id, code: b.code, name: b.name, status: b.status,
          customers: db.customers.filter((c) => c.branchId === b.id).length,
          accounts: accounts.length,
          totalDeposits: fromCents(sum(accounts.filter((a) => a.status !== 'closed'), (a) => Math.max(0, a.balanceCents))),
          transactions: txns.length,
          volume: fromCents(sum(txns, (t) => t.amountCents)),
          employees: db.users.filter((u) => u.branchId === b.id && u.status === 'active').length,
        };
      }),
    });
  },
});

route({
  method: 'get', path: '/reports/account-distribution', tag: TAG, permission: PERM, apiKeyAllowed: true,
  summary: 'Accounts and balances by type and status',
  query: branchQuery,
  response: 'AccountDistribution',
  handler: (req, res) => {
    const branchId = reportBranch(req, req.v.query.branchId);
    const accounts = db.accounts.filter(inBranch(branchId));
    const group = (key) => Object.values(accounts.reduce((m, a) => {
      m[a[key]] = m[a[key]] || { [key]: a[key], count: 0, balance: 0 };
      m[a[key]].count += 1;
      m[a[key]].balance = Math.round((m[a[key]].balance + fromCents(a.balanceCents)) * 100) / 100;
      return m;
    }, {}));
    res.json({ data: { byType: group('type'), byStatus: group('status') } });
  },
});

route({
  method: 'get', path: '/reports/customer-growth', tag: TAG, permission: PERM, apiKeyAllowed: true,
  summary: 'New customers per month (last 12 months)',
  query: branchQuery,
  response: { array: 'GrowthPoint' },
  handler: (req, res) => {
    const branchId = reportBranch(req, req.v.query.branchId);
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      months.push(d.toISOString().slice(0, 7));
    }
    const customers = db.customers.filter(inBranch(branchId));
    let cumulative = customers.filter((c) => c.createdAt.slice(0, 7) < months[0]).length;
    res.json({
      data: months.map((m) => {
        const added = customers.filter((c) => c.createdAt.slice(0, 7) === m).length;
        cumulative += added;
        return { month: m, newCustomers: added, totalCustomers: cumulative };
      }),
    });
  },
});

route({
  method: 'get', path: '/reports/teller-performance', tag: TAG, permission: PERM,
  summary: 'Teller activity and throughput',
  query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30), branchId: s.id.optional() }).strict(),
  response: { array: 'TellerPerformance' },
  handler: (req, res) => res.json({ data: tellerPerformance(reportBranch(req, req.v.query.branchId), req.v.query.days) }),
});

route({
  method: 'get', path: '/reports/large-transactions', tag: TAG, permission: PERM, apiKeyAllowed: true,
  summary: 'Transactions above a threshold (AML-style monitoring)',
  query: z.object({ threshold: z.coerce.number().min(100).default(10000), days: z.coerce.number().int().min(1).max(365).default(30), branchId: s.id.optional() }).strict(),
  response: { array: 'Transaction' },
  handler: (req, res) => {
    const q = req.v.query;
    const branchId = reportBranch(req, q.branchId);
    const since = daysAgoIso(q.days);
    const list = db.transactions.filter((t) => inBranch(branchId)(t) && t.createdAt >= since && t.amountCents >= q.threshold * 100).sort((a, b) => b.amountCents - a.amountCents).slice(0, 200);
    res.json({ data: list.map((t) => ser.transaction(t, req.user)) });
  },
});

route({
  method: 'get', path: '/reports/dormant-accounts', tag: TAG, permission: PERM,
  summary: 'Dormant accounts and accounts at risk of dormancy',
  query: z.object({ inactiveDays: z.coerce.number().int().min(30).max(1000).default(180), branchId: s.id.optional() }).strict(),
  response: { array: 'Account' },
  handler: (req, res) => {
    const branchId = reportBranch(req, req.v.query.branchId);
    const cutoff = daysAgoIso(req.v.query.inactiveDays);
    const list = db.accounts.filter((a) => inBranch(branchId)(a) && a.status !== 'closed' && (a.status === 'dormant' || a.lastActivityAt < cutoff));
    res.json({ data: list.map(ser.account) });
  },
});

route({
  method: 'get', path: '/reports/balances', tag: TAG, permission: PERM, apiKeyAllowed: true,
  summary: 'Deposit liabilities by branch and account type',
  query: branchQuery,
  response: { array: 'BalanceRow' },
  handler: (req, res) => {
    const branchId = reportBranch(req, req.v.query.branchId);
    const rows = {};
    db.accounts.filter((a) => inBranch(branchId)(a) && a.status !== 'closed').forEach((a) => {
      const key = `${a.branchId}:${a.type}`;
      rows[key] = rows[key] || { branchId: a.branchId, branchName: findById('branches', a.branchId).name, type: a.type, accounts: 0, balance: 0, holds: 0 };
      rows[key].accounts += 1;
      rows[key].balance = Math.round((rows[key].balance + fromCents(a.balanceCents)) * 100) / 100;
      rows[key].holds = Math.round((rows[key].holds + fromCents(a.holdCents)) * 100) / 100;
    });
    res.json({ data: Object.values(rows) });
  },
});

route({
  method: 'get', path: '/reports/approval-metrics', tag: TAG, permission: PERM,
  summary: 'Approval workflow metrics',
  query: z.object({ days: z.coerce.number().int().min(1).max(365).default(90), branchId: s.id.optional() }).strict(),
  response: 'ApprovalMetrics',
  handler: (req, res) => {
    const branchId = reportBranch(req, req.v.query.branchId);
    const since = daysAgoIso(req.v.query.days);
    const list = db.approvals.filter((a) => inBranch(branchId)(a) && a.createdAt >= since);
    const decided = list.filter((a) => a.decidedAt && ['approved', 'rejected'].includes(a.status));
    res.json({
      data: {
        total: list.length,
        byStatus: list.reduce((m, a) => ({ ...m, [a.status]: (m[a.status] || 0) + 1 }), {}),
        pendingAmount: fromCents(sum(list.filter((a) => a.status === 'pending'), (a) => a.amountCents)),
        averageDecisionMinutes: decided.length ? Math.round(sum(decided, (a) => Date.parse(a.decidedAt) - Date.parse(a.createdAt)) / decided.length / 60000) : null,
      },
    });
  },
});

const EXPORTS = {
  'teller-performance': { perm: PERM, rows: (b) => tellerPerformance(b, 30), cols: ['userId', 'name', 'branchId', 'transactions', 'volume', 'deposits', 'withdrawals', 'transfers', 'pendingApproval', 'customersOnboarded'] },
  'transaction-volume': { perm: PERM, rows: (b) => volumeSeries(b, 30), cols: ['date', 'count', 'deposits', 'withdrawals', 'transfers', 'total'] },
  'dormant-accounts': { perm: PERM, rows: (b) => db.accounts.filter((a) => inBranch(b)(a) && a.status === 'dormant').map(ser.account), cols: ['id', 'accountNumber', 'type', 'branchName', 'ledgerBalance', 'lastActivityAt'] },
  'branch-performance': { perm: ['reports:system'], rows: () => db.branches.map((br) => ({ branchId: br.id, code: br.code, name: br.name, accounts: db.accounts.filter((a) => a.branchId === br.id).length, customers: db.customers.filter((c) => c.branchId === br.id).length })), cols: ['branchId', 'code', 'name', 'accounts', 'customers'] },
};

route({
  method: 'get', path: '/reports/export', tag: TAG, permission: PERM, produces: 'text/csv', apiKeyAllowed: true,
  summary: 'Export a report as CSV',
  query: z.object({ report: z.enum(Object.keys(EXPORTS)), branchId: s.id.optional() }).strict(),
  handler: (req, res) => {
    const def = EXPORTS[req.v.query.report];
    if (!def.perm.some((p) => hasPermission(req.user, p))) throw forbidden();
    const branchId = reportBranch(req, req.v.query.branchId);
    audit(req, { action: 'report.export', entityType: 'report', details: { report: req.v.query.report, branchId } });
    res.type('text/csv').attachment(`${req.v.query.report}.csv`).send(toCsv(def.rows(branchId), def.cols.map((c) => ({ label: c, value: (r) => r[c] }))));
  },
});
