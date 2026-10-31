const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../store');
const { ApiError, unauthorized, forbidden } = require('./errors');
const { nowIso, sha256 } = require('./util');
const { verifyPassword } = require('./password');
const { hasPermission } = require('./permissions');
const { ipInCidr, normalizeIp } = require('./ip');
const { audit } = require('./audit');

const JWT_OPTS = { issuer: 'kestrel-bank', audience: 'kestrel-bank-api' };

function signAccessToken(user, session) {
  return jwt.sign({ role: user.role, sid: session.id }, config.jwtSecret, {
    ...JWT_OPTS, subject: String(user.id), algorithm: 'HS256', expiresIn: config.accessTokenTtlSec,
  });
}

function tokenPair(user, session, secret) {
  return {
    accessToken: signAccessToken(user, session),
    refreshToken: `${session.id}.${secret}`,
    tokenType: 'Bearer',
    expiresIn: config.accessTokenTtlSec,
  };
}

function createSession(user, req) {
  const secret = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const session = {
    id: crypto.randomUUID(),
    userId: user.id,
    refreshHash: sha256(secret),
    previousHashes: [],
    ip: req.ip,
    userAgent: String(req.get('user-agent') || '').slice(0, 200),
    createdAt: new Date(now).toISOString(),
    lastUsedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + Math.max(config.refreshTokenTtlSec, config.accessTokenTtlSec) * 1000).toISOString(),
    revokedAt: null,
    revokedReason: null,
  };
  db.sessions.push(session);
  return tokenPair(user, session, secret);
}

const isSessionLive = (s) => s && !s.revokedAt && s.expiresAt > nowIso();

function revokeSession(session, reason) {
  if (!session.revokedAt) {
    session.revokedAt = nowIso();
    session.revokedReason = reason;
  }
}

/**
 * Logout ends the interactive session: the refresh token stops working, so the
 * client must sign in again. Access tokens already issued for the session are
 * deliberately NOT revoked and stay valid until their own expiry
 * (ACCESS_TOKEN_TTL_SECONDS). Hard revocation (revokeSession) is reserved for
 * password/role changes, deactivation and forced sign-out.
 */
function endSession(session) {
  if (!session.loggedOutAt) session.loggedOutAt = nowIso();
  session.refreshHash = null;
}

function endUserSessions(userId) {
  let count = 0;
  db.sessions.forEach((s) => {
    if (s.userId === userId && !s.revokedAt && !s.loggedOutAt) {
      endSession(s);
      count += 1;
    }
  });
  return count;
}

const isSessionActive = (s) => isSessionLive(s) && !s.loggedOutAt;

function revokeUserSessions(userId, reason, exceptSessionId) {
  let count = 0;
  db.sessions.forEach((s) => {
    if (s.userId === userId && s.id !== exceptSessionId && !s.revokedAt) {
      revokeSession(s, reason);
      count += 1;
    }
  });
  return count;
}

/**
 * Refresh-token rotation with reuse detection: presenting an already-rotated
 * refresh token revokes the whole session (likely token theft).
 */
function rotateRefreshToken(refreshToken, req) {
  const [sid, secret] = String(refreshToken || '').split('.');
  const session = db.sessions.find((s) => s.id === sid);
  if (!session || !secret) throw unauthorized('Invalid refresh token');
  if (session.loggedOutAt) throw unauthorized('Session was logged out; sign in again');
  const hash = sha256(secret);
  if (session.previousHashes.includes(hash)) {
    revokeSession(session, 'refresh_token_reuse');
    audit(req, { action: 'auth.refresh_token_reuse', entityType: 'session', entityId: session.id, outcome: 'denied', riskLevel: 'high', details: { userId: session.userId } });
    throw unauthorized('Refresh token has already been used; session revoked');
  }
  if (session.refreshHash !== hash || !isSessionLive(session)) throw unauthorized('Invalid or expired refresh token');
  const user = db.users.find((u) => u.id === session.userId);
  if (!user || user.status !== 'active') {
    revokeSession(session, 'user_inactive');
    throw unauthorized('Account is not active');
  }
  const next = crypto.randomBytes(32).toString('base64url');
  session.previousHashes.push(session.refreshHash);
  if (session.previousHashes.length > 20) session.previousHashes.shift();
  session.refreshHash = sha256(next);
  session.lastUsedAt = nowIso();
  return tokenPair(user, session, next);
}

