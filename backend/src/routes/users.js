const { route } = require('../lib/registry');
const { db, nextId, findById } = require('../store');
const s = require('../lib/schemas');
const { z } = s;
const ser = require('../lib/serializers');
const { ApiError, notFound, forbidden, conflict, badRequest } = require('../lib/errors');
const { nowIso, paginate, includesText } = require('../lib/util');
const { hashPassword, isStrongPassword, PASSWORD_RULES, generateTempPassword } = require('../lib/password');
const { revokeUserSessions, isSessionLive } = require('../lib/auth');
const { hasPermission } = require('../lib/permissions');
const { audit } = require('../lib/audit');
const { notifyUser, sendEmail } = require('../lib/notify');

const TAG = 'Employees & Users';
const STAFF = ['super_admin', 'manager', 'teller'];

function visible(actor, target) {
  if (!target || target.status === 'deleted') return false;
  if (target.id === actor.id) return true;
  if (actor.role === 'super_admin') return true;
  return actor.role === 'manager' && STAFF.includes(target.role) && target.role !== 'super_admin' && target.branchId === actor.branchId;
}

function loadVisible(actor, id) {
  const u = findById('users', id);
  if (!visible(actor, u)) throw notFound('User');
  return u;
}

/** Management rights: managers manage tellers of their branch; privileged admins manage all staff. */
function assertCanManage(actor, target) {
  if (target.id === actor.id) throw new ApiError(403, 'SELF_MANAGEMENT_FORBIDDEN', 'You cannot perform this action on your own account');
  if (target.role === 'customer') throw forbidden('Customer logins are managed through the customer portal-access endpoints');
  if (actor.role === 'super_admin') return;
  if (actor.role === 'manager' && target.role === 'teller' && target.branchId === actor.branchId) return;
  throw forbidden('You can only manage tellers in your own branch');
}

