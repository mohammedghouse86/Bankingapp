// Object-level (BOLA/IDOR), function-level (BFLA), branch-scope and mass-assignment controls.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, as, asCustomer, accountsOf, richCustomer, checkingOf, client } = require('./helpers');

const custA = richCustomer(1);
const custB = richCustomer(2);
const accA = checkingOf(custA);
const accB = checkingOf(custB);
const txnB = db.transactions.find((t) => t.sourceAccountId === accB.id || t.destinationAccountId === accB.id);
const benB = db.beneficiaries.find((b) => b.customerId !== custA.id && b.status === 'active');

test('customer cannot read another customer\'s resources by changing IDs (BOLA)', async () => {
  const c = await asCustomer(custA);
  assert.equal((await c.get(`/accounts/${accA.id}`)).status, 200);
  for (const path of [
    `/accounts/${accB.id}`, `/accounts/${accB.id}/balance`, `/accounts/${accB.id}/transactions`, `/accounts/${accB.id}/holders`,
    `/accounts/${accB.id}/statement?from=2020-01-01&to=2020-12-31`, `/accounts/${accB.id}/statement/download?from=2020-01-01&to=2020-12-31`,
    `/accounts/${accB.id}/limits`, `/customers/${custB.id}`, `/customers/${custB.id}/accounts`, `/customers/${custB.id}/transactions`,
    `/customers/${custB.id}/summary`, `/transactions/${txnB.id}`, `/transactions/${txnB.id}/receipt`, `/transactions/by-reference/${txnB.reference}`,
    `/beneficiaries/${benB.id}`, `/beneficiaries/${benB.id}/transfers`,
  ]) {
    const res = await c.get(path);
    assert.equal(res.status, 404, `${path} should be 404 but was ${res.status}`);
  }
  assert.equal((await c.patch(`/accounts/${accB.id}`, { nickname: 'pwned' })).status, 404);
  assert.equal((await c.delete(`/beneficiaries/${benB.id}`)).status, 404);
  assert.equal((await c.get(`/beneficiaries?customerId=${custB.id}`)).status, 404);
});

test('customer lists only contain own data', async () => {
  const c = await asCustomer(custA);
  const own = accountsOf(custA.id).map((a) => a.id);
  const accounts = await c.get('/accounts?pageSize=100');
  assert.ok(accounts.body.data.every((a) => own.includes(a.id)));
  const txns = await c.get('/transactions?pageSize=100');
  assert.ok(txns.body.data.every((t) => (t.sourceAccount && own.includes(t.sourceAccount.id)) || (t.destinationAccount && own.includes(t.destinationAccount.id))));
  assert.equal((await c.get(`/transactions?customerId=${custB.id}`)).status, 400);
});

test('customer cannot call staff or admin functions (BFLA)', async () => {
  const c = await asCustomer(custA);
  const calls = [
    ['get', '/customers'], ['get', '/users'], ['get', '/approvals'], ['get', '/audit-logs'], ['get', '/system/network'], ['get', '/reports/branch-performance'],
    ['post', '/transactions/deposits', { accountId: accA.id, amount: 100, depositorName: 'Me' }],
    ['post', `/accounts/${accA.id}/freeze`, { reason: 'x' }],
    ['post', `/transactions/${txnB.id}/approve`, {}],
    ['put', '/settings/customerPerTransactionLimit', { value: 999999, reason: 'x' }],
    ['put', '/roles/customer/permissions', { permissions: ['system:reset'], reason: 'x' }],
    ['post', '/system/reset', { confirm: 'RESET ALL DATA' }],
  ];
  for (const [m, p, body] of calls) {
    const res = await c[m](p, body);
    assert.equal(res.status, 403, `${m.toUpperCase()} ${p} returned ${res.status}`);
  }
});

