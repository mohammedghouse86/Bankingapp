const { route } = require('../lib/registry');
const { db, nextId, findById } = require('../store');
const s = require('../lib/schemas');
const { z } = s;
const ser = require('../lib/serializers');
const { badRequest, conflict, forbidden, notFound, unprocessable } = require('../lib/errors');
const { nowIso, paginate, includesText } = require('../lib/util');
const { audit } = require('../lib/audit');
const { notifyCustomer, notifyUser } = require('../lib/notify');
const { isCustomer, branchScope, loadAccount } = require('../lib/scope');

const TAG = 'Service Requests';
const READ = ['service_requests:read', 'portal:service_requests'];
const CUSTOMER = { roles: ['customer'], permission: 'portal:service_requests' };

function loadRequest(u, id) {
  const r = findById('serviceRequests', id);
  if (!r) throw notFound('Service request');
  if (isCustomer(u) ? r.customerId !== u.customerId : (branchScope(u) != null && r.branchId !== u.branchId)) throw notFound('Service request');
  return r;
}

function createRequest(req, { type, subject, description, accountId, details }) {
  const customer = findById('customers', req.user.customerId);
  if (accountId) loadAccount(req.user, accountId);
  const now = nowIso();
  const r = {
    id: nextId('serviceRequests'), reference: `SR${now.slice(0, 10).replace(/-/g, '')}${String(db.serviceRequests.length + 1).padStart(4, '0')}`,
    customerId: customer.id, accountId: accountId || null, branchId: customer.branchId, type, status: 'open', subject, description: description || null,
    details: details || {}, assignedTo: null, resolutionNote: null, createdBy: req.user.id, createdAt: now, updatedAt: now,
  };
  db.serviceRequests.push(r);
  audit(req, { action: 'service_request.create', entityType: 'service_request', entityId: r.id, branchId: r.branchId, details: { type } });
  return r;
}

route({
  method: 'get', path: '/service-requests', tag: TAG, permission: READ,
  summary: 'List service requests (customers: own; staff: branch scope)',
  query: z.object({
    ...s.paging,
    status: z.enum(['open', 'in_progress', 'resolved', 'rejected', 'cancelled']).optional(),
    type: z.enum(['cheque_book', 'statement', 'address_change', 'card_replacement', 'general_inquiry', 'limit_increase', 'account_closure']).optional(),
    assignedTo: s.id.optional(),
    branchId: s.id.optional(),
  }).strict(),
  response: { list: 'ServiceRequest' },
  handler: (req, res) => {
    const q = req.v.query;
    const u = req.user;
    const list = db.serviceRequests.filter((r) => (isCustomer(u) ? r.customerId === u.customerId : branchScope(u) == null || r.branchId === u.branchId)
      && (!q.status || r.status === q.status) && (!q.type || r.type === q.type) && (!q.assignedTo || r.assignedTo === q.assignedTo)
      && (!q.branchId || r.branchId === q.branchId) && includesText([r.reference, r.subject], q.search));
    const page = paginate(list, q, { createdAt: (r) => r.createdAt, updatedAt: (r) => r.updatedAt, status: (r) => r.status }, 'createdAt');
    res.json({ data: page.items.map((r) => ser.serviceRequest(r, u)), pagination: page.pagination });
  },
});

route({
  method: 'post', path: '/service-requests', tag: TAG, ...CUSTOMER, status: 201,
  summary: 'Submit a general service request',
  body: z.object({
    type: z.enum(['address_change', 'card_replacement', 'general_inquiry', 'limit_increase', 'account_closure']),
    subject: s.text(120), description: s.text(1000), accountId: s.id.optional(),
  }).strict(),
  response: 'ServiceRequest',
  handler: (req, res) => {
    if (req.v.body.type === 'account_closure' && !req.v.body.accountId) throw badRequest('accountId is required for account closure requests');
    const r = createRequest(req, req.v.body);
    res.status(201).json({ data: ser.serviceRequest(r, req.user) });
  },
});

route({
  method: 'post', path: '/service-requests/cheque-book', tag: TAG, ...CUSTOMER, status: 201, conflicts: true, businessRules: true,
  summary: 'Request a cheque book for a checking account',
  body: z.object({ accountId: s.id, leaves: z.union([z.literal(25), z.literal(50)]), deliveryMethod: z.enum(['branch_pickup', 'mail']) }).strict(),
  response: 'ServiceRequest',
  handler: (req, res) => {
    const b = req.v.body;
    const a = loadAccount(req.user, b.accountId);
    if (a.type !== 'checking') throw unprocessable('NOT_ALLOWED', 'Cheque books are only issued for checking accounts');
    if (a.status !== 'active') throw unprocessable('ACCOUNT_NOT_ACTIVE', `Account is ${a.status}`);
    if (db.serviceRequests.some((r) => r.type === 'cheque_book' && r.accountId === a.id && ['open', 'in_progress'].includes(r.status))) throw conflict('A cheque book request for this account is already in progress');
    const r = createRequest(req, { type: 'cheque_book', subject: 'Cheque book request', description: `${b.leaves}-leaf cheque book (${b.deliveryMethod.replace('_', ' ')})`, accountId: a.id, details: { leaves: b.leaves, deliveryMethod: b.deliveryMethod } });
    res.status(201).json({ data: ser.serviceRequest(r, req.user) });
  },
});

