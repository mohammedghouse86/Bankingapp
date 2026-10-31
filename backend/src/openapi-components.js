// Response schemas and shared responses for the generated OpenAPI document.
const str = { type: 'string' };
const strN = { type: 'string', nullable: true };
const num = { type: 'number' };
const numN = { type: 'number', nullable: true };
const int = { type: 'integer' };
const intN = { type: 'integer', nullable: true };
const bool = { type: 'boolean' };
const dt = { type: 'string', format: 'date-time' };
const dtN = { type: 'string', format: 'date-time', nullable: true };
const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
const arr = (items) => ({ type: 'array', items });
const obj = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });
const map = { type: 'object', additionalProperties: true };

const UserRef = obj({ id: int, name: str, role: str });
const Address = obj({ line1: str, city: str, state: str, postalCode: str, country: str });

const schemas = {
  Error: obj({ error: obj({ code: str, message: str, details: {}, requestId: str }, ['code', 'message']) }, ['error']),
  MessageResponse: obj({ data: obj({ message: str }) }),
  Pagination: obj({ page: int, pageSize: int, total: int, totalPages: int }, ['page', 'pageSize', 'total', 'totalPages']),
  UserRef: { ...UserRef, nullable: true },
  Address,
  TokenPair: obj({ accessToken: str, refreshToken: str, tokenType: { type: 'string', enum: ['Bearer'] }, expiresIn: int }, ['accessToken', 'refreshToken']),
  User: obj({
    id: int, email: str, role: { type: 'string', enum: ['super_admin', 'manager', 'teller', 'customer'] }, firstName: str, lastName: str, phone: strN,
    branchId: intN, branchName: strN, customerId: intN, status: { type: 'string', enum: ['active', 'inactive', 'deleted'] }, employeeCode: strN,
    title: strN, hireDate: strN, locked: bool, lockedUntil: dtN, lastLoginAt: dtN, passwordChangedAt: dtN, createdAt: dt, updatedAt: dt,
  }),
  MeResponse: obj({ user: ref('User'), permissions: arr(str), customer: { ...ref('Customer'), nullable: true } }),
  LoginResponse: { allOf: [ref('TokenPair'), ref('MeResponse')] },
  UserWithTempPassword: { allOf: [ref('User'), obj({ temporaryPassword: str })] },
  TempPassword: obj({ userId: int, email: str, temporaryPassword: str }),
  Session: obj({ id: { type: 'string', format: 'uuid' }, ip: str, userAgent: str, createdAt: dt, lastUsedAt: dt, expiresAt: dt, revokedAt: dtN, revokedReason: strN, current: bool }),
  PublicBranch: obj({ id: int, code: str, name: str, address: Address, phone: str }),
  Branch: obj({
    id: int, code: str, name: str, address: Address, phone: str, email: str, routingNumber: str, status: { type: 'string', enum: ['active', 'inactive'] },
    manager: { ...obj({ id: int, name: str, email: str }), nullable: true }, tellersCanOnboard: bool, limits: ref('Limits'), openedAt: dt, updatedAt: dt,
  }),
  Limits: obj({ approvalThreshold: num, tellerCashWithdrawalLimit: num, dailyCashWithdrawalLimit: num, largeDepositThreshold: num }),
  BranchLimits: obj({ branchId: int, limits: ref('Limits'), caps: ref('Limits') }),
  BranchStats: obj({ branchId: int, customers: int, activeCustomers: int, accounts: int, accountsByStatus: map, totalDeposits: num, employees: int, transactionsLast30Days: int, volumeLast30Days: num, pendingApprovals: int, openServiceRequests: int }),
  Customer: obj({
    id: int, customerNumber: str, firstName: str, lastName: str, fullName: str, email: str, phone: str, dateOfBirth: { type: 'string', format: 'date' },
    nationalIdMasked: str, address: Address, occupation: strN, branchId: int, branchName: str,
    status: { type: 'string', enum: ['active', 'pending_verification', 'suspended', 'closed'] },
    kycStatus: { type: 'string', enum: ['unverified', 'pending_review', 'verified', 'rejected'] },
    kyc: { ...obj({ documentType: str, documentNumberMasked: str, submittedAt: dtN, verifiedAt: dtN, score: intN, decisionNote: strN, verifiedBy: ref('UserRef') }), nullable: true },
    portalAccess: bool, createdAt: dt, updatedAt: dt,
    annualIncome: { ...intN, description: 'Staff only' }, riskRating: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Staff only' },
    createdBy: ref('UserRef'), accountCount: { ...int, description: 'Staff only' },
  }),
  CustomerSummary: obj({ customerId: int, totalBalance: num, accountsByStatus: map, accountsByType: map, transactionCount: int, pendingTransactions: int, lastTransactionAt: dtN, beneficiaries: int, openServiceRequests: int, openDisputes: int }),
  CustomerNote: obj({ id: int, body: str, author: ref('UserRef'), createdAt: dt }),
  KycResult: obj({ customerId: int, kycStatus: str, passed: bool, score: int, checks: obj({ documentFormat: bool, notExpired: bool, dateOfBirthMatch: bool, watchlistClear: bool }) }),
  AccountHolder: obj({ customerId: int, name: str, customerNumber: str, holderType: { type: 'string', enum: ['primary', 'joint'] }, addedAt: dt }),
  Account: obj({
    id: int, accountNumber: str, routingNumber: str, branchId: int, branchName: str, type: { type: 'string', enum: ['savings', 'checking', 'fixed_deposit'] },
    currency: str, status: { type: 'string', enum: ['active', 'frozen', 'dormant', 'closed'] }, statusReason: strN,
    ledgerBalance: num, availableBalance: num, holdAmount: num, overdraftLimit: num, interestRate: num, nickname: strN,
    fixedDeposit: { ...obj({ principal: num, termMonths: int, maturityDate: dt, linkedAccountId: intN }), nullable: true },
    holders: arr(ref('AccountHolder')), openedAt: dt, closedAt: dtN, lastActivityAt: dtN,
  }),
  AccountLookup: obj({ accountNumberMasked: str, holderName: str, bankName: str, branchName: str, routingNumber: str, acceptsCredits: bool }),
  Balance: obj({ accountId: int, currency: str, ledgerBalance: num, availableBalance: num, holdAmount: num, overdraftLimit: num, asOf: dt }),
  AccountLimits: obj({ accountId: int, online: map, branch: map }),
  AccountRef: { ...obj({ id: int, accountNumber: str, type: str, nickname: strN, accountNumberMasked: str, holderName: str }), nullable: true },
  Transaction: obj({
    id: int, reference: str, type: { type: 'string', enum: ['deposit', 'withdrawal', 'transfer', 'reversal', 'fee', 'interest', 'fd_closure'] },
    channel: { type: 'string', enum: ['branch', 'online', 'ach', 'system'] }, status: { type: 'string', enum: ['pending_approval', 'completed', 'rejected', 'reversed', 'cancelled'] },
    amount: num, currency: str, description: strN, sourceAccount: ref('AccountRef'), destinationAccount: ref('AccountRef'),
    beneficiary: { ...obj({ id: int, name: str, nickname: strN, bankName: str, accountNumberMasked: str }), nullable: true },
    counterparty: { ...obj({ name: str, bankName: str, accountNumberMasked: str }), nullable: true },
    branchId: int, branchName: str, customerId: intN, initiatedByRole: str, initiatedBy: ref('UserRef'),
    approval: { ...obj({ id: int, status: str, requiredRole: str }), nullable: true }, approvedBy: ref('UserRef'), approvedAt: dtN, rejectedBy: ref('UserRef'),
    rejectionReason: strN, reversalOfId: intN, reversedById: intN, sourceBalanceAfter: numN, destinationBalanceAfter: numN, createdAt: dt, completedAt: dtN,
  }),
  AccountTransaction: { allOf: [ref('Transaction'), obj({ direction: { type: 'string', enum: ['debit', 'credit'] }, balanceAfter: numN })] },
  TransactionSummary: obj({ count: int, totalAmount: num, byType: map, byStatus: map, byChannel: map }),
  LedgerEntry: obj({ id: int, accountId: int, direction: { type: 'string', enum: ['debit', 'credit'] }, amount: num, balanceAfter: num, createdAt: dt }),
  Receipt: obj({ receiptNumber: str, bank: str, branch: str, reference: str, type: str, status: str, amount: num, currency: str, from: str, to: str, description: strN, createdAt: dt, completedAt: dtN, disclaimer: str }),
  Statement: obj({
    account: obj({ id: int, accountNumber: str, type: str, holders: arr(str), branch: str }), period: obj({ from: str, to: str }),
    openingBalance: num, closingBalance: num, totalDebits: num, totalCredits: num,
    lines: arr(obj({ date: dt, reference: str, description: str, type: str, debit: numN, credit: numN, balance: num })), generatedAt: dt,
  }),
  FixedDepositClosure: obj({ account: ref('Account'), matured: bool, penalty: num, payout: num, creditedAccountId: int }),
  TransferValidation: obj({ allowed: bool, requiresApproval: bool, approvalReason: strN, availableBalance: num, code: str, reason: str, fee: num }),
  Approval: obj({ id: int, status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'cancelled'] }, requiredRole: { type: 'string', enum: ['manager', 'super_admin'] }, branchId: int, branchName: str, amount: num, reason: str, requestedBy: ref('UserRef'), decidedBy: ref('UserRef'), decidedAt: dtN, decisionNote: strN, createdAt: dt, transaction: ref('Transaction'), canDecide: bool }),
  Beneficiary: obj({ id: int, customerId: int, customerName: str, name: str, nickname: strN, accountNumber: str, bankName: str, routingNumber: str, isInternal: bool, status: { type: 'string', enum: ['pending_activation', 'active', 'disabled'] }, dailyLimit: num, activatedAt: dtN, coolingOffUntil: dtN, createdAt: dt, updatedAt: dt }),
  Dispute: obj({ id: int, reference: str, status: { type: 'string', enum: ['open', 'under_review', 'resolved_refunded', 'rejected', 'withdrawn'] }, reason: str, description: str, resolution: strN, customerId: int, customerName: str, accountId: int, branchId: int, transaction: map, refundTransactionId: intN, resolvedAt: dtN, resolvedBy: ref('UserRef'), createdAt: dt, updatedAt: dt }),
  ServiceRequest: obj({ id: int, reference: str, type: str, status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'rejected', 'cancelled'] }, subject: str, description: strN, details: map, customerId: int, customerName: str, account: { ...obj({ id: int, accountNumber: str, type: str }), nullable: true }, branchId: int, branchName: str, assignedTo: ref('UserRef'), resolutionNote: strN, createdAt: dt, updatedAt: dt }),
  Notification: obj({ id: int, type: str, title: str, message: str, link: strN, read: bool, readAt: dtN, createdAt: dt }),
  UnreadCount: obj({ unread: int }),
  Dashboard: { type: 'object', additionalProperties: true, description: 'Role-specific dashboard metrics; shape depends on the caller\'s role.' },
  VolumePoint: obj({ date: str, count: int, deposits: num, withdrawals: num, transfers: num, total: num }),
  BranchPerformance: obj({ branchId: int, code: str, name: str, status: str, customers: int, accounts: int, totalDeposits: num, transactions: int, volume: num, employees: int }),
  AccountDistribution: obj({ byType: arr(map), byStatus: arr(map) }),
  GrowthPoint: obj({ month: str, newCustomers: int, totalCustomers: int }),
  TellerPerformance: obj({ userId: int, name: str, branchId: int, status: str, transactions: int, volume: num, deposits: int, withdrawals: int, transfers: int, pendingApproval: int, rejected: int, customersOnboarded: int }),
  BalanceRow: obj({ branchId: int, branchName: str, type: str, accounts: int, balance: num, holds: num }),
  ApprovalMetrics: obj({ total: int, byStatus: map, pendingAmount: num, averageDecisionMinutes: intN }),
  AuditLog: obj({ id: int, actorUserId: intN, actorRole: strN, actor: ref('UserRef'), action: str, entityType: strN, entityId: {}, branchId: intN, outcome: { type: 'string', enum: ['success', 'failure', 'denied'] }, riskLevel: { type: 'string', enum: ['standard', 'high', 'critical'] }, ip: strN, userAgent: strN, requestId: strN, details: map, createdAt: dt }),
  AuditStats: obj({ total: int, byOutcome: map, byRiskLevel: map, topActions: arr(obj({ action: str, count: int })) }),
  Setting: obj({ key: str, value: num, type: str, min: num, max: num, description: str, updatedBy: ref('UserRef'), updatedAt: dt }),
  Role: obj({ role: str, editable: bool, users: int, permissions: arr(str), grantable: arr(str) }),
  Permission: obj({ key: str, description: str, grantableTo: arr(str) }),
  NetworkConfig: obj({ hostname: str, publicIp: str, privateIp: str, subnetMask: str, gateway: str, dnsServers: arr(str), ntpServer: str, smtpRelay: str, swiftGatewayHost: str, updatedBy: ref('UserRef'), updatedAt: dt, adminIpEnforcement: { type: 'string', enum: ['monitor', 'enforce'] }, callerIp: str }),
  IpAllowlistEntry: obj({ id: int, cidr: str, label: str, createdBy: ref('UserRef'), createdAt: dt }),
  ApiKey: obj({ id: int, name: str, prefix: str, scopes: arr(str), createdBy: ref('UserRef'), createdAt: dt, lastUsedAt: dtN, expiresAt: dtN, revokedAt: dtN }),
  ApiKeyWithSecret: { allOf: [ref('ApiKey'), obj({ apiKey: { type: 'string', description: 'Shown only once' } })] },
  GuardrailEvent: obj({ id: int, operationId: str, method: str, path: str, riskLevel: str, statusCode: int, outcome: { type: 'string', enum: ['executed', 'blocked', 'failed'] }, actorUserId: intN, actorRole: strN, ip: str, userAgent: str, requestId: str, createdAt: dt }),
  SensitiveEndpoint: obj({ operationId: str, method: str, path: str, riskLevel: str, stepUp: bool, summary: str, guardrailExpected: str }),
  Email: obj({ id: int, to: str, subject: str, body: str, createdAt: dt }),
  SystemInfo: obj({ version: str, environment: str, startedAt: dt, uptimeSeconds: int, nodeVersion: str, autoResetMinutes: intN, endpoints: int, loadedAt: dt, collections: map }),
  Health: obj({ status: str, time: dt }),
};

const err = (description) => ({ description, content: { 'application/json': { schema: ref('Error') } } });

module.exports = {
  schemas,
  responses: {
    BadRequest: err('Validation failed or malformed request (unknown fields are rejected)'),
    Unauthorized: err('Missing, invalid or expired credentials'),
    Forbidden: err('Authenticated but not permitted (role, permission, branch policy, separation of duties)'),
    NotFound: err('Resource does not exist or is outside the caller\'s scope'),
    Conflict: err('State conflict (duplicate, wrong status, idempotency key reuse)'),
    BusinessRuleViolation: err('Business rule violation (insufficient funds, limits, account status)'),
    StepUpRequired: err('Re-authentication required: send X-Confirm-Password'),
    TooManyRequests: err('Rate limit exceeded'),
    ServerError: err('Unexpected server error'),
  },
  securitySchemes: {
    bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
  },
};
