/*
 * Generates data/seed.json: a large, deterministic, entirely fictional banking
 * dataset. The API loads this file into memory at startup; every mutation made
 * through the API lives only in memory and is discarded on restart/reset.
 *
 * Usage: npm run seed:generate
 */
const fs = require('fs');
const path = require('path');
const { hashPasswordSync } = require('../src/lib/password');

// ---------------------------------------------------------------- PRNG ----
let rngState = 20261031;
function rand() {
  rngState |= 0; rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const pad = (n, w) => String(n).padStart(w, '0');

const NOW = new Date();
NOW.setUTCMinutes(0, 0, 0);
const DAY = 86400000;
const daysAgo = (d, hour = randInt(8, 18), minute = randInt(0, 59)) => {
  const t = new Date(NOW.getTime() - d * DAY);
  t.setUTCHours(hour, minute, randInt(0, 59), 0);
  return t;
};
const iso = (d) => d.toISOString();

// ------------------------------------------------------------ PASSWORDS ----
const PASSWORDS = {
  super_admin: 'Admin@Kestrel2026!',
  manager: 'Manager@Kestrel1!',
  teller: 'Teller@Kestrel1!',
  customer: 'Customer@Kestrel1!',
};
const hashCache = {};
// Every user gets an individually salted hash; generation takes a few seconds.
const hashFor = (role) => { hashCache[role] = (hashCache[role] || 0) + 1; return hashPasswordSync(PASSWORDS[role]); };

// --------------------------------------------------------------- NAMES ----
const FIRST = ['Ava', 'Liam', 'Maya', 'Noah', 'Zara', 'Ethan', 'Priya', 'Lucas', 'Elena', 'Mateo', 'Aisha', 'Owen', 'Chloe', 'Ravi', 'Sofia', 'Daniel', 'Hana', 'Marcus', 'Leila', 'Tomas', 'Grace', 'Kenji', 'Amara', 'Felix', 'Nadia', 'Hugo', 'Ingrid', 'Samir', 'Clara', 'Diego', 'Yuki', 'Isaac', 'Freya', 'Omar', 'Lena', 'Victor', 'Mira', 'Jonah', 'Talia', 'Arjun'];
const LAST = ['Thompson', 'Okafor', 'Lindqvist', 'Moreau', 'Castellano', 'Nakamura', 'Brennan', 'Haddad', 'Kowalski', 'Adeyemi', 'Fairbanks', 'Vasquez', 'Holloway', 'Iyer', 'Petrov', 'Delacroix', 'Whitfield', 'Mbeki', 'Sorensen', 'Calloway', 'Ferreira', 'Quinlan', 'Ashworth', 'Rahman', 'Vance', 'Marchetti', 'Osei', 'Linwood', 'Takeda', 'Brightwater'];
const STREETS = ['Harbor Way', 'Maple Avenue', 'Cedar Lane', 'Lakeview Drive', 'Willow Court', 'Summit Road', 'Orchard Street', 'Riverbend Blvd', 'Granite Place', 'Juniper Row'];
const OCCUPATIONS = ['Software Engineer', 'Nurse', 'Teacher', 'Architect', 'Accountant', 'Chef', 'Pharmacist', 'Electrician', 'Graphic Designer', 'Small Business Owner', 'Paramedic', 'Data Analyst', 'Retired', 'Student', 'Civil Engineer', 'Veterinarian'];

// ------------------------------------------------------------ BRANCHES ----
const branches = [
  { code: 'KB001', name: 'Downtown Main', city: 'Harbor City', state: 'CA', postalCode: '90001', street: '100 Harbor Plaza' },
  { code: 'KB002', name: 'Northside', city: 'Maple Falls', state: 'WA', postalCode: '98001', street: '42 Northgate Avenue' },
  { code: 'KB003', name: 'Westfield', city: 'Westfield', state: 'TX', postalCode: '75001', street: '7 Prairie Commons' },
  { code: 'KB004', name: 'Lakeshore', city: 'Cedar Point', state: 'MI', postalCode: '48001', street: '15 Lakefront Drive' },
].map((b, i) => ({
  id: i + 1,
  code: b.code,
  name: b.name,
  address: { line1: b.street, city: b.city, state: b.state, postalCode: b.postalCode, country: 'US' },
  phone: `+1-555-01${pad(10 + i, 2)}`,
  email: `${b.name.toLowerCase().replace(/\s+/g, '')}@kestrelbank.test`,
  routingNumber: `99900010${i + 1}`,
  status: 'active',
  managerId: null,
  openedAt: iso(daysAgo(1500 + i * 200)),
  tellersCanOnboard: i !== 2, // Westfield requires a manager to onboard customers
  limits: {
    approvalThreshold: [10000, 10000, 7500, 15000][i],
    tellerCashWithdrawalLimit: [5000, 5000, 3000, 7500][i],
    dailyCashWithdrawalLimit: [20000, 20000, 15000, 25000][i],
    largeDepositThreshold: [25000, 25000, 20000, 30000][i],
  },
  updatedAt: iso(daysAgo(30)),
}));

// --------------------------------------------------------------- USERS ----
const users = [];
let userId = 0;
function addUser(u) {
  userId += 1;
  const createdAt = u.createdAt || iso(daysAgo(randInt(200, 1200)));
  users.push({
    id: userId,
    email: u.email,
    passwordHash: hashFor(u.role),
    role: u.role,
    firstName: u.firstName,
    lastName: u.lastName,
    phone: u.phone || `+1-555-02${pad(userId % 100, 2)}`,
    branchId: u.branchId ?? null,
    customerId: u.customerId ?? null,
    status: u.status || 'active',
    employeeCode: u.role === 'customer' ? null : `EMP${pad(1000 + userId, 5)}`,
    title: u.title || null,
    hireDate: u.role === 'customer' ? null : createdAt.slice(0, 10),
    failedLoginAttempts: u.failedLoginAttempts || 0,
    lockedUntil: u.lockedUntil || null,
    lastLoginAt: u.lastLoginAt === undefined ? iso(daysAgo(randInt(0, 10))) : u.lastLoginAt,
    passwordChangedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  });
  return users[users.length - 1];
}

addUser({ email: 'admin@kestrelbank.test', role: 'super_admin', firstName: 'Morgan', lastName: 'Reyes', title: 'Chief Operations Officer', lastLoginAt: iso(daysAgo(1)) });
addUser({ email: 'secops.admin@kestrelbank.test', role: 'super_admin', firstName: 'Riley', lastName: 'Chen', title: 'Security Operations Lead' });

const branchSlugs = ['downtown', 'northside', 'westfield', 'lakeshore'];
const managers = branches.map((b, i) => {
  const m = addUser({
    email: `manager.${branchSlugs[i]}@kestrelbank.test`, role: 'manager', branchId: b.id,
    firstName: pick(FIRST), lastName: pick(LAST), title: 'Branch Manager',
  });
  b.managerId = m.id;
  return m;
});
addUser({ email: 'asst.manager.downtown@kestrelbank.test', role: 'manager', branchId: 1, firstName: 'Jordan', lastName: 'Abernathy', title: 'Assistant Branch Manager' });

const tellers = [];
branches.forEach((b, i) => {
  for (let n = 1; n <= 3; n += 1) {
    tellers.push(addUser({
      email: `teller${n}.${branchSlugs[i]}@kestrelbank.test`, role: 'teller', branchId: b.id,
      firstName: pick(FIRST), lastName: pick(LAST), title: n === 1 ? 'Senior Teller' : 'Teller',
    }));
  }
});
addUser({ email: 'former.teller@kestrelbank.test', role: 'teller', branchId: 2, firstName: 'Casey', lastName: 'Morrow', title: 'Teller', status: 'inactive', lastLoginAt: iso(daysAgo(140)) });
addUser({ email: 'locked.teller@kestrelbank.test', role: 'teller', branchId: 3, firstName: 'Drew', lastName: 'Pemberton', title: 'Teller', failedLoginAttempts: 5, lockedUntil: iso(new Date(NOW.getTime() + 3650 * DAY)), status: 'active' });

// ------------------------------------------------------------ CUSTOMERS ----
const CUSTOMER_COUNT = 84;
const customers = [];
const usedNames = new Set();
for (let i = 1; i <= CUSTOMER_COUNT; i += 1) {
  let first; let last;
  do { first = pick(FIRST); last = pick(LAST); } while (usedNames.has(`${first} ${last}`));
  usedNames.add(`${first} ${last}`);
  const branchId = ((i - 1) % 4) + 1;
  const createdAt = iso(daysAgo(randInt(130, 1400)));
  const dob = new Date(Date.UTC(randInt(1950, 2003), randInt(0, 11), randInt(1, 28)));
  let status = 'active';
  let kycStatus = 'verified';
  if ([17, 38, 59].includes(i)) { status = 'pending_verification'; kycStatus = i === 38 ? 'pending_review' : 'unverified'; }
  if ([23, 71].includes(i)) status = 'suspended';
  if (i === 80) status = 'closed';
  const docType = pick(['passport', 'drivers_license', 'national_id']);
  const docNumber = `${docType === 'passport' ? 'P' : docType === 'drivers_license' ? 'D' : 'N'}${pad(randInt(1000000, 9999999), 8)}`;
  const tellerForBranch = tellers.filter((t) => t.branchId === branchId)[0];
  customers.push({
    id: i,
    customerNumber: `CUS${pad(100000 + i * 37, 7)}`,
    firstName: first,
    lastName: last,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
    phone: `+1-555-03${pad(i % 100, 2)}`,
    dateOfBirth: dob.toISOString().slice(0, 10),
    nationalId: `SIM-${pad(randInt(100, 899), 3)}-${pad(randInt(10, 99), 2)}-${pad(randInt(1000, 9999), 4)}`,
    address: { line1: `${randInt(10, 9999)} ${pick(STREETS)}`, city: branches[branchId - 1].address.city, state: branches[branchId - 1].address.state, postalCode: branches[branchId - 1].address.postalCode, country: 'US' },
    occupation: pick(OCCUPATIONS),
    annualIncome: randInt(18, 240) * 1000,
    branchId,
    status,
    kycStatus,
    kyc: kycStatus === 'unverified' ? null : {
      documentType: docType,
      documentNumber: docNumber,
      score: kycStatus === 'verified' ? randInt(82, 99) : randInt(70, 90),
      submittedAt: createdAt,
      submittedBy: tellerForBranch.id,
      verifiedAt: kycStatus === 'verified' ? createdAt : null,
      verifiedBy: kycStatus === 'verified' ? managers[branchId - 1].id : null,
    },
    riskRating: chance(0.1) ? 'high' : chance(0.3) ? 'medium' : 'low',
    userId: null,
    createdBy: tellerForBranch.id,
    createdAt,
    updatedAt: createdAt,
  });
}

// Portal logins: most customers have one. The first few are documented test users.
customers.forEach((c) => {
  if (c.status === 'closed') return;
  if (c.id > 70 && c.id !== 71) return; // a handful of branch-only customers
  const u = addUser({
    email: c.email, role: 'customer', customerId: c.id, firstName: c.firstName, lastName: c.lastName,
    phone: c.phone, createdAt: c.createdAt, status: c.status === 'suspended' ? 'inactive' : 'active',
    lastLoginAt: c.id <= 60 ? iso(daysAgo(randInt(0, 20))) : null,
  });
  c.userId = u.id;
});

// ------------------------------------------------------------- ACCOUNTS ----
const accounts = [];
const accountHolders = [];
let accountSeq = 0;
function openAccount(customer, type, opts = {}) {
  accountSeq += 1;
  const b = customer.branchId;
  const openedAt = opts.openedAt || iso(daysAgo(randInt(125, Math.max(126, Math.floor((NOW - new Date(customer.createdAt)) / DAY)))));
  const acc = {
    id: accountSeq,
    accountNumber: `40${pad(b, 2)}${pad(100000 + accountSeq * 7919 % 900000, 6)}`,
    branchId: b,
    type,
    currency: 'USD',
    status: 'active',
    statusReason: null,
    balanceCents: 0,
    holdCents: 0,
    overdraftLimitCents: type === 'checking' && chance(0.4) ? pick([50000, 100000, 250000]) : 0,
    interestRate: type === 'savings' ? pick([2.1, 2.35, 2.6]) : type === 'fixed_deposit' ? pick([4.25, 4.6, 4.9]) : 0.05,
    nickname: opts.nickname || null,
    fixedDeposit: null,
    openedAt,
    openedBy: managers[b - 1].id,
    closedAt: null,
    lastActivityAt: openedAt,
    updatedAt: openedAt,
  };
  accounts.push(acc);
  accountHolders.push({ accountId: acc.id, customerId: customer.id, holderType: 'primary', addedAt: openedAt });
  return acc;
}

customers.forEach((c) => {
  if (c.kycStatus !== 'verified') return;
  openAccount(c, 'checking', { nickname: 'Everyday' });
  if (c.id % 2 === 0 || c.id <= 12) openAccount(c, 'savings', { nickname: 'Rainy day' });
  if (c.id % 7 === 0 || c.id === 1 || c.id === 5) openAccount(c, 'fixed_deposit');
  if (c.id % 11 === 0) openAccount(c, 'savings', { nickname: 'Travel fund' });
});

// Joint accounts: spouses/partners share a savings account.
[[1, 5], [2, 6], [3, 7], [10, 14], [21, 25]].forEach(([a, bId]) => {
  const owner = customers[a - 1];
  const acc = openAccount(owner, 'savings', { nickname: 'Joint household' });
  accountHolders.push({ accountId: acc.id, customerId: bId, holderType: 'joint', addedAt: acc.openedAt });
});

// ---------------------------------------------------------- BENEFICIARIES ----
const EXTERNAL_BANKS = [
  ['Bluefin Savings Bank (Simulated)', '999200111'],
  ['Summit Ridge Credit Union (Simulated)', '999200222'],
  ['Copperfield National (Simulated)', '999200333'],
  ['Evergreen Mutual (Simulated)', '999200444'],
];
const beneficiaries = [];
let benSeq = 0;
const primaryAccountsOf = (cid) => accountHolders.filter((h) => h.customerId === cid).map((h) => accounts.find((a) => a.id === h.accountId));
customers.forEach((c) => {
  if (c.status !== 'active' || !c.userId) return;
  const count = c.id <= 6 ? 3 : randInt(0, 3);
  for (let k = 0; k < count; k += 1) {
    benSeq += 1;
    const internal = chance(0.5);
    const createdAt = iso(daysAgo(randInt(100, 400)));
    let ben;
    if (internal) {
      const other = pick(customers.filter((o) => o.id !== c.id && o.kycStatus === 'verified' && o.status === 'active'));
      const target = primaryAccountsOf(other.id).find((a) => a.type === 'checking');
      ben = { name: `${other.firstName} ${other.lastName}`, accountNumber: target.accountNumber, bankName: 'Kestrel Bank', routingNumber: branches[target.branchId - 1].routingNumber, isInternal: true, internalAccountId: target.id };
    } else {
      const [bankName, routingNumber] = pick(EXTERNAL_BANKS);
      ben = { name: `${pick(FIRST)} ${pick(LAST)}`, accountNumber: `${randInt(10000000, 99999999)}${randInt(10, 99)}`, bankName, routingNumber, isInternal: false, internalAccountId: null };
    }
    beneficiaries.push({
      id: benSeq,
      customerId: c.id,
      ...ben,
      nickname: pick(['Landlord', 'Mom', 'Brother', 'Contractor', 'Book club', 'Roommate', 'Savings at other bank', 'Daycare', null]),
      status: chance(0.08) ? 'disabled' : 'active',
      dailyLimitCents: pick([200000, 500000, 1000000]),
      activationCodeHash: null,
      activationExpiresAt: null,
      activatedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });
  }
});

// ----------------------------------------------------------- TRANSACTIONS ----
const transactions = [];
const ledgerEntries = [];
let txnSeq = 0;
let ledgerSeq = 0;
const refFor = (prefix, date) => `${prefix}${date.toISOString().slice(0, 10).replace(/-/g, '')}${pad(randInt(0, 0xffffff).toString(16).toUpperCase(), 6)}${pad(txnSeq, 4)}`;

const events = [];
const tellerFor = (branchId) => pick(tellers.filter((t) => t.branchId === branchId));
const holdersOf = (accId) => accountHolders.filter((h) => h.accountId === accId).map((h) => h.customerId);

accounts.forEach((acc) => {
  const openDaysAgo = Math.floor((NOW - new Date(acc.openedAt)) / DAY);
  const historyStart = Math.min(openDaysAgo, 120);
  const customerId = holdersOf(acc.id)[0];
  if (acc.type === 'fixed_deposit') {
    const principal = pick([500000, 1000000, 2500000, 5000000]);
    events.push({ day: historyStart, kind: 'deposit', acc, amount: principal, desc: 'Fixed deposit placement', customerId });
    const term = pick([6, 12, 24, 36]);
    const maturity = new Date(new Date(acc.openedAt).getTime() + term * 30 * DAY);
    acc.fixedDeposit = { principalCents: principal, termMonths: term, maturityDate: iso(maturity), linkedAccountId: primaryAccountsOf(customerId).find((a) => a.type === 'checking')?.id || null };
    return;
  }
  events.push({ day: historyStart, kind: 'deposit', acc, amount: randInt(150, 1800) * 100 + (acc.type === 'savings' ? 500000 : 0), desc: 'Opening balance', customerId });
  for (let d = historyStart - 1; d >= 0; d -= 1) {
    if (acc.type === 'checking') {
      if (d % 14 === acc.id % 14) events.push({ day: d, kind: 'deposit', acc, amount: randInt(1800, 5200) * 100, desc: pick(['Payroll deposit', 'Salary credit', 'Cash deposit']), customerId });
      if (chance(0.13)) events.push({ day: d, kind: 'withdrawal', acc, amount: randInt(20, 600) * 100, desc: pick(['ATM-equivalent cash withdrawal', 'Branch cash withdrawal', 'Cash for travel']), customerId });
      if (chance(0.06)) events.push({ day: d, kind: 'beneficiary', acc, amount: randInt(50, 1500) * 100, customerId });
      if (chance(0.05)) events.push({ day: d, kind: 'own_transfer', acc, amount: randInt(100, 1200) * 100, customerId });
      if (d % 30 === 3) events.push({ day: d, kind: 'fee', acc, amount: 500, desc: 'Monthly maintenance fee', customerId });
    } else {
      if (d % 30 === 1) events.push({ day: d, kind: 'interest', acc, desc: 'Monthly interest credit', customerId });
      if (chance(0.03)) events.push({ day: d, kind: 'withdrawal', acc, amount: randInt(100, 800) * 100, desc: 'Savings withdrawal', customerId });
    }
  }
});

// Dormant accounts: no activity for over a year (skip their generated events).
const dormantIds = new Set(accounts.filter((a) => a.type === 'savings' && a.id % 13 === 0).map((a) => a.id));

events.sort((a, b) => b.day - a.day);

function post(type, { src, dst, amount, desc, date, initiator, channel, customerId, beneficiary, status = 'completed' }) {
  txnSeq += 1;
  const t = {
    id: txnSeq,
    reference: refFor(type === 'deposit' ? 'DEP' : type === 'withdrawal' ? 'WDL' : type === 'transfer' ? 'TRF' : type === 'interest' ? 'INT' : type === 'fee' ? 'FEE' : 'TXN', date),
    type,
    channel,
    status,
    amountCents: amount,
    currency: 'USD',
    sourceAccountId: src ? src.id : null,
    destinationAccountId: dst ? dst.id : null,
    beneficiaryId: beneficiary ? beneficiary.id : null,
    counterparty: beneficiary && !beneficiary.isInternal ? { name: beneficiary.name, bankName: beneficiary.bankName, accountNumber: beneficiary.accountNumber, routingNumber: beneficiary.routingNumber } : null,
    description: desc,
    customerId: customerId || null,
    branchId: (src || dst).branchId,
    initiatedBy: initiator ? initiator.id : null,
    initiatedByRole: initiator ? initiator.role : 'system',
    approvalId: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    reversalOfId: null,
    reversedById: null,
    idempotencyKey: null,
    sourceBalanceAfterCents: null,
    destinationBalanceAfterCents: null,
    createdAt: iso(date),
    completedAt: status === 'completed' ? iso(date) : null,
  };
  if (status === 'completed') {
    if (src) {
      src.balanceCents -= amount;
      t.sourceBalanceAfterCents = src.balanceCents;
      src.lastActivityAt = iso(date);
      ledgerSeq += 1;
      ledgerEntries.push({ id: ledgerSeq, transactionId: t.id, accountId: src.id, direction: 'debit', amountCents: amount, balanceAfterCents: src.balanceCents, createdAt: iso(date) });
    }
    if (dst) {
      dst.balanceCents += amount;
      t.destinationBalanceAfterCents = dst.balanceCents;
      dst.lastActivityAt = iso(date);
      ledgerSeq += 1;
      ledgerEntries.push({ id: ledgerSeq, transactionId: t.id, accountId: dst.id, direction: 'credit', amountCents: amount, balanceAfterCents: dst.balanceCents, createdAt: iso(date) });
    }
  }
  transactions.push(t);
  return t;
}

const customerUser = (cid) => users.find((u) => u.customerId === cid && u.role === 'customer');
const available = (a) => a.balanceCents + a.overdraftLimitCents - a.holdCents;

events.forEach((e) => {
  const { acc } = e;
  if (dormantIds.has(acc.id) && e.day < 110) return;
  const date = daysAgo(e.day);
  const teller = tellerFor(acc.branchId);
  const cu = customerUser(e.customerId);
  switch (e.kind) {
    case 'deposit':
      post('deposit', { dst: acc, amount: e.amount, desc: e.desc, date, initiator: e.desc.startsWith('Payroll') || e.desc.startsWith('Salary') ? null : teller, channel: e.desc.startsWith('Payroll') || e.desc.startsWith('Salary') ? 'ach' : 'branch', customerId: e.customerId });
      break;
    case 'withdrawal':
      if (acc.balanceCents - e.amount < 0) return;
      post('withdrawal', { src: acc, amount: e.amount, desc: e.desc, date, initiator: teller, channel: 'branch', customerId: e.customerId });
      break;
    case 'fee':
      if (acc.balanceCents - e.amount < 0) return;
      post('fee', { src: acc, amount: e.amount, desc: e.desc, date, initiator: null, channel: 'system', customerId: e.customerId });
      break;
    case 'interest': {
      const amount = Math.max(1, Math.round((acc.balanceCents * acc.interestRate) / 100 / 12));
      if (acc.balanceCents <= 0) return;
      post('interest', { dst: acc, amount, desc: e.desc, date, initiator: null, channel: 'system', customerId: e.customerId });
      break;
    }
    case 'own_transfer': {
      const target = primaryAccountsOf(e.customerId).find((a) => a.id !== acc.id && a.type !== 'fixed_deposit');
      if (!target || acc.balanceCents - e.amount < 0) return;
      post('transfer', { src: acc, dst: target, amount: e.amount, desc: 'Transfer between own accounts', date, initiator: cu || teller, channel: cu ? 'online' : 'branch', customerId: e.customerId });
      break;
    }
    case 'beneficiary': {
      const bens = beneficiaries.filter((b) => b.customerId === e.customerId && b.status === 'active' && b.createdAt < iso(date));
      if (!bens.length || !cu || acc.balanceCents - e.amount < 0) return;
      const ben = pick(bens);
      const dst = ben.isInternal ? accounts.find((a) => a.id === ben.internalAccountId) : null;
      post('transfer', { src: acc, dst, amount: e.amount, desc: `Payment to ${ben.nickname || ben.name}`, date, initiator: cu, channel: 'online', customerId: e.customerId, beneficiary: ben });
      break;
    }
    default:
  }
});

// Status adjustments after history is built.
accounts.forEach((a) => {
  if (dormantIds.has(a.id)) {
    a.status = 'dormant';
    a.statusReason = 'No customer-initiated activity for over 12 months';
    a.lastActivityAt = iso(daysAgo(randInt(380, 520)));
  }
});
const setStatus = (id, status, reason) => { const a = accounts.find((x) => x.id === id); a.status = status; a.statusReason = reason; };
setStatus(9, 'frozen', 'Suspicious activity review (case SAR-2031)');
setStatus(33, 'frozen', 'Court order - garnishment hold');
setStatus(58, 'frozen', 'Customer reported lost identity documents');
// Closed account: drain to zero via a final withdrawal.
const closing = accounts.find((a) => a.id === 46);
if (closing.balanceCents > 0) post('withdrawal', { src: closing, amount: closing.balanceCents, desc: 'Account closure payout', date: new Date(NOW.getTime() - 3 * 3600000), initiator: tellerFor(closing.branchId), channel: 'branch', customerId: holdersOf(46)[0] });
closing.status = 'closed'; closing.statusReason = 'Closed at customer request'; closing.closedAt = iso(new Date(NOW.getTime() - 3 * 3600000));
// Accounts of suspended customers are frozen.
customers.filter((c) => c.status === 'suspended').forEach((c) => primaryAccountsOf(c.id).forEach((a) => { if (a.status === 'active') { a.status = 'frozen'; a.statusReason = 'Customer profile suspended'; } }));

// ------------------------------------------------------ PENDING APPROVALS ----
const approvals = [];
let approvalSeq = 0;
function pending({ type, src, dst, amount, desc, initiator, channel, customerId, beneficiary, daysBack }) {
  const date = daysAgo(daysBack, 10);
  const t = post(type, { src, dst, amount, desc, date, initiator, channel, customerId, beneficiary, status: 'pending_approval' });
  if (src) src.holdCents += amount;
  approvalSeq += 1;
  const requiredRole = amount > 5000000 ? 'super_admin' : 'manager';
  approvals.push({ id: approvalSeq, transactionId: t.id, status: 'pending', requiredRole, branchId: t.branchId, amountCents: amount, requestedBy: initiator.id, reason: `Amount exceeds ${channel === 'online' ? 'online' : 'branch'} approval threshold`, decidedBy: null, decidedAt: null, decisionNote: null, createdAt: t.createdAt });
  t.approvalId = approvalSeq;
  return t;
}
const activeChecking = accounts.filter((a) => a.type === 'checking' && a.status === 'active');
const richest = [...activeChecking].sort((a, b) => b.balanceCents - a.balanceCents);
richest.slice(0, 12).forEach((acc, i) => {
  const cid = holdersOf(acc.id)[0];
  const teller = tellerFor(acc.branchId);
  const amount = Math.min(Math.floor(available(acc) * 0.6), [1250000, 1800000, 2200000, 6200000][i % 4]);
  if (amount < 1000000) return;
  if (i % 3 === 0) {
    pending({ type: 'withdrawal', src: acc, amount, desc: 'Large cash withdrawal - vehicle purchase', initiator: teller, channel: 'branch', customerId: cid, daysBack: i % 4 });
  } else if (i % 3 === 1) {
    const ben = beneficiaries.find((b) => b.customerId === cid && b.status === 'active');
    const cu = customerUser(cid);
    if (!ben || !cu) return;
    pending({ type: 'transfer', src: acc, dst: ben.isInternal ? accounts.find((a) => a.id === ben.internalAccountId) : null, amount, desc: 'Down payment transfer', initiator: cu, channel: 'online', customerId: cid, beneficiary: ben, daysBack: i % 3 });
  } else {
    pending({ type: 'deposit', dst: acc, amount: amount + 2000000, desc: 'Large cash deposit - business proceeds', initiator: teller, channel: 'branch', customerId: cid, daysBack: 1 });
  }
});
// High-value items above the manager approval limit (super admin required).
[1, 3].forEach((branchId) => {
  const acc = activeChecking.find((a) => a.branchId === branchId);
  pending({ type: 'deposit', dst: acc, amount: branchId === 1 ? 7500000 : 12000000, desc: 'Large cash deposit - property sale proceeds', initiator: tellerFor(branchId), channel: 'branch', customerId: holdersOf(acc.id)[0], daysBack: 0 });
});

// A few rejected and reversed historical transactions.
const rejectedSamples = transactions.filter((t) => t.type === 'withdrawal' && t.status === 'completed').slice(5, 8);
rejectedSamples.forEach((t, i) => {
  txnSeq += 1;
  const acc = accounts.find((a) => a.id === t.sourceAccountId);
  transactions.push({ ...t, id: txnSeq, reference: `WDL${t.reference.slice(3, 11)}R${pad(i, 2)}${pad(txnSeq, 4)}`, amountCents: 2500000, status: 'rejected', description: 'Large withdrawal request', rejectedBy: managers[acc.branchId - 1].id, rejectionReason: 'Customer could not be reached to confirm the request', completedAt: null, sourceBalanceAfterCents: null, destinationBalanceAfterCents: null });
});
const reversible = transactions.filter((t) => t.type === 'deposit' && t.status === 'completed' && t.channel === 'branch' && t.description === 'Cash deposit').slice(0, 3);
reversible.forEach((orig) => {
  const acc = accounts.find((a) => a.id === orig.destinationAccountId);
  if (acc.balanceCents < orig.amountCents) return;
  const date = new Date(NOW.getTime() - 2 * 3600000);
  const rev = post('reversal', { src: acc, amount: orig.amountCents, desc: `Reversal of ${orig.reference}: duplicate posting`, date, initiator: managers[acc.branchId - 1], channel: 'branch', customerId: orig.customerId });
  rev.reversalOfId = orig.id;
  orig.status = 'reversed';
  orig.reversedById = rev.id;
});

// --------------------------------------------------- REQUESTS & DISPUTES ----
const serviceRequests = [];
const SR_TYPES = ['cheque_book', 'statement', 'address_change', 'card_replacement', 'general_inquiry', 'limit_increase'];
for (let i = 1; i <= 64; i += 1) {
  const c = customers[randInt(0, 69)];
  const acc = primaryAccountsOf(c.id)[0];
  const type = pick(SR_TYPES);
  const status = pick(['open', 'open', 'in_progress', 'resolved', 'resolved', 'rejected', 'cancelled']);
  const createdAt = iso(daysAgo(randInt(0, 90)));
  const details = type === 'cheque_book' ? { leaves: pick([25, 50]), deliveryMethod: pick(['branch_pickup', 'mail']) }
    : type === 'statement' ? { fromDate: iso(daysAgo(90)).slice(0, 10), toDate: iso(daysAgo(1)).slice(0, 10), format: 'pdf' }
      : type === 'limit_increase' ? { requestedDailyLimit: pick([75000, 100000]) } : {};
  serviceRequests.push({
    id: i,
    reference: `SR${createdAt.slice(0, 10).replace(/-/g, '')}${pad(i, 4)}`,
    customerId: c.id,
    accountId: acc ? acc.id : null,
    branchId: c.branchId,
    type,
    status,
    subject: { cheque_book: 'Cheque book request', statement: 'Paper statement request', address_change: 'Update mailing address', card_replacement: 'Replace damaged debit card', general_inquiry: 'Question about fees', limit_increase: 'Increase daily transfer limit' }[type],
    description: pick(['Please process at your earliest convenience.', 'Needed before the end of the month.', 'Thank you for your help.', 'Urgent - travelling next week.']),
    details,
    assignedTo: status === 'open' ? null : tellerFor(c.branchId).id,
    resolutionNote: status === 'resolved' ? 'Completed and customer notified.' : status === 'rejected' ? 'Request does not meet policy requirements.' : null,
    createdBy: c.userId,
    createdAt,
    updatedAt: createdAt,
  });
}

const disputes = [];
const disputable = transactions.filter((t) => t.type === 'transfer' && t.status === 'completed' && t.channel === 'online').slice(0, 14);
disputable.forEach((t, i) => {
  const status = pick(['open', 'under_review', 'resolved_refunded', 'rejected']);
  disputes.push({
    id: i + 1,
    reference: `DSP${t.createdAt.slice(0, 10).replace(/-/g, '')}${pad(i + 1, 4)}`,
    transactionId: t.id,
    customerId: t.customerId,
    accountId: t.sourceAccountId,
    branchId: t.branchId,
    reason: pick(['unauthorized', 'incorrect_amount', 'duplicate', 'not_received']),
    description: pick(['I do not recognise this payment.', 'Amount debited is higher than agreed.', 'Payment was taken twice.', 'Recipient says the funds never arrived.']),
    status,
    resolution: status === 'resolved_refunded' ? 'Refund issued after investigation.' : status === 'rejected' ? 'Transaction was verified as authorized.' : null,
    resolvedBy: ['resolved_refunded', 'rejected'].includes(status) ? managers[t.branchId - 1].id : null,
    resolvedAt: ['resolved_refunded', 'rejected'].includes(status) ? t.createdAt : null,
    refundTransactionId: null,
    createdAt: t.createdAt,
    updatedAt: t.createdAt,
  });
});

const customerNotes = [];
for (let i = 1; i <= 40; i += 1) {
  const c = customers[randInt(0, 83)];
  const author = pick([...tellers.filter((t) => t.branchId === c.branchId), managers[c.branchId - 1]]);
  customerNotes.push({ id: i, customerId: c.id, authorId: author.id, body: pick(['Customer prefers contact by email.', 'Discussed fixed deposit renewal options.', 'Verified address by utility bill.', 'Customer asked about mortgage pre-approval.', 'Flagged for annual KYC refresh.', 'Called regarding a disputed card payment.']), createdAt: iso(daysAgo(randInt(0, 200))) });
}

// -------------------------------------------------------- NOTIFICATIONS ----
const notifications = [];
let notifSeq = 0;
users.filter((u) => u.role === 'customer').forEach((u) => {
  const n = randInt(1, 5);
  for (let k = 0; k < n; k += 1) {
    notifSeq += 1;
    const createdAt = iso(daysAgo(randInt(0, 30)));
    const kind = pick(['transaction', 'security', 'service', 'marketing']);
    notifications.push({
      id: notifSeq, userId: u.id, type: kind,
      title: { transaction: 'Deposit received', security: 'New sign-in to your account', service: 'Service request updated', marketing: 'New fixed deposit rates' }[kind],
      message: { transaction: 'A deposit was credited to your account.', security: 'We noticed a new sign-in. If this was not you, change your password.', service: 'Your service request status has changed.', marketing: 'Fixed deposits now earn up to 4.90% APY.' }[kind],
      link: null, readAt: chance(0.6) ? createdAt : null, createdAt,
    });
  }
});
approvals.forEach((a) => {
  users.filter((u) => u.role === 'manager' && u.branchId === a.branchId).forEach((m) => {
    notifSeq += 1;
    notifications.push({ id: notifSeq, userId: m.id, type: 'approval', title: 'Transaction awaiting approval', message: `A transaction requires your approval (approval #${a.id}).`, link: `/approvals/${a.id}`, readAt: null, createdAt: a.createdAt });
  });
});

// ------------------------------------------------------------ AUDIT LOG ----
const auditLogs = [];
let auditSeq = 0;
const IPS = ['198.51.100.23', '198.51.100.47', '203.0.113.88', '192.0.2.14', '192.0.2.201'];
for (let i = 0; i < 420; i += 1) {
  const u = pick(users.filter((x) => x.status === 'active'));
  const action = pick(u.role === 'customer' ? ['auth.login', 'auth.login', 'auth.logout', 'account.statement_view', 'auth.login_failed', 'service_request.create'] : u.role === 'teller' ? ['auth.login', 'auth.logout', 'transaction.deposit', 'transaction.withdrawal', 'customer.create', 'auth.login_failed'] : ['auth.login', 'auth.logout', 'transaction.approve', 'account.freeze', 'customer.kyc_approve', 'settings.update', 'auth.login_failed']);
  auditSeq += 1;
  auditLogs.push({
    id: auditSeq, actorUserId: action === 'auth.login_failed' ? null : u.id, actorRole: action === 'auth.login_failed' ? null : u.role,
    action, entityType: action.split('.')[0], entityId: action.startsWith('auth') ? u.id : randInt(1, 80), branchId: u.branchId,
    outcome: action === 'auth.login_failed' ? 'failure' : 'success', riskLevel: 'standard', ip: pick(IPS), userAgent: 'Mozilla/5.0 (simulated)', requestId: null,
    details: action === 'auth.login_failed' ? { email: u.email, reason: 'invalid_credentials' } : {}, createdAt: iso(daysAgo(randInt(0, 60))),
  });
}
auditLogs.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).forEach((a, i) => { a.id = i + 1; });

