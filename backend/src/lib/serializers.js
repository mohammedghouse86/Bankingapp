/*
 * Response serializers. Records are never returned raw: each serializer
 * whitelists fields, masks sensitive values and adapts to the viewer's role,
 * preventing excessive data exposure (password hashes, full national IDs,
 * counterparties' private account details, internal risk ratings...).
 */
const { db, findById } = require('../store');
const { fromCents, maskTail, maskName } = require('./util');
const { isCustomer, accountIdsForCustomer } = require('./scope');

const fullName = (p) => (p ? `${p.firstName} ${p.lastName}`.trim() : null);
const branchName = (id) => { const b = id && findById('branches', id); return b ? b.name : null; };
const userRef = (id) => { const u = id && findById('users', id); return u ? { id: u.id, name: fullName(u), role: u.role } : null; };

function user(u) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    firstName: u.firstName,
    lastName: u.lastName,
    phone: u.phone,
    branchId: u.branchId,
    branchName: branchName(u.branchId),
    customerId: u.customerId,
    status: u.status,
    employeeCode: u.employeeCode,
    title: u.title,
    hireDate: u.hireDate,
    locked: Boolean(u.lockedUntil && u.lockedUntil > new Date().toISOString()),
    lockedUntil: u.lockedUntil,
    lastLoginAt: u.lastLoginAt,
    passwordChangedAt: u.passwordChangedAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

function branch(b) {
  const manager = b.managerId ? findById('users', b.managerId) : null;
  return {
    id: b.id,
    code: b.code,
    name: b.name,
    address: b.address,
    phone: b.phone,
    email: b.email,
    routingNumber: b.routingNumber,
    status: b.status,
    manager: manager ? { id: manager.id, name: fullName(manager), email: manager.email } : null,
    tellersCanOnboard: b.tellersCanOnboard,
    limits: b.limits,
    openedAt: b.openedAt,
    updatedAt: b.updatedAt,
  };
}

