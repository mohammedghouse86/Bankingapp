// Spec completeness plus a crawl of every endpoint as every role: no route may return 5xx.
const test = require('node:test');
const assert = require('node:assert/strict');
const { request, app, db, login, PW } = require('./helpers');
const { routes, openApi } = require('../src/app');

test('OpenAPI document covers every registered route with unique operation IDs', async () => {
  const res = await request(app).get('/openapi.json');
  assert.equal(res.status, 200);
  const doc = res.body;
  const ops = Object.values(doc.paths).flatMap((p) => Object.values(p));
  assert.equal(ops.length, routes.length);
  assert.ok(routes.length >= 100, `expected >= 100 endpoints, got ${routes.length}`);
  assert.equal(new Set(ops.map((o) => o.operationId)).size, ops.length);
  assert.ok(ops.every((o) => ['standard', 'high', 'critical'].includes(o['x-risk-level'])));
  const refs = JSON.stringify(doc).match(/#\/components\/\w+\/\w+/g);
  refs.forEach((r) => { const [, , kind, name] = r.split('/'); assert.ok(doc.components[kind][name], `missing ${r}`); });
  assert.deepEqual(openApi().paths['/api/v1/accounts/{id}'].get.parameters[0].name, 'id');
});

const SAMPLE = { id: '1', customerId: '1', sessionId: '00000000-0000-4000-8000-000000000000', reference: 'TRF20260101ABCDEF', key: 'customerDailyTransferLimit', role: 'teller' };
const fillPath = (p) => p.replace(/:(\w+)/g, (m, k) => SAMPLE[k] || '1');
const QUERY = { '/accounts/:id/statement': '?from=2026-01-01&to=2026-12-31', '/accounts/:id/statement/download': '?from=2026-01-01&to=2026-12-31', '/accounts/lookup': `?accountNumber=${'4001100000'}`, '/reports/export': '?report=transaction-volume' };

const PRINCIPALS = [
  ['anonymous', null],
  ['customer', () => [db.users.find((u) => u.role === 'customer' && u.status === 'active').email, PW.customer]],
  ['teller', () => ['teller1.downtown@kestrelbank.test', PW.teller]],
  ['manager', () => ['manager.downtown@kestrelbank.test', PW.manager]],
  ['admin', () => ['admin@kestrelbank.test', PW.admin]],
];

test('every GET endpoint responds without server errors for every role', async () => {
  const gets = routes.filter((r) => r.method === 'get');
  for (const [name, creds] of PRINCIPALS) {
    const token = creds ? await login(...creds()) : null;
    for (const r of gets) {
      let req = request(app).get(`/api/v1${fillPath(r.path)}${QUERY[r.path] || ''}`);
      if (token) req = req.set('Authorization', `Bearer ${token}`);
      const res = await req;
      assert.ok(res.status < 500, `${name} GET ${r.path} -> ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
      if (!creds && r.auth) assert.equal(res.status, 401, `anonymous GET ${r.path} must require auth`);
    }
  }
});

test('every mutating endpoint rejects malformed input without server errors', async () => {
  // Step-up header included so validation (not step-up) is exercised for critical routes.
  const token = await login('admin@kestrelbank.test', PW.admin);
  const bodies = [{}, { unexpected: true }, [], 'not-json', { amount: 'NaN', id: -1 }];
  for (const r of routes.filter((x) => x.method !== 'get' && x.path !== '/system/reset' && x.path !== '/auth/logout' && x.path !== '/auth/logout-all')) {
    for (const body of bodies) {
      let req = request(app)[r.method](`/api/v1${fillPath(r.path)}`).set('Authorization', `Bearer ${token}`).set('X-Confirm-Password', PW.admin);
      req = typeof body === 'string' ? req.set('Content-Type', 'application/json').send(body) : req.send(body);
      const res = await req;
      assert.ok(res.status < 500, `${r.method.toUpperCase()} ${r.path} with ${JSON.stringify(body)} -> ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
    }
  }
});

test('unknown routes, bad JSON and oversized bodies return structured 4xx errors', async () => {
  const nf = await request(app).get('/api/v1/does-not-exist');
  assert.equal(nf.status, 404);
  assert.equal(nf.body.error.code, 'NOT_FOUND');
  const bad = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'MALFORMED_JSON');
  const big = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(100000) });
  assert.equal(big.status, 413);
});

test('security headers and CORS policy are applied', async () => {
  const res = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.ok(res.headers['strict-transport-security']);
  assert.ok(res.headers['x-request-id']);
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(res.headers['access-control-allow-origin'], undefined, 'untrusted origin gets no CORS grant');
  const ok = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173');
  assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.equal(res.headers['cache-control'], 'no-store');
});
