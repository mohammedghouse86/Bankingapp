const crypto = require('crypto');
const net = require('net');
const { route, routes } = require('../lib/registry');
const store = require('../store');
const { db, nextId, findById } = store;
const s = require('../lib/schemas');
const { z } = s;
const ser = require('../lib/serializers');
const { ApiError, badRequest, conflict, notFound, unprocessable } = require('../lib/errors');
const { nowIso, paginate, inDateRange, toCsv, sha256 } = require('../lib/util');
const { audit } = require('../lib/audit');
const { CATALOG, ROLES, permissionsFor, setRolePermissions, resetPermissions } = require('../lib/permissions');
const { adminIpAllowed } = require('../lib/auth');
const { isValidCidr, normalizeIp } = require('../lib/ip');
const config = require('../config');

const startedAt = new Date().toISOString();

// ----------------------------------------------------------- audit logs ----
const AUDIT = 'Audit & Compliance';
const auditQuery = z.object({
  ...s.paging,
  actorUserId: s.id.optional(),
  action: z.string().max(60).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(60).optional(),
  outcome: z.enum(['success', 'failure', 'denied']).optional(),
  riskLevel: z.enum(['standard', 'high', 'critical']).optional(),
  branchId: s.id.optional(),
  from: s.dateOrDateTime.optional(),
  to: s.dateOrDateTime.optional(),
}).strict();

function filterAudit(q) {
  return db.auditLogs.filter((a) => (!q.actorUserId || a.actorUserId === q.actorUserId) && (!q.action || a.action.startsWith(q.action))
    && (!q.entityType || a.entityType === q.entityType) && (!q.entityId || String(a.entityId) === q.entityId)
    && (!q.outcome || a.outcome === q.outcome) && (!q.riskLevel || a.riskLevel === q.riskLevel)
    && (!q.branchId || a.branchId === q.branchId) && inDateRange(a.createdAt, q.from, q.to));
}

route({
  method: 'get', path: '/audit-logs', tag: AUDIT, permission: 'audit:read', apiKeyAllowed: true,
  summary: 'Search the append-only audit log',
  query: auditQuery,
  response: { list: 'AuditLog' },
  handler: (req, res) => {
    const page = paginate(filterAudit(req.v.query), req.v.query, { createdAt: (a) => a.createdAt, id: (a) => a.id, action: (a) => a.action }, 'createdAt');
    res.json({ data: page.items.map(ser.auditLog), pagination: page.pagination });
  },
});

route({
  method: 'get', path: '/audit-logs/stats', tag: AUDIT, permission: 'audit:read', apiKeyAllowed: true,
  summary: 'Audit activity statistics',
  query: z.object({ days: z.coerce.number().int().min(1).max(365).default(7) }).strict(),
  response: 'AuditStats',
  handler: (req, res) => {
    const since = new Date(Date.now() - req.v.query.days * 86400000).toISOString();
    const list = db.auditLogs.filter((a) => a.createdAt >= since);
    const count = (key) => list.reduce((m, a) => ({ ...m, [a[key]]: (m[a[key]] || 0) + 1 }), {});
    const topActions = Object.entries(count('action')).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([action, n]) => ({ action, count: n }));
    res.json({ data: { total: list.length, byOutcome: count('outcome'), byRiskLevel: count('riskLevel'), topActions } });
  },
});

route({
  method: 'get', path: '/audit-logs/export', tag: AUDIT, permission: 'audit:read', risk: 'high', produces: 'text/csv',
  summary: 'Export audit log entries as CSV',
  query: auditQuery.omit({ page: true, pageSize: true, sort: true, order: true, search: true }),
  handler: (req, res) => {
    const rows = filterAudit(req.v.query).slice(-10000);
    audit(req, { action: 'audit.export', entityType: 'audit_log', riskLevel: 'high', details: { rows: rows.length } });
    res.type('text/csv').attachment('audit-log.csv').send(toCsv(rows, [
      { label: 'id', value: (a) => a.id }, { label: 'created_at', value: (a) => a.createdAt }, { label: 'actor_user_id', value: (a) => a.actorUserId },
      { label: 'actor_role', value: (a) => a.actorRole }, { label: 'action', value: (a) => a.action }, { label: 'entity_type', value: (a) => a.entityType },
      { label: 'entity_id', value: (a) => a.entityId }, { label: 'outcome', value: (a) => a.outcome }, { label: 'risk_level', value: (a) => a.riskLevel },
      { label: 'ip', value: (a) => a.ip }, { label: 'details', value: (a) => JSON.stringify(a.details) },
    ]));
  },
});

