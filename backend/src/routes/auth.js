const crypto = require('crypto');
const { route } = require('../lib/registry');
const { db, nextId, findById } = require('../store');
const s = require('../lib/schemas');
const { z } = s;
const ser = require('../lib/serializers');
const { ApiError, unauthorized, notFound, conflict, badRequest } = require('../lib/errors');
const { nowIso, sha256 } = require('../lib/util');
const { hashPassword, verifyPassword, isStrongPassword, PASSWORD_RULES } = require('../lib/password');
const { createSession, rotateRefreshToken, revokeSession, revokeUserSessions, adminIpAllowed } = require('../lib/auth');
const { permissionsFor } = require('../lib/permissions');
const { audit } = require('../lib/audit');
const { notifyUser, sendEmail, setting } = require('../lib/notify');

const TAG = 'Authentication';

function strongPassword(field = 'newPassword') {
  return s.password.refine(isStrongPassword, { message: `${field} must be ${PASSWORD_RULES}` });
}

function mePayload(user) {
  const out = { user: ser.user(user), permissions: [...permissionsFor(user.role)].sort() };
  if (user.role === 'customer') {
    const c = findById('customers', user.customerId);
    out.customer = c ? ser.customer(c, user) : null;
  }
  return out;
}

route({
  method: 'post', path: '/auth/login', tag: TAG, auth: false, risk: undefined,
  summary: 'Authenticate with email and password',
  description: 'Returns a short-lived access token and a rotating refresh token. Accounts lock after repeated failures.',
  body: z.object({ email: s.email, password: s.password }).strict(),
  response: 'LoginResponse',
  handler: async (req, res) => {
    const { email, password } = req.v.body;
    const user = db.users.find((u) => u.email === email);
    const now = nowIso();
    if (user && user.lockedUntil && user.lockedUntil > now) {
      audit(req, { action: 'auth.login_locked', entityType: 'user', entityId: user.id, outcome: 'denied', details: { email } });
      throw new ApiError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. The account is temporarily locked; try again later or contact an administrator.');
    }
    const valid = await verifyPassword(password, user && user.passwordHash);
    if (!user || !valid) {
      if (user) {
        user.failedLoginAttempts += 1;
        if (user.failedLoginAttempts >= setting('maxFailedLogins')) {
          user.lockedUntil = new Date(Date.now() + setting('lockoutMinutes') * 60000).toISOString();
          audit(req, { action: 'auth.account_locked', entityType: 'user', entityId: user.id, outcome: 'failure', riskLevel: 'high', details: { email } });
        }
      }
      audit(req, { action: 'auth.login_failed', entityType: 'user', entityId: user ? user.id : null, outcome: 'failure', details: { email, reason: 'invalid_credentials' } });
      throw unauthorized('Invalid email or password');
    }
    if (user.status !== 'active') {
      audit(req, { action: 'auth.login_failed', entityType: 'user', entityId: user.id, outcome: 'denied', details: { email, reason: 'inactive' } });
      throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account is disabled. Please contact your branch.');
    }
    if (user.role === 'super_admin' && db.network.adminIpEnforcement === 'enforce' && !adminIpAllowed(req.ip)) {
      audit(req, { action: 'security.admin_ip_blocked', entityType: 'user', entityId: user.id, outcome: 'denied', riskLevel: 'high', details: { ip: req.ip } });
      throw new ApiError(403, 'ADMIN_IP_NOT_ALLOWED', 'Administrative access is not permitted from this network');
    }
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = now;
    req.user = user;
    const tokens = createSession(user, req);
    audit(req, { action: 'auth.login', entityType: 'user', entityId: user.id });
    res.json({ data: { ...tokens, ...mePayload(user) } });
  },
});

route({
  method: 'post', path: '/auth/refresh', tag: TAG, auth: false,
  summary: 'Exchange a refresh token for new tokens (rotation)',
  description: 'Refresh tokens are single-use. Re-using a rotated token revokes the session.',
  body: z.object({ refreshToken: z.string().min(10).max(200) }).strict(),
  response: 'TokenPair',
  handler: (req, res) => {
    res.json({ data: rotateRefreshToken(req.v.body.refreshToken, req) });
  },
});

route({
  method: 'post', path: '/auth/logout', tag: TAG,
  summary: 'Revoke the current session',
  handler: (req, res) => {
    if (req.session) revokeSession(req.session, 'logout');
    audit(req, { action: 'auth.logout', entityType: 'user', entityId: req.user.id });
    res.json({ data: { message: 'Logged out' } });
  },
});

