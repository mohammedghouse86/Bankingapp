const { route } = require('../lib/registry');
const { db } = require('../store');
const s = require('../lib/schemas');
const { z } = s;
const ser = require('../lib/serializers');
const { badRequest, notFound } = require('../lib/errors');
const { nowIso, paginate } = require('../lib/util');
const { audit } = require('../lib/audit');
const { notifyUser } = require('../lib/notify');

const TAG = 'Notifications';

function own(req, id) {
  const n = db.notifications.find((x) => x.id === id && x.userId === req.user.id);
  if (!n) throw notFound('Notification');
  return n;
}

route({
  method: 'get', path: '/notifications', tag: TAG,
  summary: 'Own notifications',
  query: z.object({ ...s.paging, unreadOnly: z.enum(['true', 'false']).optional(), type: z.string().max(30).optional() }).strict(),
  response: { list: 'Notification' },
  handler: (req, res) => {
    const q = req.v.query;
    const list = db.notifications.filter((n) => n.userId === req.user.id && (q.unreadOnly !== 'true' || !n.readAt) && (!q.type || n.type === q.type));
    const page = paginate(list, q, { createdAt: (n) => n.createdAt }, 'createdAt');
    res.json({ data: page.items.map(ser.notification), pagination: page.pagination });
  },
});

route({
  method: 'get', path: '/notifications/unread-count', tag: TAG,
  summary: 'Number of unread notifications',
  response: 'UnreadCount',
  handler: (req, res) => res.json({ data: { unread: db.notifications.filter((n) => n.userId === req.user.id && !n.readAt).length } }),
});

route({
  method: 'post', path: '/notifications/:id/read', tag: TAG,
  summary: 'Mark a notification as read',
  params: s.idParams,
  response: 'Notification',
  handler: (req, res) => {
    const n = own(req, req.v.params.id);
    if (!n.readAt) n.readAt = nowIso();
    res.json({ data: ser.notification(n) });
  },
});

route({
  method: 'post', path: '/notifications/read-all', tag: TAG,
  summary: 'Mark all own notifications as read',
  handler: (req, res) => {
    let count = 0;
    db.notifications.forEach((n) => { if (n.userId === req.user.id && !n.readAt) { n.readAt = nowIso(); count += 1; } });
    res.json({ data: { message: `Marked ${count} notification(s) as read` } });
  },
});

route({
  method: 'delete', path: '/notifications/:id', tag: TAG,
  summary: 'Delete a notification',
  params: s.idParams,
  handler: (req, res) => {
    const n = own(req, req.v.params.id);
    db.notifications.splice(db.notifications.indexOf(n), 1);
    res.json({ data: { message: 'Notification deleted' } });
  },
});

route({
  method: 'post', path: '/notifications/broadcast', tag: TAG, permission: 'notifications:broadcast', status: 201, risk: 'high',
  summary: 'Send a notification to a group of users (super admin)',
  body: z.object({
    audience: z.enum(['all_staff', 'all_customers', 'branch_staff', 'branch_customers']),
    branchId: s.id.optional(),
    title: s.text(100),
    message: s.text(500),
  }).strict(),
  handler: (req, res) => {
    const { audience, branchId, title, message } = req.v.body;
    if (audience.startsWith('branch_') && !branchId) throw badRequest('branchId is required for branch audiences');
    const customerBranch = (u) => { const c = db.customers.find((x) => x.id === u.customerId); return c && c.branchId; };
    const recipients = db.users.filter((u) => u.status === 'active' && ({
      all_staff: u.role !== 'customer',
      all_customers: u.role === 'customer',
      branch_staff: u.role !== 'customer' && u.branchId === branchId,
      branch_customers: u.role === 'customer' && customerBranch(u) === branchId,
    })[audience]);
    recipients.forEach((u) => notifyUser(u.id, { type: 'announcement', title, message }));
    audit(req, { action: 'notification.broadcast', entityType: 'notification', riskLevel: 'high', details: { audience, branchId, recipients: recipients.length } });
    res.status(201).json({ data: { message: `Notification sent to ${recipients.length} user(s)`, recipients: recipients.length } });
  },
});