// ------------------------------------------------------ SETTINGS & RBAC ----
const settings = {
  customerPerTransactionLimit: { value: 25000, type: 'currency', min: 100, max: 1000000, description: 'Maximum single online transfer by a customer (USD).' },
  customerDailyTransferLimit: { value: 50000, type: 'currency', min: 100, max: 2000000, description: 'Maximum total online transfers per source account per day (USD).' },
  customerApprovalThreshold: { value: 10000, type: 'currency', min: 100, max: 1000000, description: 'Online transfers above this amount require manager approval (USD).' },
  newBeneficiaryLimit: { value: 2000, type: 'currency', min: 0, max: 100000, description: 'Maximum transfer to a beneficiary within 24 hours of activation (USD).' },
  managerApprovalLimit: { value: 50000, type: 'currency', min: 1000, max: 10000000, description: 'Managers may approve transactions up to this amount; larger ones require a super admin (USD).' },
  reversalWindowDays: { value: 30, type: 'integer', min: 1, max: 180, description: 'Completed transactions can be reversed within this many days.' },
  maxOverdraftLimit: { value: 5000, type: 'currency', min: 0, max: 50000, description: 'Maximum overdraft a manager may grant on a checking account (USD).' },
  fdPrematurePenaltyRate: { value: 1.0, type: 'percent', min: 0, max: 10, description: 'Penalty applied to principal when a fixed deposit is broken early (%).' },
  minimumOpeningDeposit: { value: 100, type: 'currency', min: 0, max: 10000, description: 'Minimum initial deposit for savings and checking accounts (USD).' },
  maxFailedLogins: { value: 5, type: 'integer', min: 3, max: 20, description: 'Consecutive failed logins before the user is locked out.' },
  lockoutMinutes: { value: 15, type: 'integer', min: 1, max: 1440, description: 'Lockout duration after too many failed logins.' },
  passwordResetTokenMinutes: { value: 30, type: 'integer', min: 5, max: 240, description: 'Validity of password reset tokens.' },
  maxBranchApprovalThreshold: { value: 50000, type: 'currency', min: 1000, max: 1000000, description: 'Upper bound managers may set for their branch approval threshold (USD).' },
  maxTellerCashWithdrawalLimit: { value: 20000, type: 'currency', min: 500, max: 200000, description: 'Upper bound for branch teller cash-withdrawal limits (USD).' },
  maxDailyCashWithdrawalLimit: { value: 100000, type: 'currency', min: 1000, max: 1000000, description: 'Upper bound for branch daily cash-withdrawal limits (USD).' },
  maxLargeDepositThreshold: { value: 100000, type: 'currency', min: 1000, max: 1000000, description: 'Upper bound for branch large-deposit review thresholds (USD).' },
};
Object.values(settings).forEach((s) => { s.updatedBy = 1; s.updatedAt = iso(daysAgo(45)); });

