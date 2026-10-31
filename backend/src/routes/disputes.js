const { route } = require('../lib/registry');
const { db, nextId, findById } = require('../store');
const s = require('../lib/schemas');
const { z } = s;
const ser = require('../lib/serializers');
const { conflict, notFound, unprocessable } = require('../lib/errors');
const { nowIso, paginate, includesText } = require('../lib/util');
const { audit } = require('../lib/audit');
const { notifyCustomer, notifyBranchManagers } = require('../lib/notify');
const { isCustomer, branchScope, loadTransaction, accountIdsForCustomer } = require('../lib/scope');
const ledger = require('../services/ledger');

const TAG = 'Disputes';
const DISPUTE_WINDOW_DAYS = 60;

function loadDispute(u, id) {
  const d = findById('disputes', id);
  if (!d) throw notFound('Dispute');
  if (isCustomer(u) ? d.customerId !== u.customerId : (branchScope(u) != null && d.branchId !== u.branchId)) throw notFound('Dispute');
  return d;
}

route({
  method: 'get', path: '/disputes', tag: TAG, permission: ['disputes:read', 'portal:disputes'],
  summary: 'List disputes (customers: own; staff: branch scope)',
  query: z.object({ ...s.paging, status: z.enum(['open', 'under_review', 'resolved_refunded', 'rejected', 'withdrawn']).optional(), branchId: s.id.optional() }).strict(),
  response: { list: 'Dispute' },
  handler: (req, res) => {
    const q = req.v.query;
    const u = req.user;
    const list = db.disputes.filter((d) => (isCustomer(u) ? d.customerId === u.customerId : branchScope(u) == null || d.branchId === u.branchId)
      && (!q.status || d.status === q.status) && (!q.branchId || d.branchId === q.branchId) && includesText([d.reference, d.description], q.search));
    const page = paginate(list, q, { createdAt: (d) => d.createdAt, status: (d) => d.status }, 'createdAt');
    res.json({ data: page.items.map((d) => ser.dispute(d, u)), pagination: page.pagination });
  },
});

route({
  method: 'post', path: '/disputes', tag: TAG, roles: ['customer'], permission: 'portal:disputes', status: 201, conflicts: true, businessRules: true,
  summary: 'Dispute a debit from one of your accounts',
  description: `Only completed debits from your own accounts within ${DISPUTE_WINDOW_DAYS} days can be disputed, one open dispute per transaction.`,
  body: z.object({ transactionId: s.id, reason: z.enum(['unauthorized', 'incorrect_amount', 'duplicate', 'not_received', 'other']), description: s.text(1000) }).strict(),
  response: 'Dispute',
  handler: (req, res) => {
    const b = req.v.body;
    const t = loadTransaction(req.user, b.transactionId);
    if (!accountIdsForCustomer(req.user.customerId).includes(t.sourceAccountId)) throw unprocessable('NOT_DISPUTABLE', 'Only debits from your own accounts can be disputed');
    if (t.status !== 'completed') throw unprocessable('NOT_DISPUTABLE', `Transaction is ${t.status}`);
    if (!ledger.REVERSIBLE.includes(t.type)) throw unprocessable('NOT_DISPUTABLE', `${t.type} transactions cannot be disputed`);
    if (Date.now() - Date.parse(t.createdAt) > DISPUTE_WINDOW_DAYS * 86400000) throw unprocessable('DISPUTE_WINDOW_EXPIRED', `Disputes must be raised within ${DISPUTE_WINDOW_DAYS} days`);
    if (db.disputes.some((d) => d.transactionId === t.id && ['open', 'under_review'].includes(d.status))) throw conflict('An open dispute already exists for this transaction');
    const now = nowIso();
    const d = {
      id: nextId('disputes'), reference: `DSP${now.slice(0, 10).replace(/-/g, '')}${String(db.disputes.length + 1).padStart(4, '0')}`,
      transactionId: t.id, customerId: req.user.customerId, accountId: t.sourceAccountId, branchId: t.branchId, reason: b.reason, description: b.description,
      status: 'open', resolution: null, resolvedBy: null, resolvedAt: null, refundTransactionId: null, createdAt: now, updatedAt: now,
    };
    db.disputes.push(d);
    audit(req, { action: 'dispute.create', entityType: 'dispute', entityId: d.id, branchId: d.branchId, details: { transactionId: t.id } });
    notifyBranchManagers(d.branchId, { type: 'service', title: 'New transaction dispute', message: `Dispute ${d.reference} was raised for ${t.reference}.`, link: `/disputes/${d.id}` });
    res.status(201).json({ data: ser.dispute(d, req.user) });
  },
});