route({
  method: 'post', path: '/service-requests/statement', tag: TAG, ...CUSTOMER, status: 201,
  summary: 'Request an official (paper or emailed) statement',
  body: z.object({ accountId: s.id, fromDate: s.date, toDate: s.date, deliveryMethod: z.enum(['email', 'mail']) }).strict()
    .refine((b) => b.fromDate <= b.toDate, 'fromDate must be on or before toDate'),
  response: 'ServiceRequest',
  handler: (req, res) => {
    const b = req.v.body;
    const r = createRequest(req, { type: 'statement', subject: 'Official statement request', description: `Statement ${b.fromDate} to ${b.toDate} by ${b.deliveryMethod}`, accountId: b.accountId, details: { fromDate: b.fromDate, toDate: b.toDate, deliveryMethod: b.deliveryMethod } });
    res.status(201).json({ data: ser.serviceRequest(r, req.user) });
  },
});

route({
  method: 'get', path: '/service-requests/:id', tag: TAG, permission: READ,
  summary: 'Get a service request',
  params: s.idParams,
  response: 'ServiceRequest',
  handler: (req, res) => res.json({ data: ser.serviceRequest(loadRequest(req.user, req.v.params.id), req.user) }),
});

const TRANSITIONS = { open: ['in_progress', 'resolved', 'rejected'], in_progress: ['resolved', 'rejected'] };

route({
  method: 'patch', path: '/service-requests/:id', tag: TAG, permission: 'service_requests:manage', conflicts: true,
  summary: 'Update the status of a service request (staff)',
  description: 'Allowed transitions: open → in_progress | resolved | rejected; in_progress → resolved | rejected. A resolution note is required when closing.',
  params: s.idParams,
  body: z.object({ status: z.enum(['in_progress', 'resolved', 'rejected']), resolutionNote: z.string().trim().max(500).optional() }).strict(),
  response: 'ServiceRequest',
  handler: (req, res) => {
    const r = loadRequest(req.user, req.v.params.id);
    const { status, resolutionNote } = req.v.body;
    if (!(TRANSITIONS[r.status] || []).includes(status)) throw conflict(`Cannot move a request from ${r.status} to ${status}`);
    if (status !== 'in_progress' && !resolutionNote) throw badRequest('resolutionNote is required to resolve or reject a request');
    r.status = status;
    if (resolutionNote) r.resolutionNote = resolutionNote;
    if (!r.assignedTo) r.assignedTo = req.user.id;
    r.updatedAt = nowIso();
    audit(req, { action: 'service_request.update', entityType: 'service_request', entityId: r.id, branchId: r.branchId, details: { status } });
    notifyCustomer(r.customerId, { type: 'service', title: 'Service request updated', message: `${r.reference} is now ${status.replace('_', ' ')}.`, link: `/service-requests/${r.id}` });
    res.json({ data: ser.serviceRequest(r, req.user) });
  },
});

route({
  method: 'post', path: '/service-requests/:id/assign', tag: TAG, permission: 'service_requests:manage', conflicts: true,
  summary: 'Assign a service request to an employee of the same branch',
  description: 'Tellers may only assign requests to themselves.',
  params: s.idParams,
  body: z.object({ assigneeId: s.id }).strict(),
  response: 'ServiceRequest',
  handler: (req, res) => {
    const r = loadRequest(req.user, req.v.params.id);
    if (!['open', 'in_progress'].includes(r.status)) throw conflict(`Request is ${r.status}`);
    const assignee = findById('users', req.v.body.assigneeId);
    if (!assignee || assignee.status !== 'active' || !['manager', 'teller'].includes(assignee.role) || assignee.branchId !== r.branchId) {
      throw badRequest('Assignee must be an active employee of the request\'s branch');
    }
    if (req.user.role === 'teller' && assignee.id !== req.user.id) throw forbidden('Tellers can only assign requests to themselves');
    r.assignedTo = assignee.id;
    r.updatedAt = nowIso();
    audit(req, { action: 'service_request.assign', entityType: 'service_request', entityId: r.id, branchId: r.branchId, details: { assigneeId: assignee.id } });
    if (assignee.id !== req.user.id) notifyUser(assignee.id, { type: 'service', title: 'Service request assigned to you', message: `${r.reference}: ${r.subject}`, link: `/service-requests/${r.id}` });
    res.json({ data: ser.serviceRequest(r, req.user) });
  },
});

route({
  method: 'post', path: '/service-requests/:id/cancel', tag: TAG, ...CUSTOMER, conflicts: true,
  summary: 'Cancel your own open service request',
  params: s.idParams,
  response: 'ServiceRequest',
  handler: (req, res) => {
    const r = loadRequest(req.user, req.v.params.id);
    if (r.status !== 'open') throw conflict('Only open requests can be cancelled');
    r.status = 'cancelled';
    r.updatedAt = nowIso();
    audit(req, { action: 'service_request.cancel', entityType: 'service_request', entityId: r.id, branchId: r.branchId });
    res.json({ data: ser.serviceRequest(r, req.user) });
  },
});