const listQuery = z.object({
  ...s.paging,
  role: z.enum(['super_admin', 'manager', 'teller', 'customer']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  branchId: s.id.optional(),
}).strict();

route({
  method: 'get', path: '/users', tag: TAG, permission: 'users:read',
  summary: 'List employees (managers see their own branch only)',
  query: listQuery,
  response: { list: 'User' },
  handler: (req, res) => {
    const q = req.v.query;
    const actor = req.user;
    if (q.role === 'customer' && actor.role !== 'super_admin') throw forbidden('Only super admins can list customer logins');
    let list = db.users.filter((u) => u.status !== 'deleted' && (q.role ? u.role === q.role : STAFF.includes(u.role)));
    if (actor.role !== 'super_admin') list = list.filter((u) => u.role !== 'super_admin' && u.branchId === actor.branchId);
    if (q.branchId) list = list.filter((u) => u.branchId === q.branchId);
    if (q.status) list = list.filter((u) => u.status === q.status);
    list = list.filter((u) => includesText([u.firstName, u.lastName, u.email, u.employeeCode, `${u.firstName} ${u.lastName}`], q.search));
    const page = paginate(list, q, { name: (u) => `${u.lastName} ${u.firstName}`, email: (u) => u.email, role: (u) => u.role, createdAt: (u) => u.createdAt, lastLoginAt: (u) => u.lastLoginAt || '' }, 'name');
    res.json({ data: page.items.map(ser.user), pagination: page.pagination });
  },
});

route({
  method: 'post', path: '/users', tag: TAG, permission: 'users:manage', status: 201, risk: 'high', conflicts: true,
  summary: 'Create an employee account',
  description: 'Managers may create tellers in their own branch. Creating managers or super admins requires `users:privileged`. A one-time temporary password is returned.',
  body: z.object({
    email: s.email, firstName: s.name, lastName: s.name, phone: s.phone.optional(),
    role: z.enum(['super_admin', 'manager', 'teller']), branchId: s.id.optional(), title: z.string().trim().max(60).optional(),
  }).strict(),
  response: 'UserWithTempPassword',
  handler: async (req, res) => {
    const b = req.v.body;
    const actor = req.user;
    if (b.role !== 'teller' && !hasPermission(actor, 'users:privileged')) {
      audit(req, { action: 'user.create', outcome: 'denied', riskLevel: 'high', details: { attemptedRole: b.role } });
      throw forbidden('Only super admins can create managers or administrators');
    }
    let branchId = b.role === 'super_admin' ? null : b.branchId;
    if (actor.role === 'manager') {
      if (branchId && branchId !== actor.branchId) throw forbidden('Managers can only create tellers in their own branch');
      branchId = actor.branchId;
    }
    if (b.role !== 'super_admin') {
      const branch = branchId && findById('branches', branchId);
      if (!branch) throw badRequest('branchId is required and must reference an existing branch');
      if (branch.status !== 'active') throw badRequest('Cannot assign employees to an inactive branch');
    }
    if (db.users.some((u) => u.email === b.email)) throw conflict('A user with this email already exists');
    const temporaryPassword = generateTempPassword();
    const now = nowIso();
    const u = {
      id: nextId('users'), email: b.email, passwordHash: await hashPassword(temporaryPassword), role: b.role,
      firstName: b.firstName, lastName: b.lastName, phone: b.phone || null, branchId, customerId: null, status: 'active',
      employeeCode: null, title: b.title || (b.role === 'teller' ? 'Teller' : b.role === 'manager' ? 'Branch Manager' : 'Administrator'),
      hireDate: now.slice(0, 10), failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: null, passwordChangedAt: now, createdAt: now, updatedAt: now,
    };
    u.employeeCode = `EMP${String(1000 + u.id).padStart(5, '0')}`;
    db.users.push(u);
    audit(req, { action: 'user.create', entityType: 'user', entityId: u.id, branchId, riskLevel: 'high', details: { role: u.role, email: u.email } });
    sendEmail(u.email, 'Your Kestrel Bank employee account', 'An employee account was created for you. Your manager will give you a temporary password.');
    res.status(201).json({ data: { ...ser.user(u), temporaryPassword } });
  },
});

route({
  method: 'get', path: '/users/:id', tag: TAG, permission: 'users:read',
  summary: 'Get an employee by ID',
  params: s.idParams,
  response: 'User',
  handler: (req, res) => res.json({ data: ser.user(loadVisible(req.user, req.v.params.id)) }),
});

route({
  method: 'patch', path: '/users/:id', tag: TAG, permission: 'users:manage',
  summary: 'Update employee profile fields',
  description: 'Only name, phone and title are editable here. Role, branch, status and password have dedicated endpoints; unknown fields are rejected.',
  params: s.idParams,
  body: z.object({ firstName: s.name.optional(), lastName: s.name.optional(), phone: s.phone.optional(), title: z.string().trim().max(60).optional() }).strict()
    .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update'),
  response: 'User',
  handler: (req, res) => {
    const target = loadVisible(req.user, req.v.params.id);
    assertCanManage(req.user, target);
    Object.assign(target, req.v.body, { updatedAt: nowIso() });
    audit(req, { action: 'user.update', entityType: 'user', entityId: target.id, branchId: target.branchId, details: { fields: Object.keys(req.v.body) } });
    res.json({ data: ser.user(target) });
  },
});

function statusChange(path, newStatus, summary) {
  route({
    method: 'post', path, tag: TAG, permission: 'users:manage', risk: 'high',
    summary,
    params: s.idParams,
    body: z.object({ reason: s.text(300) }).strict(),
    response: 'User',
    handler: (req, res) => {
      const target = loadVisible(req.user, req.v.params.id);
      assertCanManage(req.user, target);
      if (target.status === newStatus) throw conflict(`User is already ${newStatus}`);
      target.status = newStatus;
      target.updatedAt = nowIso();
      if (newStatus === 'inactive') revokeUserSessions(target.id, 'user_deactivated');
      audit(req, { action: `user.${newStatus === 'active' ? 'activate' : 'deactivate'}`, entityType: 'user', entityId: target.id, branchId: target.branchId, riskLevel: 'high', details: { reason: req.v.body.reason } });
      res.json({ data: ser.user(target) });
    },
  });
}
statusChange('/users/:id/deactivate', 'inactive', 'Deactivate an employee (revokes their sessions)');
statusChange('/users/:id/activate', 'active', 'Re-activate an employee');

route({
  method: 'post', path: '/users/:id/unlock', tag: TAG, permission: 'users:manage',
  summary: 'Clear a login lockout',
  params: s.idParams,
  response: 'User',
  handler: (req, res) => {
    const target = loadVisible(req.user, req.v.params.id);
    assertCanManage(req.user, target);
    target.failedLoginAttempts = 0;
    target.lockedUntil = null;
    audit(req, { action: 'user.unlock', entityType: 'user', entityId: target.id, branchId: target.branchId });
    res.json({ data: ser.user(target) });
  },
});

route({
  method: 'post', path: '/users/:id/reset-password', tag: TAG, permission: 'users:manage', risk: 'critical', stepUp: true,
  summary: 'Issue a temporary password for an employee',
  description: 'Generates a one-time temporary password, revokes the employee\'s sessions and returns the password once.',
  params: s.idParams,
  response: 'TempPassword',
  handler: async (req, res) => {
    const target = loadVisible(req.user, req.v.params.id);
    assertCanManage(req.user, target);
    const temporaryPassword = generateTempPassword();
    target.passwordHash = await hashPassword(temporaryPassword);
    target.passwordChangedAt = nowIso();
    target.failedLoginAttempts = 0;
    target.lockedUntil = null;
    revokeUserSessions(target.id, 'admin_password_reset');
    audit(req, { action: 'user.reset_password', entityType: 'user', entityId: target.id, branchId: target.branchId, riskLevel: 'critical' });
    notifyUser(target.id, { type: 'security', title: 'Password reset by administrator', message: 'Your password was reset. Sign in with the temporary password provided to you.' });
    res.json({ data: { userId: target.id, temporaryPassword } });
  },
});

route({
  method: 'put', path: '/users/:id/password', tag: TAG, permission: 'users:privileged', risk: 'critical', stepUp: true,
  summary: 'Set an explicit password for any staff user (super admin)',
  params: s.idParams,
  body: z.object({ newPassword: s.password.refine(isStrongPassword, `newPassword must be ${PASSWORD_RULES}`) }).strict(),
  handler: async (req, res) => {
    const target = loadVisible(req.user, req.v.params.id);
    assertCanManage(req.user, target);
    target.passwordHash = await hashPassword(req.v.body.newPassword);
    target.passwordChangedAt = nowIso();
    revokeUserSessions(target.id, 'admin_password_set');
    audit(req, { action: 'user.set_password', entityType: 'user', entityId: target.id, branchId: target.branchId, riskLevel: 'critical' });
    notifyUser(target.id, { type: 'security', title: 'Password changed by administrator', message: 'An administrator set a new password for your account.' });
    res.json({ data: { message: 'Password updated and sessions revoked' } });
  },
});

route({
  method: 'put', path: '/users/:id/role', tag: TAG, permission: 'users:privileged', risk: 'critical', stepUp: true,
  summary: 'Change an employee\'s role (super admin)',
  description: 'Self role changes are rejected. Promotion to super_admin clears the branch assignment; demotion requires a branch.',
  params: s.idParams,
  body: z.object({ role: z.enum(['super_admin', 'manager', 'teller']), branchId: s.id.optional(), reason: s.text(300) }).strict(),
  response: 'User',
  handler: (req, res) => {
    const target = loadVisible(req.user, req.v.params.id);
    assertCanManage(req.user, target);
    const { role, branchId, reason } = req.v.body;
    if (target.role === role) throw conflict(`User already has role ${role}`);
    const newBranch = role === 'super_admin' ? null : branchId || target.branchId;
    if (role !== 'super_admin') {
      const b = newBranch && findById('branches', newBranch);
      if (!b || b.status !== 'active') throw badRequest('A valid active branchId is required for branch roles');
    }
    if (target.role === 'super_admin' && db.users.filter((u) => u.role === 'super_admin' && u.status === 'active').length <= 1) {
      throw conflict('Cannot demote the last active super admin');
    }
    const previous = target.role;
    target.role = role;
    target.branchId = newBranch;
    target.updatedAt = nowIso();
    db.branches.forEach((b) => { if (b.managerId === target.id && role !== 'manager') b.managerId = null; });
    revokeUserSessions(target.id, 'role_changed');
    audit(req, { action: 'user.change_role', entityType: 'user', entityId: target.id, branchId: newBranch, riskLevel: 'critical', details: { from: previous, to: role, reason } });
    notifyUser(target.id, { type: 'security', title: 'Your role changed', message: `Your role was changed from ${previous} to ${role}. Please sign in again.` });
    res.json({ data: ser.user(target) });
  },
});

route({
  method: 'put', path: '/users/:id/branch', tag: TAG, permission: 'users:privileged', risk: 'high',
  summary: 'Transfer an employee to another branch (super admin)',
  params: s.idParams,
  body: z.object({ branchId: s.id, reason: s.text(300) }).strict(),
  response: 'User',
  handler: (req, res) => {
    const target = loadVisible(req.user, req.v.params.id);
    assertCanManage(req.user, target);
    if (target.role === 'super_admin') throw badRequest('Super admins are not assigned to branches');
    const b = findById('branches', req.v.body.branchId);
    if (!b || b.status !== 'active') throw badRequest('Target branch must exist and be active');
    if (target.branchId === b.id) throw conflict('Employee is already assigned to this branch');
    const from = target.branchId;
    db.branches.forEach((br) => { if (br.managerId === target.id) br.managerId = null; });
    target.branchId = b.id;
    target.updatedAt = nowIso();
    revokeUserSessions(target.id, 'branch_changed');
    audit(req, { action: 'user.change_branch', entityType: 'user', entityId: target.id, branchId: b.id, riskLevel: 'high', details: { from, to: b.id, reason: req.v.body.reason } });
    res.json({ data: ser.user(target) });
  },
});

route({
  method: 'delete', path: '/users/:id', tag: TAG, permission: 'users:privileged', risk: 'critical', stepUp: true,
  summary: 'Permanently delete a deactivated employee account',
  description: 'Only inactive employees can be deleted. The record is anonymised; audit history is preserved.',
  params: s.idParams,
  handler: (req, res) => {
    const target = loadVisible(req.user, req.v.params.id);
    assertCanManage(req.user, target);
    if (target.status !== 'inactive') throw conflict('Deactivate the employee before deleting the account');
    const email = target.email;
    Object.assign(target, { status: 'deleted', email: `deleted-user-${target.id}@kestrelbank.invalid`, phone: null, passwordHash: null, updatedAt: nowIso() });
    revokeUserSessions(target.id, 'user_deleted');
    audit(req, { action: 'user.delete', entityType: 'user', entityId: target.id, riskLevel: 'critical', details: { email } });
    res.json({ data: { message: 'Employee account deleted' } });
  },
});

route({
  method: 'get', path: '/users/:id/activity', tag: TAG, permission: 'users:read',
  summary: 'Audit trail of actions performed by an employee',
  params: s.idParams,
  query: z.object({ ...s.paging, action: z.string().max(60).optional() }).strict(),
  response: { list: 'AuditLog' },
  handler: (req, res) => {
    const target = loadVisible(req.user, req.v.params.id);
    const q = req.v.query;
    const list = db.auditLogs.filter((a) => a.actorUserId === target.id && (!q.action || a.action.startsWith(q.action)));
    const page = paginate(list, q, { createdAt: (a) => a.createdAt, action: (a) => a.action }, 'createdAt');
    res.json({ data: page.items.map(ser.auditLog), pagination: page.pagination });
  },
});

route({
  method: 'get', path: '/users/:id/sessions', tag: TAG, permission: 'users:privileged',
  summary: 'List an employee\'s active sessions (super admin)',
  params: s.idParams,
  response: { array: 'Session' },
  handler: (req, res) => {
    const target = loadVisible(req.user, req.v.params.id);
    res.json({ data: db.sessions.filter((x) => x.userId === target.id && isSessionLive(x)).map((x) => ser.session(x, req.session.id)) });
  },
});

route({
  method: 'delete', path: '/users/:id/sessions', tag: TAG, permission: 'users:privileged', risk: 'high',
  summary: 'Revoke all sessions of a user (force sign-out)',
  params: s.idParams,
  handler: (req, res) => {
    const target = findById('users', req.v.params.id);
    if (!target || target.status === 'deleted') throw notFound('User');
    if (target.id === req.user.id) throw badRequest('Use /auth/logout-all to sign yourself out');
    const count = revokeUserSessions(target.id, 'force_signout');
    audit(req, { action: 'user.force_signout', entityType: 'user', entityId: target.id, riskLevel: 'high', details: { sessionsRevoked: count } });
    res.json({ data: { message: `Revoked ${count} session(s)` } });
  },
});