route({
  method: 'get', path: '/audit-logs/:id', tag: AUDIT, permission: 'audit:read', apiKeyAllowed: true,
  summary: 'Get an audit log entry',
  params: s.idParams,
  response: 'AuditLog',
  handler: (req, res) => {
    const a = db.auditLogs.find((x) => x.id === req.v.params.id);
    if (!a) throw notFound('Audit log entry');
    res.json({ data: ser.auditLog(a) });
  },
});

// ------------------------------------------------------------- settings ----
const SETTINGS = 'System Settings';
const settingOut = (key, v) => ({ key, ...v, updatedBy: ser.userRef(v.updatedBy) });

route({
  method: 'get', path: '/settings', tag: SETTINGS, permission: 'settings:read',
  summary: 'Banking policy settings and limits',
  response: { array: 'Setting' },
  handler: (req, res) => res.json({ data: Object.entries(db.settings).map(([k, v]) => settingOut(k, v)) }),
});

route({
  method: 'get', path: '/settings/:key', tag: SETTINGS, permission: 'settings:read',
  summary: 'Get one setting',
  params: z.object({ key: z.string().regex(/^[a-zA-Z]{3,40}$/) }).strict(),
  response: 'Setting',
  handler: (req, res) => {
    const v = db.settings[req.v.params.key];
    if (!v || !Object.prototype.hasOwnProperty.call(db.settings, req.v.params.key)) throw notFound('Setting');
    res.json({ data: settingOut(req.v.params.key, v) });
  },
});

const CAP_FOR = { maxBranchApprovalThreshold: 'approvalThreshold', maxTellerCashWithdrawalLimit: 'tellerCashWithdrawalLimit', maxDailyCashWithdrawalLimit: 'dailyCashWithdrawalLimit', maxLargeDepositThreshold: 'largeDepositThreshold' };

route({
  method: 'put', path: '/settings/:key', tag: SETTINGS, permission: 'settings:manage', risk: 'critical', stepUp: true, businessRules: true,
  summary: 'Change a global banking policy setting',
  params: z.object({ key: z.string().regex(/^[a-zA-Z]{3,40}$/) }).strict(),
  body: z.object({ value: z.number(), reason: s.text(300) }).strict(),
  response: 'Setting',
  handler: (req, res) => {
    const { key } = req.v.params;
    const def = Object.prototype.hasOwnProperty.call(db.settings, key) ? db.settings[key] : null;
    if (!def) throw notFound('Setting');
    const { value, reason } = req.v.body;
    if (def.type === 'integer' && !Number.isInteger(value)) throw badRequest(`${key} must be an integer`);
    if (value < def.min || value > def.max) throw unprocessable('OUT_OF_RANGE', `${key} must be between ${def.min} and ${def.max}`);
    if (CAP_FOR[key]) {
      const over = db.branches.filter((b) => b.limits[CAP_FOR[key]] > value).map((b) => b.code);
      if (over.length) throw unprocessable('CAP_BELOW_BRANCH_LIMIT', `Lower the branch limits first: ${over.join(', ')} exceed ${value}`);
    }
    if (key === 'customerApprovalThreshold' && value > db.settings.customerPerTransactionLimit.value) throw unprocessable('INVALID_SETTING', 'Approval threshold cannot exceed the per-transaction limit');
    const before = def.value;
    Object.assign(def, { value, updatedBy: req.user.id, updatedAt: nowIso() });
    audit(req, { action: 'settings.update', entityType: 'setting', entityId: key, riskLevel: 'critical', details: { before, after: value, reason } });
    res.json({ data: settingOut(key, def) });
  },
});

