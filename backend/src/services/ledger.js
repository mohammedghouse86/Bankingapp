/*
 * Core money-movement engine.
 *
 * Invariants enforced here (and only here - routes never touch balances):
 *  - balances change exclusively through postings that write ledger entries;
 *  - available balance = ledger balance + overdraft - holds, never negative;
 *  - pending transactions reserve funds with a hold until decided;
 *  - frozen/closed/dormant/fixed-deposit rules are checked at initiation AND
 *    again at approval time;
 *  - the initiator of a transaction can never approve or reverse it.
 *
 * Every exported function runs synchronously, so a check and its balance
 * update can never interleave with another request.
 */
const { db, nextId, findById } = require('../store');
const { ApiError, conflict, forbidden, notFound, unprocessable } = require('../lib/errors');
const { nowIso, reference, fromCents, startOfUtcDay } = require('../lib/util');
const { audit } = require('../lib/audit');
const { notifyCustomer, notifyBranchManagers, notifyAdmins, setting } = require('../lib/notify');
const { holderCustomerIds } = require('../lib/scope');

const fmt = (cents) => `$${fromCents(cents).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const available = (a) => a.balanceCents + a.overdraftLimitCents - a.holdCents;

function assertCanDebit(acc) {
  if (acc.type === 'fixed_deposit') throw unprocessable('ACCOUNT_RESTRICTED', 'Fixed deposit accounts cannot be debited directly; use the break-deposit workflow');
  if (acc.status !== 'active') throw unprocessable('ACCOUNT_NOT_ACTIVE', `Account ${acc.accountNumber} is ${acc.status} and cannot be debited`);
}

function assertCanCredit(acc) {
  if (acc.type === 'fixed_deposit') throw unprocessable('ACCOUNT_RESTRICTED', 'Fixed deposit accounts cannot receive ad-hoc credits');
  if (acc.status === 'closed' || acc.status === 'frozen') throw unprocessable('ACCOUNT_NOT_ACTIVE', `Account ${acc.accountNumber} is ${acc.status} and cannot receive funds`);
}

function assertFunds(acc, amountCents) {
  if (available(acc) < amountCents) {
    throw unprocessable('INSUFFICIENT_FUNDS', 'Insufficient available balance', { available: fromCents(available(acc)), requested: fromCents(amountCents) });
  }
}

/** Sum of today's debits from an account matching `filter` (pending + completed). */
function debitedToday(accountId, filter = () => true) {
  const since = startOfUtcDay().toISOString();
  return db.transactions
    .filter((t) => t.sourceAccountId === accountId && t.createdAt >= since && (t.status === 'completed' || t.status === 'pending_approval') && filter(t))
    .reduce((sum, t) => sum + t.amountCents, 0);
}

function ledgerEntry(t, acc, direction) {
  db.ledgerEntries.push({ id: nextId('ledgerEntries'), transactionId: t.id, accountId: acc.id, direction, amountCents: t.amountCents, balanceAfterCents: acc.balanceCents, createdAt: t.completedAt });
}

function applyPosting(t) {
  const now = nowIso();
  t.status = 'completed';
  t.completedAt = now;
  const src = t.sourceAccountId ? findById('accounts', t.sourceAccountId) : null;
  const dst = t.destinationAccountId ? findById('accounts', t.destinationAccountId) : null;
  if (src) {
    src.balanceCents -= t.amountCents;
    src.lastActivityAt = now;
    src.updatedAt = now;
    t.sourceBalanceAfterCents = src.balanceCents;
    ledgerEntry(t, src, 'debit');
  }
  if (dst) {
    dst.balanceCents += t.amountCents;
    dst.lastActivityAt = now;
    dst.updatedAt = now;
    t.destinationBalanceAfterCents = dst.balanceCents;
    ledgerEntry(t, dst, 'credit');
  }
}

function notifyParties(t, title) {
  const ids = new Set();
  [t.sourceAccountId, t.destinationAccountId].filter(Boolean).forEach((a) => holderCustomerIds(a).forEach((c) => ids.add(c)));
  ids.forEach((cid) => notifyCustomer(cid, { type: 'transaction', title, message: `${t.type[0].toUpperCase()}${t.type.slice(1)} ${t.reference} for ${fmt(t.amountCents)} is ${t.status.replace('_', ' ')}.`, link: `/transactions/${t.id}` }));
}

const PREFIX = { deposit: 'DEP', withdrawal: 'WDL', transfer: 'TRF', reversal: 'REV', fee: 'FEE', interest: 'INT', fd_closure: 'FDC' };

function requiredApproverRole(actor, amountCents) {
  if (actor.role === 'super_admin') return 'super_admin';
  return amountCents > setting('managerApprovalLimit') * 100 ? 'super_admin' : 'manager';
}

/**
 * Idempotency: a retry with the same key from the same user returns the
 * original transaction; reusing a key for a different request is rejected.
 */
function findIdempotent(actor, key, fingerprint) {
  if (!key) return null;
  const existing = db.transactions.find((t) => t.idempotencyKey === key && t.initiatedBy === actor.id);
  if (!existing) return null;
  if (existing.idempotencyFingerprint !== fingerprint) {
    throw conflict('Idempotency-Key was already used for a different request');
  }
  return existing;
}

/**
 * Create and (unless approval is required) post a transaction.
 * opts: { req, type, channel, amountCents, source, destination, beneficiary,
 *         description, customerId, approvalReason, idempotencyKey, fingerprint }
 */
function execute(opts) {
  const { req, type, channel, amountCents, source, destination, beneficiary, description, customerId, approvalReason } = opts;
  const actor = req.user;
  if (source && destination && source.id === destination.id) throw unprocessable('SAME_ACCOUNT', 'Source and destination accounts must differ');
  if (source) { assertCanDebit(source); assertFunds(source, amountCents); }
  if (destination) assertCanCredit(destination);

  const now = nowIso();
  const t = {
    id: nextId('transactions'),
    reference: reference(PREFIX[type] || 'TXN'),
    type,
    channel,
    status: 'pending_approval',
    amountCents,
    currency: 'USD',
    sourceAccountId: source ? source.id : null,
    destinationAccountId: destination ? destination.id : null,
    beneficiaryId: beneficiary ? beneficiary.id : null,
    counterparty: beneficiary && !beneficiary.isInternal ? { name: beneficiary.name, bankName: beneficiary.bankName, accountNumber: beneficiary.accountNumber, routingNumber: beneficiary.routingNumber } : null,
    description,
    customerId,
    branchId: (source || destination).branchId,
    initiatedBy: actor.id,
    initiatedByRole: actor.role,
    approvalId: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    reversalOfId: null,
    reversedById: null,
    idempotencyKey: opts.idempotencyKey || null,
    idempotencyFingerprint: opts.fingerprint || null,
    sourceBalanceAfterCents: null,
    destinationBalanceAfterCents: null,
    createdAt: now,
    completedAt: null,
  };
  db.transactions.push(t);

  if (approvalReason) {
    if (source) source.holdCents += amountCents;
    const approval = {
      id: nextId('approvals'),
      transactionId: t.id,
      status: 'pending',
      requiredRole: requiredApproverRole(actor, amountCents),
      branchId: t.branchId,
      amountCents,
      requestedBy: actor.id,
      reason: approvalReason,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: now,
    };
    db.approvals.push(approval);
    t.approvalId = approval.id;
    const n = { type: 'approval', title: 'Transaction awaiting approval', message: `${t.reference} (${fmt(amountCents)}) requires ${approval.requiredRole === 'super_admin' ? 'super admin' : 'manager'} approval.`, link: `/approvals/${approval.id}` };
    if (approval.requiredRole === 'super_admin') notifyAdmins(n); else notifyBranchManagers(t.branchId, n);
    audit(req, { action: `transaction.${type}.pending`, entityType: 'transaction', entityId: t.id, branchId: t.branchId, details: { reference: t.reference, amount: fromCents(amountCents), approvalId: approval.id, reason: approvalReason } });
    notifyParties(t, 'Transaction pending approval');
  } else {
    applyPosting(t);
    audit(req, { action: `transaction.${type}`, entityType: 'transaction', entityId: t.id, branchId: t.branchId, details: { reference: t.reference, amount: fromCents(amountCents) } });
    notifyParties(t, 'Transaction completed');
  }
  return t;
}

/**
 * Bank-internal posting used by account workflows (fixed-deposit placement and
 * breakage, closure payouts). Callers perform their own eligibility checks;
 * the debit side still requires sufficient funds.
 */
function internalPosting(req, { type, source, destination, amountCents, description, customerId }) {
  if (source) assertFunds(source, amountCents);
  const now = nowIso();
  const t = {
    id: nextId('transactions'), reference: reference(PREFIX[type] || 'TXN'), type, channel: 'branch', status: 'pending_approval',
    amountCents, currency: 'USD', sourceAccountId: source ? source.id : null, destinationAccountId: destination ? destination.id : null,
    beneficiaryId: null, counterparty: null, description, customerId, branchId: (source || destination).branchId,
    initiatedBy: req.user.id, initiatedByRole: req.user.role, approvalId: null, approvedBy: null, approvedAt: null, rejectedBy: null,
    rejectionReason: null, reversalOfId: null, reversedById: null, idempotencyKey: null, idempotencyFingerprint: null,
    sourceBalanceAfterCents: null, destinationBalanceAfterCents: null, createdAt: now, completedAt: null,
  };
  db.transactions.push(t);
  applyPosting(t);
  audit(req, { action: `transaction.${type}`, entityType: 'transaction', entityId: t.id, branchId: t.branchId, details: { reference: t.reference, amount: fromCents(amountCents) } });
  notifyParties(t, 'Transaction completed');
  return t;
}

function pendingApprovalFor(t) {
  if (t.status !== 'pending_approval') throw conflict(`Transaction is ${t.status}; only pending transactions can be decided`);
  const approval = findById('approvals', t.approvalId);
  if (!approval || approval.status !== 'pending') throw conflict('No pending approval exists for this transaction');
  return approval;
}

/** Authorization rules for deciding an approval (separation of duties + authority). */
function assertCanDecide(actor, t, approval) {
  if (t.initiatedBy === actor.id) {
    throw new ApiError(403, 'SEPARATION_OF_DUTIES', 'You cannot approve or reject a transaction you initiated');
  }
  if (actor.role === 'manager') {
    if (approval.branchId !== actor.branchId) throw notFound('Transaction');
    if (approval.requiredRole === 'super_admin') {
      throw new ApiError(403, 'APPROVAL_AUTHORITY_EXCEEDED', `Amount exceeds your approval authority of ${fmt(setting('managerApprovalLimit') * 100)}; a super admin must decide`);
    }
  } else if (actor.role !== 'super_admin') {
    throw forbidden();
  }
}

function approve(req, t, note) {
  const actor = req.user;
  const approval = pendingApprovalFor(t);
  assertCanDecide(actor, t, approval);
  const src = t.sourceAccountId ? findById('accounts', t.sourceAccountId) : null;
  const dst = t.destinationAccountId ? findById('accounts', t.destinationAccountId) : null;
  // Re-validate account state at decision time; funds are already on hold.
  if (src) {
    assertCanDebit(src);
    // The hold already reserved the amount; a negative available balance means
    // the overdraft was reduced after initiation and funds no longer cover it.
    if (available(src) < 0) throw unprocessable('INSUFFICIENT_FUNDS', 'Funds no longer cover this transaction');
  }
  if (dst) assertCanCredit(dst);
  if (src) src.holdCents -= t.amountCents;
  applyPosting(t);
  const now = nowIso();
  Object.assign(approval, { status: 'approved', decidedBy: actor.id, decidedAt: now, decisionNote: note || null });
  Object.assign(t, { approvedBy: actor.id, approvedAt: now });
  audit(req, { action: 'transaction.approve', entityType: 'transaction', entityId: t.id, branchId: t.branchId, riskLevel: 'high', details: { reference: t.reference, amount: fromCents(t.amountCents), approvalId: approval.id } });
  notifyParties(t, 'Transaction approved');
  return t;
}

function releaseHold(t) {
  const src = t.sourceAccountId ? findById('accounts', t.sourceAccountId) : null;
  if (src) src.holdCents = Math.max(0, src.holdCents - t.amountCents);
}

function reject(req, t, reason) {
  const actor = req.user;
  const approval = pendingApprovalFor(t);
  assertCanDecide(actor, t, approval);
  releaseHold(t);
  const now = nowIso();
  Object.assign(approval, { status: 'rejected', decidedBy: actor.id, decidedAt: now, decisionNote: reason });
  Object.assign(t, { status: 'rejected', rejectedBy: actor.id, rejectionReason: reason });
  audit(req, { action: 'transaction.reject', entityType: 'transaction', entityId: t.id, branchId: t.branchId, riskLevel: 'high', details: { reference: t.reference, reason } });
  notifyParties(t, 'Transaction rejected');
  return t;
}

function cancel(req, t) {
  if (t.initiatedBy !== req.user.id) throw forbidden('Only the initiator can cancel a pending transaction');
  const approval = pendingApprovalFor(t);
  releaseHold(t);
  Object.assign(approval, { status: 'cancelled', decidedBy: req.user.id, decidedAt: nowIso(), decisionNote: 'Cancelled by initiator' });
  t.status = 'cancelled';
  audit(req, { action: 'transaction.cancel', entityType: 'transaction', entityId: t.id, branchId: t.branchId, details: { reference: t.reference } });
  notifyParties(t, 'Transaction cancelled');
  return t;
}

const REVERSIBLE = ['deposit', 'withdrawal', 'transfer', 'fee'];

function reverse(req, t, reason, { disputeRefund = false } = {}) {
  const actor = req.user;
  if (t.status !== 'completed') throw conflict(`Transaction is ${t.status}; only completed transactions can be reversed`);
  if (!REVERSIBLE.includes(t.type)) throw unprocessable('NOT_REVERSIBLE', `${t.type} transactions cannot be reversed`);
  if (t.initiatedBy === actor.id) throw new ApiError(403, 'SEPARATION_OF_DUTIES', 'You cannot reverse a transaction you initiated');
  const windowDays = setting('reversalWindowDays');
  // Dispute refunds have their own (longer) eligibility window.
  if (!disputeRefund && Date.now() - Date.parse(t.completedAt) > windowDays * 86400000) {
    throw unprocessable('REVERSAL_WINDOW_EXPIRED', `Transactions can only be reversed within ${windowDays} days`);
  }
  if (actor.role === 'manager' && t.amountCents > setting('managerApprovalLimit') * 100) {
    throw new ApiError(403, 'APPROVAL_AUTHORITY_EXCEEDED', 'Amount exceeds your authority; a super admin must reverse this transaction');
  }
  // Money flows back: original destination is debited, original source credited.
  const src = t.destinationAccountId ? findById('accounts', t.destinationAccountId) : null;
  const dst = t.sourceAccountId ? findById('accounts', t.sourceAccountId) : null;
  if (src) {
    if (src.status === 'closed') throw unprocessable('ACCOUNT_NOT_ACTIVE', 'Cannot reverse: the credited account is closed');
    assertFunds(src, t.amountCents);
  }
  if (dst && dst.status === 'closed') throw unprocessable('ACCOUNT_NOT_ACTIVE', 'Cannot reverse: the debited account is closed');

  const now = nowIso();
  const rev = {
    ...t,
    id: nextId('transactions'),
    reference: reference('REV'),
    type: 'reversal',
    channel: 'branch',
    status: 'pending_approval',
    sourceAccountId: src ? src.id : null,
    destinationAccountId: dst ? dst.id : null,
    beneficiaryId: null,
    counterparty: null,
    description: `Reversal of ${t.reference}: ${reason}`,
    initiatedBy: actor.id,
    initiatedByRole: actor.role,
    approvalId: null, approvedBy: null, approvedAt: null, rejectedBy: null, rejectionReason: null,
    reversalOfId: t.id,
    reversedById: null,
    idempotencyKey: null,
    idempotencyFingerprint: null,
    sourceBalanceAfterCents: null,
    destinationBalanceAfterCents: null,
    createdAt: now,
    completedAt: null,
  };
  db.transactions.push(rev);
  applyPosting(rev);
  t.status = 'reversed';
  t.reversedById = rev.id;
  audit(req, { action: 'transaction.reverse', entityType: 'transaction', entityId: t.id, branchId: t.branchId, riskLevel: 'high', details: { reference: t.reference, reversalReference: rev.reference, reason } });
  notifyParties(rev, 'Transaction reversed');
  return rev;
}

module.exports = {
  available, assertCanDebit, assertCanCredit, assertFunds, debitedToday, execute, internalPosting, approve, reject, cancel, reverse,
  findIdempotent, applyPosting, fmt, REVERSIBLE,
};
