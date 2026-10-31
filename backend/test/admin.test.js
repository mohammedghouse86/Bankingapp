// Critical "guardrail" surface: step-up auth, guardrail event log, network/IP controls, roles, settings, reset.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, client, login, PW, as, request, app } = require('./helpers');

const ADMIN = 'admin@kestrelbank.test';
const stepUp = async (email = ADMIN, pw = PW.admin) => client(await login(email, pw), { 'X-Confirm-Password': pw });

test('critical endpoints require step-up re-authentication', async () => {
  const a = await as('admin');
  const r1 = await a.put('/system/network', { gateway: '10.20.4.254', reason: 'test' });
  assert.equal(r1.status, 428);
  const wrong = client(await login(ADMIN, PW.admin), { 'X-Confirm-Password': 'wrong' });
  assert.equal((await wrong.put('/system/network', { gateway: '10.20.4.254', reason: 'test' })).status, 403);
  const s = await stepUp();
  const ok = await s.put('/system/network', { gateway: '10.20.4.254', dnsServers: ['10.20.0.53'], reason: 'Gateway migration' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.gateway, '10.20.4.254');
  assert.equal((await s.put('/system/network', { gateway: '999.1.1.1', reason: 'bad' })).status, 400);
});

test('guardrail events record executed, blocked and unauthenticated attempts', async () => {
  const startId = db.guardrailEvents.length;
  await request(app).post('/api/v1/system/reset').send({ confirm: 'RESET ALL DATA' });
  const t = await as('tellerDowntown');
  await t.put('/settings/customerPerTransactionLimit', { value: 1, reason: 'x' });
  const s = await stepUp();
  await s.post('/system/network/ip-allowlist', { cidr: '198.51.100.77/32', label: 'Test laptop' });
  const events = db.guardrailEvents.slice(startId);
  assert.ok(events.some((e) => e.operationId === 'postSystemReset' && e.outcome === 'blocked' && e.actorUserId === null));
  assert.ok(events.some((e) => e.operationId === 'putSettingsByKey' && e.outcome === 'blocked' && e.actorRole === 'teller'));
  assert.ok(events.some((e) => e.operationId === 'postSystemNetworkIpAllowlist' && e.outcome === 'executed'));
  const list = await s.get('/system/guardrail-events?outcome=blocked&pageSize=100');
  assert.equal(list.status, 200);
  assert.ok(list.body.data.length >= 2);
  const catalog = await s.get('/system/sensitive-endpoints');
  assert.ok(catalog.body.data.length >= 20);
});

test('admin IP enforcement blocks super admins from non-allowlisted networks and cannot lock out the caller', async () => {
  const s = await stepUp();
  // Test requests come from loopback, which is not allowlisted in the seed.
  const enable = await s.put('/system/network/admin-ip-enforcement', { mode: 'enforce', reason: 'harden' });
  assert.equal(enable.status, 409);
  const add = await s.post('/system/network/ip-allowlist', { cidr: '127.0.0.1/32', label: 'Loopback' });
  assert.equal(add.status, 201);
  assert.equal((await s.post('/system/network/ip-allowlist', { cidr: '10.0.0.0/4', label: 'Too broad' })).status, 422);
  assert.equal((await s.put('/system/network/admin-ip-enforcement', { mode: 'enforce', reason: 'harden' })).status, 200);
  const removal = await s.delete(`/system/network/ip-allowlist/${add.body.data.id}`);
  assert.equal(removal.status, 409, 'would lock the caller out');
  db.network.ipAllowlist = db.network.ipAllowlist.filter((e) => e.cidr !== '127.0.0.1/32');
  const blocked = await request(app).post('/api/v1/auth/login').send({ email: 'secops.admin@kestrelbank.test', password: PW.admin });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'ADMIN_IP_NOT_ALLOWED');
  db.network.adminIpEnforcement = 'monitor';
});

test('role permissions can only be granted within grantable bounds', async () => {
  const s = await stepUp();
  const bad = await s.put('/roles/teller/permissions', { permissions: ['transactions:read', 'system:reset'], reason: 'escalate' });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, 'PERMISSION_NOT_GRANTABLE');
  assert.equal((await s.put('/roles/super_admin/permissions', { permissions: [], reason: 'x' })).status, 403);
  const current = (await s.get('/roles/teller/permissions')).body.data.permissions;
  const reduced = current.filter((p) => p !== 'transactions:withdraw');
  assert.equal((await s.put('/roles/teller/permissions', { permissions: reduced, reason: 'Withdrawals paused' })).status, 200);
  const t = client(await login('teller2.downtown@kestrelbank.test', PW.teller));
  const res = await t.post('/transactions/withdrawals', { accountId: 1, customerId: 1, amount: 1, idVerification: { documentType: 'passport', documentNumberLast4: '1234' } });
  assert.equal(res.status, 403, 'permission removal takes effect immediately');
  await s.put('/roles/teller/permissions', { permissions: current, reason: 'restore' });
});