function adminIpAllowed(ip) {
  return db.network.ipAllowlist.some((e) => ipInCidr(ip, e.cidr));
}

function authenticateApiKey(req, rawKey) {
  const hash = sha256(rawKey);
  const key = db.apiKeys.find((k) => k.keyHash === hash && !k.revokedAt);
  if (!key) throw unauthorized('Invalid API key');
  key.lastUsedAt = nowIso();
  req.user = { id: null, role: 'api_client', branchId: null, apiKeyId: key.id, apiKeyScopes: key.scopes, firstName: key.name, lastName: '' };
}

/** Express middleware: requires a valid bearer access token (or API key). */
function authenticate(req, res, next) {
  const apiKey = req.get('x-api-key');
  if (apiKey) {
    authenticateApiKey(req, apiKey);
    return next();
  }
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();
  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret, { ...JWT_OPTS, algorithms: ['HS256'] });
  } catch (e) {
    throw new ApiError(401, e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED', e.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token');
  }
  const session = db.sessions.find((s) => s.id === claims.sid);
  if (!isSessionLive(session) || String(session.userId) !== claims.sub) throw unauthorized('Session is no longer valid');
  const user = db.users.find((u) => u.id === session.userId);
  if (!user || user.status !== 'active') throw unauthorized('Account is not active');

  if (user.role === 'super_admin' && db.network.adminIpEnforcement === 'enforce' && !adminIpAllowed(req.ip)) {
    audit(req, { action: 'security.admin_ip_blocked', entityType: 'user', entityId: user.id, outcome: 'denied', riskLevel: 'high', details: { ip: normalizeIp(req.ip) } });
    throw new ApiError(403, 'ADMIN_IP_NOT_ALLOWED', 'Administrative access is not permitted from this network');
  }
  session.lastUsedAt = nowIso();
  req.user = user;
  req.session = session;
  return next();
}

/** Permission gate. Accepts a permission or an array meaning "any of". */
function requirePermission(perms) {
  const list = Array.isArray(perms) ? perms : [perms];
  return (req, res, next) => {
    if (list.some((p) => hasPermission(req.user, p))) return next();
    audit(req, { action: 'authz.denied', outcome: 'denied', details: { method: req.method, path: req.originalUrl.split('?')[0], required: list } });
    throw forbidden();
  };
}

/**
 * Step-up authentication for critical operations: the caller must re-enter
 * their password in the X-Confirm-Password header.
 */
async function requireStepUp(req, res, next) {
  if (!req.user || !req.user.passwordHash) throw forbidden('This operation requires an interactive user session');
  const pw = req.get('x-confirm-password');
  if (!pw) throw new ApiError(428, 'STEP_UP_REQUIRED', 'Re-enter your password in the X-Confirm-Password header to confirm this action');
  if (!(await verifyPassword(pw, req.user.passwordHash))) {
    audit(req, { action: 'security.step_up_failed', outcome: 'denied', riskLevel: 'high', details: { path: req.originalUrl.split('?')[0] } });
    throw new ApiError(403, 'STEP_UP_FAILED', 'Password confirmation failed');
  }
  return next();
}

module.exports = {
  createSession, rotateRefreshToken, revokeSession, revokeUserSessions, isSessionLive, isSessionActive, endSession, endUserSessions,
  authenticate, requirePermission, requireStepUp, adminIpAllowed,
};