route({
  method: 'post', path: '/auth/logout-all', tag: TAG,
  summary: 'Revoke all sessions of the current user',
  handler: (req, res) => {
    const count = revokeUserSessions(req.user.id, 'logout_all');
    audit(req, { action: 'auth.logout_all', entityType: 'user', entityId: req.user.id, details: { sessionsRevoked: count } });
    res.json({ data: { message: `Revoked ${count} session(s)` } });
  },
});

route({
  method: 'get', path: '/auth/me', tag: TAG, apiKeyAllowed: true,
  summary: 'Current principal, effective permissions and (for customers) profile',
  response: 'MeResponse',
  handler: (req, res) => {
    if (req.user.role === 'api_client') {
      return res.json({ data: { user: { id: null, role: 'api_client', apiKeyId: req.user.apiKeyId, name: req.user.firstName }, permissions: req.user.apiKeyScopes } });
    }
    return res.json({ data: mePayload(req.user) });
  },
});

route({
  method: 'get', path: '/auth/permissions', tag: TAG,
  summary: 'Effective permissions of the current user',
  handler: (req, res) => res.json({ data: { role: req.user.role, permissions: [...permissionsFor(req.user.role)].sort() } }),
});

route({
  method: 'post', path: '/auth/change-password', tag: TAG, risk: 'critical',
  summary: 'Change own password',
  description: 'Requires the current password. Revokes all other sessions on success.',
  body: z.object({ currentPassword: s.password, newPassword: strongPassword() }).strict(),
  handler: async (req, res) => {
    const { currentPassword, newPassword } = req.v.body;
    if (!(await verifyPassword(currentPassword, req.user.passwordHash))) {
      audit(req, { action: 'auth.change_password', entityType: 'user', entityId: req.user.id, outcome: 'denied', details: { reason: 'wrong_current_password' } });
      throw new ApiError(403, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
    }
    if (await verifyPassword(newPassword, req.user.passwordHash)) throw badRequest('New password must differ from the current password');
    req.user.passwordHash = await hashPassword(newPassword);
    req.user.passwordChangedAt = nowIso();
    req.user.updatedAt = req.user.passwordChangedAt;
    const revoked = revokeUserSessions(req.user.id, 'password_changed', req.session && req.session.id);
    audit(req, { action: 'auth.change_password', entityType: 'user', entityId: req.user.id, details: { otherSessionsRevoked: revoked } });
    notifyUser(req.user.id, { type: 'security', title: 'Password changed', message: 'Your password was changed. If this was not you, contact the bank immediately.' });
    sendEmail(req.user.email, 'Your Kestrel Bank password was changed', 'Your password was just changed. If you did not make this change, contact us immediately.');
    res.json({ data: { message: 'Password updated', otherSessionsRevoked: revoked } });
  },
});

route({
  method: 'post', path: '/auth/forgot-password', tag: TAG, auth: false, status: 202,
  summary: 'Request a password reset email',
  description: 'Always returns 202 to avoid revealing which emails are registered. The reset link is delivered to the simulated email outbox.',
  body: z.object({ email: s.email }).strict(),
  handler: (req, res) => {
    const user = db.users.find((u) => u.email === req.v.body.email && u.status === 'active');
    if (user) {
      const token = crypto.randomBytes(32).toString('base64url');
      db.passwordResetTokens.forEach((t) => { if (t.userId === user.id && !t.usedAt) t.usedAt = nowIso(); });
      db.passwordResetTokens.push({ userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + setting('passwordResetTokenMinutes') * 60000).toISOString(), usedAt: null, createdAt: nowIso() });
      sendEmail(user.email, 'Reset your Kestrel Bank password', `Use this token to reset your password within ${setting('passwordResetTokenMinutes')} minutes: ${token}\nOr open: #/reset-password?token=${token}`);
      audit(req, { action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id, details: {} });
    }
    res.status(202).json({ data: { message: 'If the email is registered, a reset link has been sent.' } });
  },
});

route({
  method: 'post', path: '/auth/reset-password', tag: TAG, auth: false, risk: 'critical',
  summary: 'Reset password with a reset token',
  body: z.object({ token: z.string().min(20).max(100), newPassword: strongPassword() }).strict(),
  handler: async (req, res) => {
    const { token, newPassword } = req.v.body;
    const rec = db.passwordResetTokens.find((t) => t.tokenHash === sha256(token));
    if (!rec || rec.usedAt || rec.expiresAt < nowIso()) throw badRequest('Reset token is invalid or has expired');
    const user = findById('users', rec.userId);
    if (!user || user.status !== 'active') throw badRequest('Reset token is invalid or has expired');
    rec.usedAt = nowIso();
    user.passwordHash = await hashPassword(newPassword);
    user.passwordChangedAt = nowIso();
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    revokeUserSessions(user.id, 'password_reset');
    req.user = user;
    audit(req, { action: 'auth.password_reset', entityType: 'user', entityId: user.id });
    notifyUser(user.id, { type: 'security', title: 'Password reset', message: 'Your password was reset using a reset link.' });
    res.json({ data: { message: 'Password has been reset. Please sign in.' } });
  },
});