// ------------------------------------------------- NETWORK & API KEYS ----
const network = {
  config: {
    hostname: 'core-banking-api-01',
    publicIp: '203.0.113.10',
    privateIp: '10.20.4.15',
    subnetMask: '255.255.255.0',
    gateway: '10.20.4.1',
    dnsServers: ['10.20.0.53', '10.20.0.54'],
    ntpServer: 'time.kestrelbank.test',
    smtpRelay: 'smtp-relay.kestrelbank.test:587',
    swiftGatewayHost: 'swift-gw.kestrelbank.test',
    updatedBy: 1,
    updatedAt: iso(daysAgo(60)),
  },
  adminIpEnforcement: 'monitor',
  ipAllowlist: [
    { id: 1, cidr: '198.51.100.0/24', label: 'Head office VPN egress', createdBy: 1, createdAt: iso(daysAgo(300)) },
    { id: 2, cidr: '203.0.113.0/26', label: 'Branch network (all branches)', createdBy: 1, createdAt: iso(daysAgo(300)) },
    { id: 3, cidr: '192.0.2.14/32', label: 'SOC analyst workstation', createdBy: 2, createdAt: iso(daysAgo(120)) },
  ],
};
const apiKeys = [
  { id: 1, name: 'Regulatory reporting export', prefix: 'kb_live_7Hq2', keyHash: 'unrecoverable-seeded-key', scopes: ['reports:system'], createdBy: 1, createdAt: iso(daysAgo(200)), lastUsedAt: iso(daysAgo(2)), revokedAt: null },
  { id: 2, name: 'SIEM audit log forwarder', prefix: 'kb_live_P0xa', keyHash: 'unrecoverable-seeded-key', scopes: ['audit:read'], createdBy: 2, createdAt: iso(daysAgo(150)), lastUsedAt: iso(daysAgo(0)), revokedAt: null },
];

// ---------------------------------------------------------------- WRITE ----
const seed = {
  meta: {
    generatedAt: NOW.toISOString(),
    description: 'Kestrel Bank simulated dataset. Entirely fictional. Do not use real data.',
    testCredentials: PASSWORDS,
  },
  branches, users, customers, accounts, accountHolders, beneficiaries, transactions, ledgerEntries,
  approvals, serviceRequests, disputes, customerNotes, notifications, auditLogs, settings,
  network, apiKeys, emailOutbox: [],
};

const out = path.join(__dirname, '..', 'data', 'seed.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(seed));
const counts = Object.fromEntries(Object.entries(seed).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]));
console.log(`Wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
console.log(counts);