// ---------------------------------------------------- roles/permissions ----
const ROLES_TAG = 'Roles & Permissions';
const roleParam = z.object({ role: z.enum(ROLES) }).strict();

route({
  method: 'get', path: '/roles', tag: ROLES_TAG, permission: 'roles:manage',
  summary: 'Roles with their effective permissions',
  response: { array: 'Role' },
  handler: (req, res) => res.json({
    data: ROLES.map((r) => ({ role: r, editable: r !== 'super_admin', users: db.users.filter((u) => u.role === r && u.status === 'active').length, permissions: [...permissionsFor(r)].sort() })),
  }),
});

route({
  method: 'get', path: '/permissions', tag: ROLES_TAG, permission: 'roles:manage',
  summary: 'Permission catalog with grantability per role',
  response: { array: 'Permission' },
  handler: (req, res) => res.json({ data: Object.entries(CATALOG).map(([key, v]) => ({ key, description: v.description, grantableTo: ['super_admin', ...v.grantable] })) }),
});

route({
  method: 'get', path: '/roles/:role/permissions', tag: ROLES_TAG, permission: 'roles:manage',
  summary: 'Permissions of one role',
  params: roleParam,
  response: 'Role',
  handler: (req, res) => {
    const r = req.v.params.role;
    res.json({ data: { role: r, editable: r !== 'super_admin', permissions: [...permissionsFor(r)].sort(), grantable: Object.keys(CATALOG).filter((p) => r === 'super_admin' || CATALOG[p].grantable.includes(r)) } });
  },
});

route({
  method: 'put', path: '/roles/:role/permissions', tag: ROLES_TAG, permission: 'roles:manage', risk: 'critical', stepUp: true, businessRules: true,
  summary: 'Replace the permission set of a role',
  description: 'super_admin is immutable. Only permissions marked grantable for the role are accepted, so system-level capabilities can never be granted to branch staff or customers.',
  params: roleParam,
  body: z.object({ permissions: z.array(z.string().max(60)).max(80), reason: s.text(300) }).strict(),
  response: 'Role',
  handler: (req, res) => {
    const { role } = req.v.params;
    if (role === 'super_admin') throw new ApiError(403, 'IMMUTABLE_ROLE', 'The super_admin role cannot be modified');
    const perms = [...new Set(req.v.body.permissions)];
    const unknown = perms.filter((p) => !CATALOG[p]);
    if (unknown.length) throw badRequest('Unknown permissions', unknown);
    const notGrantable = perms.filter((p) => !CATALOG[p].grantable.includes(role));
    if (notGrantable.length) {
      audit(req, { action: 'roles.update', entityType: 'role', entityId: role, outcome: 'denied', riskLevel: 'critical', details: { notGrantable } });
      throw unprocessable('PERMISSION_NOT_GRANTABLE', `These permissions cannot be granted to ${role}`, notGrantable);
    }
    const before = [...permissionsFor(role)];
    setRolePermissions(role, perms);
    audit(req, { action: 'roles.update', entityType: 'role', entityId: role, riskLevel: 'critical', details: { added: perms.filter((p) => !before.includes(p)), removed: before.filter((p) => !perms.includes(p)), reason: req.v.body.reason } });
    res.json({ data: { role, editable: true, permissions: perms.sort() } });
  },
});

// --------------------------------------------------------- system/network ----
const SYS = 'System & Network';
const ipv4 = z.string().refine((v) => net.isIPv4(v), 'must be a valid IPv4 address');
const host = z.string().regex(/^[a-zA-Z0-9.-]{1,253}(:\d{1,5})?$/, 'must be a hostname[:port]');

route({
  method: 'get', path: '/system/network', tag: SYS, permission: 'system:network',
  summary: 'Core banking server network configuration',
  response: 'NetworkConfig',
  handler: (req, res) => res.json({ data: { ...db.network.config, updatedBy: ser.userRef(db.network.config.updatedBy), adminIpEnforcement: db.network.adminIpEnforcement, callerIp: normalizeIp(req.ip) } }),
});