route({
  method: 'get', path: '/auth/sessions', tag: TAG,
  summary: 'List own active sessions',
  response: { array: 'Session' },
  handler: (req, res) => {
    const list = db.sessions.filter((x) => x.userId === req.user.id && !x.revokedAt && x.expiresAt > nowIso());
    res.json({ data: list.map((x) => ser.session(x, req.session && req.session.id)) });
  },
});

route({
  method: 'delete', path: '/auth/sessions/:sessionId', tag: TAG,
  summary: 'Revoke one of own sessions',
  params: z.object({ sessionId: z.string().uuid() }).strict(),
  handler: (req, res) => {
    const session = db.sessions.find((x) => x.id === req.v.params.sessionId && x.userId === req.user.id);
    if (!session) throw notFound('Session');
    revokeSession(session, 'revoked_by_user');
    audit(req, { action: 'auth.session_revoked', entityType: 'session', entityId: session.id });
    res.json({ data: { message: 'Session revoked' } });
  },
});

route({
  method: 'post', path: '/auth/register', tag: TAG, auth: false, status: 201, conflicts: true,
  summary: 'Self-service customer registration',
  description: 'Creates a customer profile in `pending_verification` status with online banking access. Accounts can be opened after a branch verifies identity.',
  body: z.object({
    firstName: s.name, lastName: s.name, email: s.email, phone: s.phone, dateOfBirth: s.date,
    branchId: s.id, address: s.address, password: strongPassword('password'),
  }).strict(),
  response: 'MeResponse',
  handler: async (req, res) => {
    const b = req.v.body;
    const branch = findById('branches', b.branchId);
    if (!branch || branch.status !== 'active') throw badRequest('Selected branch is not available');
    const age = (Date.now() - Date.parse(b.dateOfBirth)) / (365.25 * 86400000);
    if (!(age >= 18 && age < 120)) throw badRequest('Applicants must be at least 18 years old');
    if (db.users.some((u) => u.email === b.email) || db.customers.some((c) => c.email === b.email)) {
      throw conflict('An account with this email already exists');
    }
    const now = nowIso();
    const customer = {
      id: nextId('customers'),
      customerNumber: `CUS${String(9000000 + db.customers.length + 1).slice(-7)}`,
      firstName: b.firstName, lastName: b.lastName, email: b.email, phone: b.phone, dateOfBirth: b.dateOfBirth,
      nationalId: `SIM-000-00-${String(crypto.randomInt(1000, 9999))}`,
      address: b.address, occupation: null, annualIncome: null, branchId: b.branchId,
      status: 'pending_verification', kycStatus: 'unverified', kyc: null, riskRating: 'medium',
      userId: null, createdBy: null, createdAt: now, updatedAt: now,
    };
    const user = {
      id: nextId('users'), email: b.email, passwordHash: await hashPassword(b.password), role: 'customer',
      firstName: b.firstName, lastName: b.lastName, phone: b.phone, branchId: null, customerId: customer.id,
      status: 'active', employeeCode: null, title: null, hireDate: null, failedLoginAttempts: 0, lockedUntil: null,
      lastLoginAt: null, passwordChangedAt: now, createdAt: now, updatedAt: now,
    };
    customer.userId = user.id;
    db.customers.push(customer);
    db.users.push(user);
    req.user = user;
    audit(req, { action: 'customer.self_register', entityType: 'customer', entityId: customer.id, branchId: customer.branchId });
    notifyUser(user.id, { type: 'service', title: 'Welcome to Kestrel Bank', message: `Visit ${branch.name} with a photo ID to verify your identity and open your first account.` });
    res.status(201).json({ data: mePayload(user) });
  },
});

route({
  method: 'get', path: '/public/branches', tag: 'Public', auth: false,
  summary: 'Public branch directory (for registration and branch locator)',
  response: { array: 'PublicBranch' },
  handler: (req, res) => {
    res.json({ data: db.branches.filter((b) => b.status === 'active').map((b) => ({ id: b.id, code: b.code, name: b.name, address: b.address, phone: b.phone })) });
  },
});