test('settings are validated against bounds and branch limits', async () => {
  const s = await stepUp();
  assert.equal((await s.put('/settings/maxFailedLogins', { value: 1, reason: 'x' })).status, 422);
  assert.equal((await s.put('/settings/maxFailedLogins', { value: 4.5, reason: 'x' })).status, 400);
  assert.equal((await s.put('/settings/maxTellerCashWithdrawalLimit', { value: 600, reason: 'x' })).body.error.code, 'CAP_BELOW_BRANCH_LIMIT');
  assert.equal((await s.put('/settings/notARealSetting', { value: 1, reason: 'x' })).status, 404);
  assert.equal((await s.put('/settings/__proto__', { value: 1, reason: 'x' })).status, 400);
  const ok = await s.put('/settings/newBeneficiaryLimit', { value: 2500, reason: 'Policy update' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.value, 2500);
});

test('manager branch limits cannot exceed global caps', async () => {
  const m = await as('managerDowntown');
  const over = await m.put('/branches/1/limits', { approvalThreshold: 60000, tellerCashWithdrawalLimit: 5000, dailyCashWithdrawalLimit: 20000, largeDepositThreshold: 25000, reason: 'x' });
  assert.equal(over.status, 422);
  const ok = await m.put('/branches/1/limits', { approvalThreshold: 12000, tellerCashWithdrawalLimit: 5000, dailyCashWithdrawalLimit: 20000, largeDepositThreshold: 25000, reason: 'Busy season' });
  assert.equal(ok.status, 200);
});

test('employee lifecycle: role change, deactivation and deletion by super admin', async () => {
  const s = await stepUp();
  const created = await s.post('/users', { email: 'temp.staff@kestrelbank.test', firstName: 'Temp', lastName: 'Staff', role: 'teller', branchId: 2 });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  const self = db.users.find((u) => u.email === ADMIN);
  assert.equal((await s.put(`/users/${self.id}/role`, { role: 'teller', branchId: 1, reason: 'x' })).body.error.code, 'SELF_MANAGEMENT_FORBIDDEN');
  assert.equal((await s.put(`/users/${id}/role`, { role: 'manager', reason: 'Promotion' })).status, 200);
  const tc = client(await login('temp.staff@kestrelbank.test', created.body.data.temporaryPassword));
  assert.equal((await tc.get('/auth/me')).body.data.user.role, 'manager');
  assert.equal((await s.delete(`/users/${id}`)).status, 409, 'must be deactivated first');
  assert.equal((await s.post(`/users/${id}/deactivate`, { reason: 'Contract ended' })).status, 200);
  assert.equal((await tc.get('/auth/me')).status, 401, 'deactivation revokes sessions');
  assert.equal((await s.delete(`/users/${id}`)).status, 200);
});

test('customer contact change is step-up protected and notifies the old address', async () => {
  const cust = db.customers.find((c) => c.status === 'active' && c.userId && c.id < 10);
  const user = db.users.find((u) => u.id === cust.userId);
  const oldEmail = user.email;
  const plain = client(await login(oldEmail, PW.customer));
  assert.equal((await plain.put('/me/contact', { email: 'hijack@example.com' })).status, 428);
  const s = client(await login(oldEmail, PW.customer), { 'X-Confirm-Password': PW.customer });
  const taken = db.customers.find((c) => c.id !== cust.id).email;
  assert.equal((await s.put('/me/contact', { email: taken })).status, 409);
  const ok = await s.put('/me/contact', { email: 'new.address@example.com', phone: '+1-555-0100' });
  assert.equal(ok.status, 200);
  assert.ok(db.emailOutbox.some((m) => m.to === oldEmail && /contact details were changed/.test(m.subject)));
  assert.equal((await request(app).post('/api/v1/auth/login').send({ email: 'new.address@example.com', password: PW.customer })).status, 200);
});

test('bulk PII export is restricted to step-up super admins', async () => {
  const m = await as('managerDowntown');
  assert.equal((await m.get('/customers/export')).status, 403);
  const s = await stepUp();
  const res = await s.get('/customers/export?branchId=1');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.ok(res.text.split('\n').length > 10);
});

test('system reset restores the seed and revokes all sessions', async () => {
  const s = await stepUp();
  const before = db.accounts.length;
  await s.post('/accounts', { customerId: 1, type: 'savings', initialDeposit: 200 });
  assert.equal((await s.post('/system/reset', { confirm: 'reset' })).status, 400);
  const res = await s.post('/system/reset', { confirm: 'RESET ALL DATA' });
  assert.equal(res.status, 200);
  assert.equal(db.accounts.length, before);
  assert.equal((await s.get('/auth/me')).status, 401);
  assert.ok(db.guardrailEvents.some((e) => e.operationId === 'postSystemReset' && e.outcome === 'executed'), 'guardrail log survives reset');
});