route({
  method: 'get', path: '/disputes/:id', tag: TAG, permission: ['disputes:read', 'portal:disputes'],
  summary: 'Get a dispute',
  params: s.idParams,
  response: 'Dispute',
  handler: (req, res) => res.json({ data: ser.dispute(loadDispute(req.user, req.v.params.id), req.user) }),
});

route({
  method: 'post', path: '/disputes/:id/review', tag: TAG, permission: 'disputes:manage', conflicts: true,
  summary: 'Start investigating a dispute',
  params: s.idParams,
  response: 'Dispute',
  handler: (req, res) => {
    const d = loadDispute(req.user, req.v.params.id);
    if (d.status !== 'open') throw conflict(`Dispute is ${d.status}`);
    d.status = 'under_review';
    d.updatedAt = nowIso();
    audit(req, { action: 'dispute.review', entityType: 'dispute', entityId: d.id, branchId: d.branchId });
    notifyCustomer(d.customerId, { type: 'service', title: 'Dispute under review', message: `We are investigating dispute ${d.reference}.`, link: `/disputes/${d.id}` });
    res.json({ data: ser.dispute(d, req.user) });
  },
});

route({
  method: 'post', path: '/disputes/:id/resolve', tag: TAG, permission: 'disputes:manage', risk: 'high', conflicts: true, businessRules: true,
  summary: 'Resolve a dispute with a refund (reversal) or rejection',
  params: s.idParams,
  body: z.object({ outcome: z.enum(['refund', 'reject']), resolution: s.text(500) }).strict(),
  response: 'Dispute',
  handler: (req, res) => {
    const d = loadDispute(req.user, req.v.params.id);
    if (!['open', 'under_review'].includes(d.status)) throw conflict(`Dispute is ${d.status}`);
    const { outcome, resolution } = req.v.body;
    if (outcome === 'refund') {
      const t = findById('transactions', d.transactionId);
      const rev = ledger.reverse(req, t, `Dispute ${d.reference} refund`, { disputeRefund: true });
      d.refundTransactionId = rev.id;
    }
    Object.assign(d, { status: outcome === 'refund' ? 'resolved_refunded' : 'rejected', resolution, resolvedBy: req.user.id, resolvedAt: nowIso(), updatedAt: nowIso() });
    audit(req, { action: `dispute.${outcome}`, entityType: 'dispute', entityId: d.id, branchId: d.branchId, riskLevel: 'high', details: { resolution } });
    notifyCustomer(d.customerId, { type: 'service', title: outcome === 'refund' ? 'Dispute resolved - refunded' : 'Dispute closed', message: resolution, link: `/disputes/${d.id}` });
    res.json({ data: ser.dispute(d, req.user) });
  },
});

route({
  method: 'post', path: '/disputes/:id/withdraw', tag: TAG, roles: ['customer'], permission: 'portal:disputes', conflicts: true,
  summary: 'Withdraw your own open dispute',
  params: s.idParams,
  response: 'Dispute',
  handler: (req, res) => {
    const d = loadDispute(req.user, req.v.params.id);
    if (!['open', 'under_review'].includes(d.status)) throw conflict(`Dispute is ${d.status}`);
    d.status = 'withdrawn';
    d.updatedAt = nowIso();
    audit(req, { action: 'dispute.withdraw', entityType: 'dispute', entityId: d.id, branchId: d.branchId });
    res.json({ data: ser.dispute(d, req.user) });
  },
});
