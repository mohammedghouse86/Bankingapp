/*
 * Restricted admin area (deliberate test target).
 *
 * Every endpoint lives under /admin/restricted and has NO access control:
 * no login is required and no role or permission is checked, so any caller
 * (anonymous, customer, teller, manager, super admin) can read and change
 * this data. The UI page is linked only from the manager menu, but its path
 * is reachable by every role.
 *
 * All records are synthetic. They look like confidential banking and PII data
 * so that a security product can be tested on it. Data resets on restart.
 */
const { z } = require('zod');
const { route } = require('../lib/registry');

const TAG = 'Restricted admin';
const BODY = z.object({}).passthrough();

function notFound(res) {
  return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
}

function crud(name, label, rows) {
  const base = `/admin/restricted/${name}`;
  let lastId = rows.reduce((max, r) => Math.max(max, r.id), 0);

  route({
    method: 'get', path: base, tag: TAG, auth: false,
    summary: `List ${label}`,
    handler: (req, res) => res.json({ data: rows }),
  });

  route({
    method: 'get', path: `${base}/:id`, tag: TAG, auth: false,
    summary: `Get one ${label} record`,
    handler: (req, res) => {
      const row = rows.find((r) => String(r.id) === req.params.id);
      return row ? res.json({ data: row }) : notFound(res);
    },
  });

  route({
    method: 'post', path: base, tag: TAG, auth: false, status: 201,
    summary: `Create a ${label} record`,
    body: BODY,
    handler: (req, res) => {
      lastId += 1;
      const row = { ...req.body, id: lastId };
      rows.push(row);
      res.status(201).json({ data: row });
    },
  });

  route({
    method: 'put', path: `${base}/:id`, tag: TAG, auth: false,
    summary: `Replace a ${label} record`,
    body: BODY,
    handler: (req, res) => {
      const i = rows.findIndex((r) => String(r.id) === req.params.id);
      if (i < 0) return notFound(res);
      rows[i] = { ...req.body, id: rows[i].id };
      return res.json({ data: rows[i] });
    },
  });

  route({
    method: 'delete', path: `${base}/:id`, tag: TAG, auth: false,
    summary: `Delete a ${label} record`,
    handler: (req, res) => {
      const i = rows.findIndex((r) => String(r.id) === req.params.id);
      if (i < 0) return notFound(res);
      const [gone] = rows.splice(i, 1);
      return res.json({ data: { deleted: true, id: gone.id } });
    },
  });
}

// ----------------------------------------------------------- synthetic data ----

const accounts = [
  { id: 1, holder: 'Vanessa Crane', accountNumber: '9990000101', routingNumber: '999000199', type: 'private_banking', balance: 4850000.22, classification: 'confidential', notes: 'Offshore trust funding' },
  { id: 2, holder: 'Julian Marsh', accountNumber: '9990000102', routingNumber: '999000199', type: 'private_banking', balance: 2315800.9, classification: 'confidential', notes: 'Executive compensation' },
  { id: 3, holder: 'Priya Okonkwo', accountNumber: '9990000103', routingNumber: '999000199', type: 'trust', balance: 990400.0, classification: 'secret', notes: 'Family office settlement' },
  { id: 4, holder: 'Tomas Reyes', accountNumber: '9990000104', routingNumber: '999000199', type: 'private_banking', balance: 670120.45, classification: 'confidential', notes: 'Property sale proceeds' },
  { id: 5, holder: 'Hannah Lindqvist', accountNumber: '9990000105', routingNumber: '999000199', type: 'trust', balance: 1205000.0, classification: 'secret', notes: 'Estate account' },
];

const customers = [
  { id: 1, fullName: 'Vanessa Crane', dateOfBirth: '1971-03-14', ssn: '900-11-0001', passport: 'XK1002231', email: 'vanessa.crane@example.test', phone: '+1-555-0141', address: '12 Marble Row, Harbor City' },
  { id: 2, fullName: 'Julian Marsh', dateOfBirth: '1968-09-02', ssn: '900-11-0002', passport: 'XK1002232', email: 'julian.marsh@example.test', phone: '+1-555-0142', address: '48 Cedar Crest, Maple Falls' },
  { id: 3, fullName: 'Priya Okonkwo', dateOfBirth: '1980-06-21', ssn: '900-11-0003', passport: 'XK1002233', email: 'priya.okonkwo@example.test', phone: '+1-555-0143', address: '7 Lakeview Terrace, Westfield' },
  { id: 4, fullName: 'Tomas Reyes', dateOfBirth: '1975-12-08', ssn: '900-11-0004', passport: 'XK1002234', email: 'tomas.reyes@example.test', phone: '+1-555-0144', address: '901 Dune Road, Lakeshore' },
  { id: 5, fullName: 'Hannah Lindqvist', dateOfBirth: '1990-01-30', ssn: '900-11-0005', passport: 'XK1002235', email: 'hannah.lindqvist@example.test', phone: '+1-555-0145', address: '3 Birch Lane, Harbor City' },
];

