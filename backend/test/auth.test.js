const test = require('node:test');
const assert = require('node:assert/strict');
const { request, app, db, PW, client } = require('./helpers');

const login = (email, password) => request(app).post('/api/v1/auth/login').send({ email, password });

test('each role can log in and receives its own permission set', async () => {
  const cases = [
    ['admin@kestrelbank.test', PW.admin, 'super_admin'],
    ['manager.northside@kestrelbank.test', PW.manager, 'manager'],
    ['teller1.westfield@kestrelbank.test', PW.teller, 'teller'],
    [db.users.find((u) => u.role === 'customer' && u.status === 'active').email, PW.customer, 'customer'],
  ];
  for (const [email, pw, role] of cases) {
    const res = await login(email, pw);
    assert.equal(res.status, 200, email);
    assert.equal(res.body.data.user.role, role);
    assert.ok(res.body.data.accessToken && res.body.data.refreshToken);
    assert.equal(res.body.data.user.passwordHash, undefined, 'password hash must never be returned');
    if (role === 'customer') assert.ok(res.body.data.permissions.every((p) => p.startsWith('portal:')));
  }
});

test('invalid credentials return a generic 401 for unknown and known emails', async () => {
  const a = await login('nobody@example.com', 'Whatever1!x');
  const b = await login('teller2.westfield@kestrelbank.test', 'Wrong-Password1!');
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.body.error.message, b.body.error.message);
});

test('account locks after repeated failures', async () => {
  const email = 'teller3.westfield@kestrelbank.test';
  for (let i = 0; i < 5; i += 1) assert.equal((await login(email, 'Bad-password-1!')).status, 401);
  const locked = await login(email, PW.teller);
  assert.equal(locked.status, 423);
  assert.equal(locked.body.error.code, 'ACCOUNT_LOCKED');
});

test('seeded locked and inactive employees cannot sign in', async () => {
  assert.equal((await login('locked.teller@kestrelbank.test', PW.teller)).status, 423);
  const inactive = await login('former.teller@kestrelbank.test', PW.teller);
  assert.equal(inactive.status, 403);
  assert.equal(inactive.body.error.code, 'ACCOUNT_DISABLED');
});

test('refresh tokens rotate and reuse revokes the session', async () => {
  const first = await login('teller1.lakeshore@kestrelbank.test', PW.teller);
  const r1 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first.body.data.refreshToken });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.body.data.refreshToken, first.body.data.refreshToken);
  const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first.body.data.refreshToken });
  assert.equal(reuse.status, 401);
  // Session is now revoked: the rotated token and access token stop working too.
  const r2 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: r1.body.data.refreshToken });
  assert.equal(r2.status, 401);
  assert.equal((await client(r1.body.data.accessToken).get('/auth/me')).status, 401);
});

test('logout revokes the access token immediately', async () => {
  const res = await login('teller2.lakeshore@kestrelbank.test', PW.teller);
  const c = client(res.body.data.accessToken);
  assert.equal((await c.get('/auth/me')).status, 200);
  assert.equal((await c.post('/auth/logout')).status, 200);
  assert.equal((await c.get('/auth/me')).status, 401);
});

test('tampered or unsigned tokens are rejected', async () => {
  const res = await login('teller3.lakeshore@kestrelbank.test', PW.teller);
  const [h, p] = res.body.data.accessToken.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  payload.role = 'super_admin';
  const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
  assert.equal((await client(forged).get('/auth/me')).status, 401);
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
  assert.equal((await client(none).get('/auth/me')).status, 401);
});

test('change password requires the current password and enforces strength', async () => {
  const res = await login('teller2.northside@kestrelbank.test', PW.teller);
  const c = client(res.body.data.accessToken);
  assert.equal((await c.post('/auth/change-password', { currentPassword: 'nope', newPassword: 'Another@Pass123' })).status, 403);
  assert.equal((await c.post('/auth/change-password', { currentPassword: PW.teller, newPassword: 'weak' })).status, 400);
  assert.equal((await c.post('/auth/change-password', { currentPassword: PW.teller, newPassword: 'Another@Pass123' })).status, 200);
  assert.equal((await login('teller2.northside@kestrelbank.test', 'Another@Pass123')).status, 200);
});

test('forgot/reset password flow delivers a single-use token via the outbox', async () => {
  const email = 'teller3.northside@kestrelbank.test';
  const unknown = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ghost@example.com' });
  const known = await request(app).post('/api/v1/auth/forgot-password').send({ email });
  assert.equal(unknown.status, 202);
  assert.equal(known.status, 202);
  assert.deepEqual(unknown.body, known.body, 'responses must not reveal registration');
  const mail = db.emailOutbox.filter((m) => m.to === email).pop();
  const token = mail.body.match(/token=([\w-]+)/)[1];
  const reset = await request(app).post('/api/v1/auth/reset-password').send({ token, newPassword: 'Reset@Pass2026' });
  assert.equal(reset.status, 200);
  const again = await request(app).post('/api/v1/auth/reset-password').send({ token, newPassword: 'Reset@Pass2027' });
  assert.equal(again.status, 400);
  assert.equal((await login(email, 'Reset@Pass2026')).status, 200);
});

test('self-registration creates a pending customer who cannot open accounts yet', async () => {
  const body = {
    firstName: 'Testy', lastName: 'Applicant', email: 'testy.applicant@example.com', phone: '+1-555-0199', dateOfBirth: '1990-04-12',
    branchId: 2, address: { line1: '1 Test Way', city: 'Maple Falls', state: 'WA', postalCode: '98001', country: 'US' }, password: 'Register@2026x',
  };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  assert.equal(res.status, 201);
  assert.equal(res.body.data.customer.status, 'pending_verification');
  assert.equal((await request(app).post('/api/v1/auth/register').send(body)).status, 409);
  const extra = await request(app).post('/api/v1/auth/register').send({ ...body, email: 'x2@example.com', role: 'super_admin' });
  assert.equal(extra.status, 400, 'unknown fields such as role are rejected');
  const minor = await request(app).post('/api/v1/auth/register').send({ ...body, email: 'kid@example.com', dateOfBirth: '2015-01-01' });
  assert.equal(minor.status, 400);
});

test('session listing and revocation are limited to the caller', async () => {
  const a = await login('manager.lakeshore@kestrelbank.test', PW.manager);
  const c = client(a.body.data.accessToken);
  const sessions = await c.get('/auth/sessions');
  assert.equal(sessions.status, 200);
  assert.ok(sessions.body.data.some((x) => x.current));
  const someoneElse = db.sessions.find((x) => x.userId !== a.body.data.user.id);
  assert.equal((await c.delete(`/auth/sessions/${someoneElse.id}`)).status, 404);
});
