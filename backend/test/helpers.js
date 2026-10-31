// Shared test harness: an in-process app with generous rate limits and a
// freshly loaded dataset per test file (node --test runs each file in its own process).
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '1000000';
process.env.AUTH_RATE_LIMIT_MAX = process.env.AUTH_RATE_LIMIT_MAX || '1000000';

const request = require('supertest');
const { createApp, initData } = require('../src/app');
const { db } = require('../src/store');

initData();
const app = createApp();

const PW = {
  admin: 'Admin@Kestrel2026!',
  manager: 'Manager@Kestrel1!',
  teller: 'Teller@Kestrel1!',
  customer: 'Customer@Kestrel1!',
};

const tokenCache = {};
async function login(email, password) {
  if (tokenCache[email]) return tokenCache[email];
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  tokenCache[email] = res.body.data.accessToken;
  return tokenCache[email];
}

function client(token, extraHeaders = {}) {
  const wrap = (method) => (path, body) => {
    let r = request(app)[method](`/api/v1${path}`);
    if (token) r = r.set('Authorization', `Bearer ${token}`);
    Object.entries(extraHeaders).forEach(([k, v]) => { r = r.set(k, v); });
    return body !== undefined ? r.send(body) : r;
  };
  return { get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), delete: wrap('delete') };
}

async function as(who) {
  const map = {
    admin: ['admin@kestrelbank.test', PW.admin],
    managerDowntown: ['manager.downtown@kestrelbank.test', PW.manager],
    asstManagerDowntown: ['asst.manager.downtown@kestrelbank.test', PW.manager],
    managerNorthside: ['manager.northside@kestrelbank.test', PW.manager],
    tellerDowntown: ['teller1.downtown@kestrelbank.test', PW.teller],
    teller2Downtown: ['teller2.downtown@kestrelbank.test', PW.teller],
    tellerNorthside: ['teller1.northside@kestrelbank.test', PW.teller],
  };
  if (map[who]) return client(await login(...map[who]));
  throw new Error(`unknown principal ${who}`);
}

async function asCustomer(customer) {
  const user = db.users.find((u) => u.id === customer.userId);
  return client(await login(user.email, PW.customer));
}

// ---- fixture finders over the live in-memory dataset ----
const holders = (accountId) => db.accountHolders.filter((h) => h.accountId === accountId).map((h) => h.customerId);
const accountsOf = (customerId) => db.accountHolders.filter((h) => h.customerId === customerId).map((h) => db.accounts.find((a) => a.id === h.accountId));

/** Active, verified customer with portal login and an active checking account with funds in the given branch. */
function richCustomer(branchId, minCents = 500000, exclude = []) {
  return db.customers.find((c) => c.branchId === branchId && c.status === 'active' && c.kycStatus === 'verified' && c.userId && !exclude.includes(c.id)
    && db.users.find((u) => u.id === c.userId).status === 'active'
    && accountsOf(c.id).some((a) => a.type === 'checking' && a.status === 'active' && holders(a.id).length === 1 && a.balanceCents - a.holdCents >= minCents)
    && accountsOf(c.id).filter((a) => a.type !== 'fixed_deposit' && a.status === 'active').length >= 2);
}

function checkingOf(customer) {
  return accountsOf(customer.id).find((a) => a.type === 'checking' && a.status === 'active' && holders(a.id).length === 1);
}

function otherActiveAccount(customer, exceptId) {
  return accountsOf(customer.id).find((a) => a.id !== exceptId && a.type !== 'fixed_deposit' && a.status === 'active');
}

module.exports = { app, request, db, PW, login, client, as, asCustomer, holders, accountsOf, richCustomer, checkingOf, otherActiveAccount };
