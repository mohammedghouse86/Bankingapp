// Runs in its own process with a tiny auth limit to verify brute-force throttling.
process.env.AUTH_RATE_LIMIT_MAX = '5';
const test = require('node:test');
const assert = require('node:assert/strict');
const { request, app } = require('./helpers');

test('login endpoint is rate limited per client', async () => {
  const statuses = [];
  for (let i = 0; i < 8; i += 1) {
    const res = await request(app).post('/api/v1/auth/login').send({ email: `nobody${i}@example.com`, password: 'Wrong-pass-1!' });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
  assert.ok(statuses.slice(5).every((s) => s === 429));
  const res = await request(app).post('/api/v1/auth/login').send({ email: 'x@example.com', password: 'y' });
  assert.equal(res.body.error.code, 'RATE_LIMITED');
  assert.ok(res.headers.ratelimit || res.headers['ratelimit-policy']);
});