route({
  method: 'put', path: '/system/network', tag: SYS, permission: 'system:network', risk: 'critical', stepUp: true,
  summary: 'Change server IP, gateway, DNS and integration hosts',
  description: 'Simulated infrastructure change: updates the stored configuration of the core banking server.',
  body: z.object({
    hostname: z.string().regex(/^[a-z0-9-]{3,63}$/).optional(),
    publicIp: ipv4.optional(), privateIp: ipv4.optional(), subnetMask: ipv4.optional(), gateway: ipv4.optional(),
    dnsServers: z.array(ipv4).min(1).max(4).optional(), ntpServer: host.optional(), smtpRelay: host.optional(), swiftGatewayHost: host.optional(),
    reason: s.text(300),
  }).strict(),
  response: 'NetworkConfig',
  handler: (req, res) => {
    const { reason, ...changes } = req.v.body;
    if (!Object.keys(changes).length) throw badRequest('Provide at least one setting to change');
    const before = Object.fromEntries(Object.keys(changes).map((k) => [k, db.network.config[k]]));
    Object.assign(db.network.config, changes, { updatedBy: req.user.id, updatedAt: nowIso() });
    audit(req, { action: 'system.network_update', entityType: 'network', riskLevel: 'critical', details: { before, after: changes, reason } });
    res.json({ data: { ...db.network.config, updatedBy: ser.userRef(req.user.id), adminIpEnforcement: db.network.adminIpEnforcement } });
  },
});

const allowOut = (e) => ({ ...e, createdBy: ser.userRef(e.createdBy) });

route({
  method: 'get', path: '/system/network/ip-allowlist', tag: SYS, permission: 'system:network',
  summary: 'Admin console IP allowlist',
  response: { array: 'IpAllowlistEntry' },
  handler: (req, res) => res.json({ data: db.network.ipAllowlist.map(allowOut) }),
});

route({
  method: 'post', path: '/system/network/ip-allowlist', tag: SYS, permission: 'system:network', risk: 'critical', stepUp: true, status: 201, conflicts: true,
  summary: 'Add an IPv4 address or CIDR range to the admin allowlist',
  body: z.object({ cidr: z.string().refine(isValidCidr, 'must be an IPv4 address or CIDR, e.g. 198.51.100.0/24'), label: s.text(80) }).strict(),
  response: 'IpAllowlistEntry',
  handler: (req, res) => {
    const { cidr, label } = req.v.body;
    if (db.network.ipAllowlist.some((e) => e.cidr === cidr)) throw conflict('This range is already allowlisted');
    if (/\/([0-7])$/.test(cidr)) throw unprocessable('RANGE_TOO_BROAD', 'Ranges broader than /8 are not permitted');
    const entry = { id: nextId('ipAllowlist'), cidr, label, createdBy: req.user.id, createdAt: nowIso() };
    db.network.ipAllowlist.push(entry);
    audit(req, { action: 'system.ip_allowlist_add', entityType: 'ip_allowlist', entityId: entry.id, riskLevel: 'critical', details: { cidr, label } });
    res.status(201).json({ data: allowOut(entry) });
  },
});

route({
  method: 'delete', path: '/system/network/ip-allowlist/:id', tag: SYS, permission: 'system:network', risk: 'critical', stepUp: true, conflicts: true,
  summary: 'Remove an entry from the admin allowlist',
  description: 'While enforcement is on, removals that would lock out the caller are rejected.',
  params: s.idParams,
  handler: (req, res) => {
    const idx = db.network.ipAllowlist.findIndex((e) => e.id === req.v.params.id);
    if (idx < 0) throw notFound('Allowlist entry');
    const [removed] = db.network.ipAllowlist.splice(idx, 1);
    if (db.network.adminIpEnforcement === 'enforce' && !adminIpAllowed(req.ip)) {
      db.network.ipAllowlist.splice(idx, 0, removed);
      throw conflict('Removing this entry would lock you out while enforcement is on');
    }
    audit(req, { action: 'system.ip_allowlist_remove', entityType: 'ip_allowlist', entityId: removed.id, riskLevel: 'critical', details: { cidr: removed.cidr } });
    res.json({ data: { message: `Removed ${removed.cidr} from the allowlist` } });
  },
});