test('customers cannot change balances, status or ownership through any writable field (mass assignment)', async () => {
  const c = await asCustomer(custA);
  const before = db.accounts.find((a) => a.id === accA.id).balanceCents;
  for (const body of [{ nickname: 'x', balanceCents: 1e9 }, { nickname: 'x', ledgerBalance: 1e7 }, { nickname: 'x', status: 'active' }, { nickname: 'x', branchId: 2 }]) {
    const res = await c.patch(`/accounts/${accA.id}`, body);
    assert.equal(res.status, 400);
    assert.match(JSON.stringify(res.body), /Unrecognized field/);
  }
  assert.equal(db.accounts.find((a) => a.id === accA.id).balanceCents, before);
  assert.equal((await c.patch('/me/profile', { address: custA.address, kycStatus: 'verified' })).status, 400);
  assert.equal((await c.patch('/me/profile', { firstName: 'New' })).status, 400);
});

test('tellers are limited to their branch and cannot perform manager functions', async () => {
  const t = await as('tellerDowntown');
  assert.equal((await t.get(`/accounts/${accA.id}`)).status, 200);
  assert.equal((await t.get(`/accounts/${accB.id}`)).status, 404, 'other branch account');
  assert.equal((await t.get(`/customers/${custB.id}`)).status, 404, 'other branch customer');
  const list = await t.get('/customers?pageSize=100');
  assert.ok(list.body.data.every((c) => c.branchId === 1));
  for (const [m, p, body] of [
    ['post', `/accounts/${accA.id}/freeze`, { reason: 'x' }],
    ['post', `/accounts/${accA.id}/unfreeze`, { reason: 'x' }],
    ['put', `/accounts/${accA.id}/overdraft`, { overdraftLimit: 100, reason: 'x' }],
    ['post', '/accounts', { customerId: custA.id, type: 'savings', initialDeposit: 500 }],
    ['get', '/users'], ['get', '/approvals'], ['get', '/reports/teller-performance'],
    ['put', '/branches/1/limits', { approvalThreshold: 1, tellerCashWithdrawalLimit: 1, dailyCashWithdrawalLimit: 1, largeDepositThreshold: 1, reason: 'x' }],
    ['post', '/users', { email: 'x@kestrelbank.test', firstName: 'X', lastName: 'Y', role: 'teller' }],
  ]) {
    assert.equal((await t[m](p, body)).status, 403, `${m} ${p}`);
  }
});

test('managers are confined to their branch', async () => {
  const m = await as('managerDowntown');
  assert.equal((await m.get(`/accounts/${accB.id}`)).status, 404);
  assert.equal((await m.post(`/accounts/${accB.id}/freeze`, { reason: 'cross-branch' })).status, 404);
  assert.equal((await m.get(`/customers/${custB.id}`)).status, 404);
  assert.equal((await m.get('/reports/transaction-volume?branchId=2')).status, 403);
  assert.equal((await m.get('/branches/2/stats')).status, 404);
  assert.equal((await m.put('/branches/2/limits', { approvalThreshold: 100, tellerCashWithdrawalLimit: 100, dailyCashWithdrawalLimit: 100, largeDepositThreshold: 100, reason: 'x' })).status, 404);
  const otherBranchTeller = db.users.find((u) => u.role === 'teller' && u.branchId === 2);
  assert.equal((await m.get(`/users/${otherBranchTeller.id}`)).status, 404);
  const users = await m.get('/users?pageSize=100');
  assert.ok(users.body.data.every((u) => u.branchId === 1 && u.role !== 'super_admin'));
  const pendingOther = db.approvals.find((a) => a.branchId !== 1 && a.status === 'pending');
  assert.equal((await m.post(`/transactions/${pendingOther.transactionId}/approve`, {})).status, 404);
});