function customer(c, viewer) {
  const self = isCustomer(viewer);
  const out = {
    id: c.id,
    customerNumber: c.customerNumber,
    firstName: c.firstName,
    lastName: c.lastName,
    fullName: fullName(c),
    email: c.email,
    phone: c.phone,
    dateOfBirth: c.dateOfBirth,
    nationalIdMasked: maskTail(c.nationalId.replace(/\D/g, ''), 4),
    address: c.address,
    occupation: c.occupation,
    branchId: c.branchId,
    branchName: branchName(c.branchId),
    status: c.status,
    kycStatus: c.kycStatus,
    kyc: c.kyc ? {
      documentType: c.kyc.documentType,
      documentNumberMasked: maskTail(c.kyc.documentNumber, 3),
      submittedAt: c.kyc.submittedAt,
      verifiedAt: c.kyc.verifiedAt,
      ...(self ? {} : { score: c.kyc.score, decisionNote: c.kyc.decisionNote || null, verifiedBy: userRef(c.kyc.verifiedBy) }),
    } : null,
    portalAccess: Boolean(c.userId && (findById('users', c.userId) || {}).status === 'active'),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
  if (!self) {
    out.annualIncome = c.annualIncome;
    out.riskRating = c.riskRating;
    out.createdBy = userRef(c.createdBy);
    out.accountCount = accountIdsForCustomer(c.id).length;
  }
  return out;
}

function holdersOf(accountId) {
  return db.accountHolders.filter((h) => h.accountId === accountId).map((h) => {
    const c = findById('customers', h.customerId);
    return { customerId: h.customerId, name: fullName(c), customerNumber: c ? c.customerNumber : null, holderType: h.holderType, addedAt: h.addedAt };
  });
}

function account(a) {
  const br = findById('branches', a.branchId);
  return {
    id: a.id,
    accountNumber: a.accountNumber,
    routingNumber: br ? br.routingNumber : null,
    branchId: a.branchId,
    branchName: br ? br.name : null,
    type: a.type,
    currency: a.currency,
    status: a.status,
    statusReason: a.statusReason,
    ledgerBalance: fromCents(a.balanceCents),
    availableBalance: a.status === 'closed' ? 0 : fromCents(a.balanceCents + a.overdraftLimitCents - a.holdCents),
    holdAmount: fromCents(a.holdCents),
    overdraftLimit: fromCents(a.overdraftLimitCents),
    interestRate: a.interestRate,
    nickname: a.nickname,
    fixedDeposit: a.fixedDeposit ? {
      principal: fromCents(a.fixedDeposit.principalCents),
      termMonths: a.fixedDeposit.termMonths,
      maturityDate: a.fixedDeposit.maturityDate,
      linkedAccountId: a.fixedDeposit.linkedAccountId,
    } : null,
    holders: holdersOf(a.id),
    openedAt: a.openedAt,
    closedAt: a.closedAt,
    lastActivityAt: a.lastActivityAt,
  };
}

function accountRef(id, viewer, ownIds) {
  const a = id && findById('accounts', id);
  if (!a) return null;
  if (isCustomer(viewer) && !ownIds.includes(a.id)) {
    // Counterparty account belonging to someone else: masked.
    const holder = findById('customers', db.accountHolders.find((h) => h.accountId === a.id).customerId);
    return { accountNumberMasked: maskTail(a.accountNumber, 4), holderName: maskName(holder.firstName, holder.lastName) };
  }
  return { id: a.id, accountNumber: a.accountNumber, type: a.type, nickname: a.nickname };
}

function transaction(t, viewer) {
  const self = isCustomer(viewer);
  const ownIds = self ? accountIdsForCustomer(viewer.customerId) : [];
  const ben = t.beneficiaryId ? findById('beneficiaries', t.beneficiaryId) : null;
  const showBen = ben && (!self || ben.customerId === viewer.customerId);
  const approval = t.approvalId ? findById('approvals', t.approvalId) : null;
  const out = {
    id: t.id,
    reference: t.reference,
    type: t.type,
    channel: t.channel,
    status: t.status,
    amount: fromCents(t.amountCents),
    currency: t.currency,
    description: t.description,
    sourceAccount: accountRef(t.sourceAccountId, viewer, ownIds),
    destinationAccount: accountRef(t.destinationAccountId, viewer, ownIds),
    beneficiary: showBen ? { id: ben.id, name: ben.name, nickname: ben.nickname, bankName: ben.bankName, accountNumberMasked: maskTail(ben.accountNumber, 4) } : null,
    counterparty: t.counterparty && (!self || ownIds.includes(t.sourceAccountId)) ? { name: t.counterparty.name, bankName: t.counterparty.bankName, accountNumberMasked: maskTail(t.counterparty.accountNumber, 4) } : null,
    branchId: t.branchId,
    initiatedByRole: t.initiatedByRole,
    approval: approval ? { id: approval.id, status: approval.status, requiredRole: approval.requiredRole } : null,
    rejectionReason: t.rejectionReason,
    reversalOfId: t.reversalOfId,
    reversedById: t.reversedById,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
  };
  if (!self) {
    out.branchName = branchName(t.branchId);
    out.customerId = t.customerId;
    out.initiatedBy = userRef(t.initiatedBy);
    out.approvedBy = userRef(t.approvedBy);
    out.approvedAt = t.approvedAt;
    out.rejectedBy = userRef(t.rejectedBy);
    out.sourceBalanceAfter = t.sourceBalanceAfterCents == null ? null : fromCents(t.sourceBalanceAfterCents);
    out.destinationBalanceAfter = t.destinationBalanceAfterCents == null ? null : fromCents(t.destinationBalanceAfterCents);
  } else {
    out.sourceBalanceAfter = ownIds.includes(t.sourceAccountId) && t.sourceBalanceAfterCents != null ? fromCents(t.sourceBalanceAfterCents) : null;
    out.destinationBalanceAfter = ownIds.includes(t.destinationAccountId) && t.destinationBalanceAfterCents != null ? fromCents(t.destinationBalanceAfterCents) : null;
  }
  return out;
}

function approval(a, viewer) {
  const t = findById('transactions', a.transactionId);
  return {
    id: a.id,
    status: a.status,
    requiredRole: a.requiredRole,
    branchId: a.branchId,
    branchName: branchName(a.branchId),
    amount: fromCents(a.amountCents),
    reason: a.reason,
    requestedBy: userRef(a.requestedBy),
    decidedBy: userRef(a.decidedBy),
    decidedAt: a.decidedAt,
    decisionNote: a.decisionNote,
    createdAt: a.createdAt,
    transaction: t ? transaction(t, viewer) : null,
  };
}

function beneficiary(b, viewer) {
  return {
    id: b.id,
    customerId: b.customerId,
    name: b.name,
    nickname: b.nickname,
    // Owners and staff see the number they registered; it is their own data.
    accountNumber: b.accountNumber,
    bankName: b.bankName,
    routingNumber: b.routingNumber,
    isInternal: b.isInternal,
    status: b.status,
    dailyLimit: fromCents(b.dailyLimitCents),
    activatedAt: b.activatedAt,
    coolingOffUntil: b.activatedAt ? new Date(Date.parse(b.activatedAt) + 86400000).toISOString() : null,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    ...(isCustomer(viewer) ? {} : { customerName: fullName(findById('customers', b.customerId)) }),
  };
}

function serviceRequest(r, viewer) {
  const c = findById('customers', r.customerId);
  const acc = r.accountId ? findById('accounts', r.accountId) : null;
  return {
    id: r.id,
    reference: r.reference,
    type: r.type,
    status: r.status,
    subject: r.subject,
    description: r.description,
    details: r.details,
    customerId: r.customerId,
    customerName: fullName(c),
    account: acc ? { id: acc.id, accountNumber: acc.accountNumber, type: acc.type } : null,
    branchId: r.branchId,
    resolutionNote: r.resolutionNote,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...(isCustomer(viewer) ? {} : { assignedTo: userRef(r.assignedTo), branchName: branchName(r.branchId) }),
  };
}

function dispute(d, viewer) {
  const t = findById('transactions', d.transactionId);
  return {
    id: d.id,
    reference: d.reference,
    status: d.status,
    reason: d.reason,
    description: d.description,
    resolution: d.resolution,
    customerId: d.customerId,
    customerName: fullName(findById('customers', d.customerId)),
    accountId: d.accountId,
    branchId: d.branchId,
    transaction: t ? { id: t.id, reference: t.reference, amount: fromCents(t.amountCents), type: t.type, status: t.status, createdAt: t.createdAt, description: t.description } : null,
    refundTransactionId: d.refundTransactionId,
    resolvedAt: d.resolvedAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    ...(isCustomer(viewer) ? {} : { resolvedBy: userRef(d.resolvedBy) }),
  };
}

function notification(n) {
  return { id: n.id, type: n.type, title: n.title, message: n.message, link: n.link, read: Boolean(n.readAt), readAt: n.readAt, createdAt: n.createdAt };
}

function auditLog(a) {
  return { ...a, actor: userRef(a.actorUserId) };
}

function session(s, currentId) {
  return { id: s.id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt, expiresAt: s.expiresAt, revokedAt: s.revokedAt, revokedReason: s.revokedReason, current: s.id === currentId };
}

module.exports = { fullName, userRef, user, branch, customer, account, transaction, approval, beneficiary, serviceRequest, dispute, notification, auditLog, session };