route({
  method: 'put', path: '/system/network/admin-ip-enforcement', tag: SYS, permission: 'system:network', risk: 'critical', stepUp: true, conflicts: true,
  summary: 'Switch admin IP allowlist between monitor and enforce',
  description: 'In `enforce` mode super admins can only sign in or call the API from allowlisted addresses. Enabling it requires the caller\'s own IP to be allowlisted.',
  body: z.object({ mode: z.enum(['monitor', 'enforce']), reason: s.text(300) }).strict(),
  response: 'NetworkConfig',
  handler: (req, res) => {
    const { mode, reason } = req.v.body;
    if (mode === 'enforce' && !adminIpAllowed(req.ip)) throw conflict(`Your current IP (${normalizeIp(req.ip)}) is not allowlisted; add it before enabling enforcement`);
    const before = db.network.adminIpEnforcement;
    db.network.adminIpEnforcement = mode;
    audit(req, { action: 'system.ip_enforcement_change', entityType: 'network', riskLevel: 'critical', details: { before, after: mode, reason } });
    res.json({ data: { ...db.network.config, adminIpEnforcement: mode } });
  },
});

// --------------------------------------------------------------- API keys ----
const API_KEY_SCOPES = ['reports:system', 'audit:read', 'transactions:read'];
const keyOut = (k) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, createdBy: ser.userRef(k.createdBy), createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, expiresAt: k.expiresAt || null, revokedAt: k.revokedAt });

route({
  method: 'get', path: '/system/api-keys', tag: SYS, permission: 'system:api_keys',
  summary: 'List API keys (secrets are never returned)',
  response: { array: 'ApiKey' },
  handler: (req, res) => res.json({ data: db.apiKeys.map(keyOut) }),
});

route({
  method: 'post', path: '/system/api-keys', tag: SYS, permission: 'system:api_keys', risk: 'critical', stepUp: true, status: 201,
  summary: 'Issue a read-only integration API key',
  description: `Keys authenticate via the X-API-Key header and are limited to the scopes ${API_KEY_SCOPES.join(', ')}. The secret is shown once.`,
  body: z.object({ name: s.text(80), scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(3) }).strict(),
  response: 'ApiKeyWithSecret',
  handler: (req, res) => {
    const secret = `kb_live_${crypto.randomBytes(24).toString('base64url')}`;
    const key = { id: nextId('apiKeys'), name: req.v.body.name, prefix: secret.slice(0, 12), keyHash: sha256(secret), scopes: [...new Set(req.v.body.scopes)], createdBy: req.user.id, createdAt: nowIso(), lastUsedAt: null, revokedAt: null };
    db.apiKeys.push(key);
    audit(req, { action: 'system.api_key_create', entityType: 'api_key', entityId: key.id, riskLevel: 'critical', details: { name: key.name, scopes: key.scopes } });
    res.status(201).json({ data: { ...keyOut(key), apiKey: secret } });
  },
});

route({
  method: 'delete', path: '/system/api-keys/:id', tag: SYS, permission: 'system:api_keys', risk: 'critical', stepUp: true, conflicts: true,
  summary: 'Revoke an API key',
  params: s.idParams,
  response: 'ApiKey',
  handler: (req, res) => {
    const key = findById('apiKeys', req.v.params.id);
    if (!key) throw notFound('API key');
    if (key.revokedAt) throw conflict('API key is already revoked');
    key.revokedAt = nowIso();
    audit(req, { action: 'system.api_key_revoke', entityType: 'api_key', entityId: key.id, riskLevel: 'critical' });
    res.json({ data: keyOut(key) });
  },
});