test('managers cannot escalate privileges or touch global configuration', async () => {
  const m = await as('managerDowntown');
  const res = await m.post('/users', { email: 'evil.manager@kestrelbank.test', firstName: 'Evil', lastName: 'Manager', role: 'manager' });
  assert.equal(res.status, 403);
  assert.equal((await m.post('/users', { email: 'evil.admin@kestrelbank.test', firstName: 'Evil', lastName: 'Admin', role: 'super_admin' })).status, 403);
  const teller = db.users.find((u) => u.role === 'teller' && u.branchId === 1 && u.status === 'active');
  assert.equal((await m.put(`/users/${teller.id}/role`, { role: 'manager', reason: 'promote' })).status, 403);
  assert.equal((await m.post('/users', { email: 'other.branch@kestrelbank.test', firstName: 'Other', lastName: 'Branch', role: 'teller', branchId: 2 })).status, 403);
  assert.equal((await m.put('/settings/managerApprovalLimit', { value: 9999999, reason: 'x' })).status, 403);
  assert.equal((await m.get('/system/network')).status, 403);
  assert.equal((await m.post('/system/api-keys', { name: 'x', scopes: ['audit:read'] })).status, 403);
  const peer = db.users.find((u) => u.email === 'asst.manager.downtown@kestrelbank.test');
  assert.equal((await m.post(`/users/${peer.id}/deactivate`, { reason: 'x' })).status, 403, 'managers cannot manage other managers');
  const self = db.users.find((u) => u.email === 'manager.downtown@kestrelbank.test');
  assert.equal((await m.patch(`/users/${self.id}`, { title: 'CEO' })).status, 403, 'no self management');
  assert.equal((await m.patch(`/users/${teller.id}`, { role: 'super_admin' })).status, 400, 'role via PATCH is rejected');
});

test('managers can create tellers in their own branch only', async () => {
  const m = await as('managerDowntown');
  const res = await m.post('/users', { email: 'new.teller@kestrelbank.test', firstName: 'New', lastName: 'Teller', role: 'teller' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.branchId, 1);
  assert.ok(res.body.data.temporaryPassword);
});

test('teller onboarding obeys branch policy (Westfield requires a manager)', async () => {
  const { login } = require('./helpers');
  const t = client(await login('teller1.westfield@kestrelbank.test', 'Teller@Kestrel1!'));
  const body = { firstName: 'Pat', lastName: 'Newcomer', email: 'pat.newcomer@example.com', phone: '+1-555-0142', dateOfBirth: '1988-02-02', nationalId: 'SIM-123-45-6789', address: { line1: '9 Prairie Rd', city: 'Westfield', state: 'TX', postalCode: '75001', country: 'US' } };
  const res = await t.post('/customers', body);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'BRANCH_POLICY');
  const d = await as('tellerDowntown');
  assert.equal((await d.post('/customers', { ...body, email: 'pat2@example.com' })).status, 201);
});

test('responses do not leak sensitive fields', async () => {
  const admin = await as('admin');
  const u = await admin.get('/users/1');
  assert.equal(u.body.data.passwordHash, undefined);
  const c = await admin.get(`/customers/${custA.id}`);
  assert.equal(c.body.data.nationalId, undefined);
  assert.match(c.body.data.nationalIdMasked, /^\*+\d{4}$/);
  const cust = await asCustomer(custA);
  const self = await cust.get(`/customers/${custA.id}`);
  assert.equal(self.status, 200);
  assert.equal(self.body.data.riskRating, undefined, 'internal risk rating hidden from customers');
  const lookup = await cust.get(`/accounts/lookup?accountNumber=${accB.accountNumber}`);
  assert.equal(lookup.status, 200);
  assert.ok(!JSON.stringify(lookup.body).includes(custB.lastName), 'lookup masks holder name');
});

test('API keys are restricted to their scopes', async () => {
  const admin = await as('admin');
  const created = await client(null, {}).post('/system/api-keys');
  assert.equal(created.status, 401);
  const res = await (await as('admin')).post('/system/api-keys', { name: 'scope test', scopes: ['audit:read'] });
  assert.equal(res.status, 428, 'step-up required');
  const { login } = require('./helpers');
  const stepUp = client(await login('admin@kestrelbank.test', 'Admin@Kestrel2026!'), { 'X-Confirm-Password': 'Admin@Kestrel2026!' });
  const key = await stepUp.post('/system/api-keys', { name: 'scope test', scopes: ['audit:read'] });
  assert.equal(key.status, 201);
  const k = client(null, { 'X-API-Key': key.body.data.apiKey });
  assert.equal((await k.get('/audit-logs?pageSize=1')).status, 200);
  assert.equal((await k.get('/reports/branch-performance')).status, 403);
  assert.equal((await k.get('/customers')).status, 403);
  assert.equal((await k.get('/system/network')).status, 403);
  assert.equal((await stepUp.delete(`/system/api-keys/${key.body.data.id}`)).status, 200);
  assert.equal((await k.get('/audit-logs?pageSize=1')).status, 401);
  assert.ok(admin);
});