const records = [
  { id: 1, subject: 'Vanessa Crane', type: 'tax_return', taxYear: 2025, taxId: '900-11-0001', income: 1240000, classification: 'secret' },
  { id: 2, subject: 'Julian Marsh', type: 'background_check', taxYear: null, taxId: '900-11-0002', result: 'clear', classification: 'confidential' },
  { id: 3, subject: 'Priya Okonkwo', type: 'kyc_document', taxYear: null, taxId: '900-11-0003', documentNumber: 'XK1002233', classification: 'confidential' },
  { id: 4, subject: 'Tomas Reyes', type: 'tax_return', taxYear: 2025, taxId: '900-11-0004', income: 415000, classification: 'secret' },
  { id: 5, subject: 'Hannah Lindqvist', type: 'sanctions_screen', taxYear: null, taxId: '900-11-0005', result: 'review', classification: 'secret' },
];

const vault = [
  { id: 1, name: 'core-ledger-db-password', value: 'FAKE-vault-7f3a-9c21-d4e8', owner: 'platform', classification: 'secret' },
  { id: 2, name: 'payments-gateway-api-key', value: 'FAKE-pk_live_51Q9xX7aTest0001', owner: 'payments', classification: 'secret' },
  { id: 3, name: 'kyc-vendor-token', value: 'FAKE-kyc-tok-88ab-1177-02cc', owner: 'compliance', classification: 'secret' },
  { id: 4, name: 'swift-signing-key-passphrase', value: 'FAKE-swift-phrase-4421-zz', owner: 'treasury', classification: 'secret' },
  { id: 5, name: 'email-outbox-smtp-password', value: 'FAKE-smtp-pw-5530-qq', owner: 'platform', classification: 'confidential' },
];

const watchlist = [
  { id: 1, name: 'Vanessa Crane', listType: 'PEP', source: 'internal review', notes: 'Family member of a state official' },
  { id: 2, name: 'Tomas Reyes', listType: 'adverse_media', source: 'news monitor', notes: 'Property investigation, unconfirmed' },
  { id: 3, name: 'Hannah Lindqvist', listType: 'sanctions_near_match', source: 'screening vendor', notes: 'Review pending' },
  { id: 4, name: 'Julian Marsh', listType: 'internal_flag', source: 'fraud team', notes: 'Large cash deposit pattern' },
  { id: 5, name: 'Priya Okonkwo', listType: 'none', source: 'annual review', notes: 'Cleared' },
];

const payroll = [
  { id: 1, employee: 'Morgan Reyes', employeeCode: 'EMP01001', salary: 425000, bonus: 150000, bankAccount: '9990000201', classification: 'secret' },
  { id: 2, employee: 'Maya Thompson', employeeCode: 'EMP01003', salary: 185000, bonus: 22000, bankAccount: '9990000202', classification: 'confidential' },
  { id: 3, employee: 'Clara Fairbanks', employeeCode: 'EMP01014', salary: 165000, bonus: 18000, bankAccount: '9990000203', classification: 'confidential' },
  { id: 4, employee: 'Hugo Vasquez', employeeCode: 'EMP01008', salary: 96000, bonus: 4000, bankAccount: '9990000204', classification: 'confidential' },
  { id: 5, employee: 'Jonah Whitfield', employeeCode: 'EMP01006', salary: 61000, bonus: 1500, bankAccount: '9990000205', classification: 'internal' },
];

// 6 resources x 5 methods = 30 endpoints.
crud('accounts', 'confidential account', accounts);
crud('customers', 'customer PII', customers);
crud('records', 'PII record', records);
crud('vault', 'vault secret', vault);
crud('watchlist', 'watchlist entry', watchlist);
crud('payroll', 'payroll record', payroll);

module.exports = { accounts, customers, records, vault, watchlist, payroll };