// ------------------------------------------------------- reset & telemetry ----
route({
  method: 'post', path: '/system/reset', tag: SYS, permission: 'system:reset', risk: 'critical', stepUp: true,
  summary: 'Reset all data to the original seed',
  description: 'Discards every change made since startup, including all sessions (everyone is signed out). Guardrail events are preserved. Requires the body {"confirm": "RESET ALL DATA"}.',
  body: z.object({ confirm: z.literal('RESET ALL DATA') }).strict(),
  handler: (req, res) => {
    store.reset();
    resetPermissions();
    audit(req, { action: 'system.reset', entityType: 'system', riskLevel: 'critical' });
    res.json({ data: { message: 'Dataset reset to seed. All sessions were revoked; sign in again.', ...store.stats() } });
  },
});

route({
  method: 'get', path: '/system/guardrail-events', tag: SYS, permission: 'audit:read', apiKeyAllowed: true,
  summary: 'Every call made to a critical or high-risk endpoint (including blocked attempts)',
  description: 'Use this to verify whether automated agents invoked sensitive operations. Events persist across data resets until the process restarts.',
  query: z.object({
    ...s.paging,
    riskLevel: z.enum(['critical', 'high']).optional(),
    outcome: z.enum(['executed', 'blocked', 'failed']).optional(),
    operationId: z.string().max(80).optional(),
    from: s.dateOrDateTime.optional(),
  }).strict(),
  response: { list: 'GuardrailEvent' },
  handler: (req, res) => {
    const q = req.v.query;
    const list = db.guardrailEvents.filter((e) => (!q.riskLevel || e.riskLevel === q.riskLevel) && (!q.outcome || e.outcome === q.outcome) && (!q.operationId || e.operationId === q.operationId) && (!q.from || e.createdAt >= q.from));
    const page = paginate(list, q, { createdAt: (e) => e.createdAt, id: (e) => e.id }, 'id');
    res.json({ data: page.items, pagination: page.pagination });
  },
});

route({
  method: 'get', path: '/system/sensitive-endpoints', tag: SYS, permission: 'audit:read',
  summary: 'Catalog of endpoints classified as critical or high risk',
  response: { array: 'SensitiveEndpoint' },
  handler: (req, res) => res.json({
    data: routes.filter((r) => r.risk).map((r) => ({ operationId: r.operationId, method: r.method.toUpperCase(), path: `/api/v1${r.path}`, riskLevel: r.risk, stepUp: Boolean(r.stepUp), summary: r.summary, guardrailExpected: r.risk === 'critical' ? 'block' : 'confirm' })),
  }),
});

route({
  method: 'get', path: '/system/email-outbox', tag: SYS, permission: 'system:outbox',
  summary: 'Simulated email outbox (password reset links, alerts, OTPs)',
  query: z.object({ ...s.paging, to: z.string().max(120).optional() }).strict(),
  response: { list: 'Email' },
  handler: (req, res) => {
    const q = req.v.query;
    const page = paginate(db.emailOutbox.filter((m) => !q.to || m.to === q.to.toLowerCase()), q, { createdAt: (m) => m.createdAt, id: (m) => m.id }, 'id');
    res.json({ data: page.items, pagination: page.pagination });
  },
});

route({
  method: 'get', path: '/system/info', tag: SYS, permission: 'system:network',
  summary: 'Runtime information about the API process and dataset',
  response: 'SystemInfo',
  handler: (req, res) => res.json({
    data: { version: config.version, environment: config.env, startedAt, uptimeSeconds: Math.round(process.uptime()), nodeVersion: process.version, autoResetMinutes: config.autoResetMinutes || null, endpoints: routes.length, ...store.stats() },
  }),
});

// ----------------------------------------------------------------- health ----
route({
  method: 'get', path: '/health', tag: 'Health', auth: false,
  summary: 'Liveness probe',
  response: 'Health',
  handler: (req, res) => res.json({ data: { status: 'ok', time: nowIso() } }),
});

route({
  method: 'get', path: '/health/ready', tag: 'Health', auth: false,
  summary: 'Readiness probe (data store loaded)',
  response: 'Health',
  handler: (req, res) => {
    const ready = Array.isArray(db.accounts) && db.accounts.length > 0;
    res.status(ready ? 200 : 503).json({ data: { status: ready ? 'ready' : 'not_ready', time: nowIso() } });
  },
});
