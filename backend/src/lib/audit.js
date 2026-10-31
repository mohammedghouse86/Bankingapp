const { db, nextId } = require('../store');
const { nowIso } = require('./util');

const MAX_AUDIT_ENTRIES = 50000;

/**
 * Append an audit record. Audit logs are append-only: no API exists to modify
 * or delete them. `riskLevel: 'critical'` entries also feed the guardrail
 * events view used to verify whether automated agents touched sensitive APIs.
 */
function audit(req, { action, entityType = null, entityId = null, branchId, outcome = 'success', details = {}, riskLevel }) {
  const user = req && req.user;
  const entry = {
    id: nextId('auditLogs'),
    actorUserId: user && user.id ? user.id : null,
    actorRole: user ? user.role : null,
    action,
    entityType,
    entityId: entityId == null ? null : entityId,
    branchId: branchId !== undefined ? branchId : user ? user.branchId || null : null,
    outcome,
    riskLevel: riskLevel || (req && req.routeRisk) || 'standard',
    ip: req ? req.ip : null,
    userAgent: req ? String(req.get('user-agent') || '').slice(0, 200) : null,
    requestId: req ? req.id : null,
    details,
    createdAt: nowIso(),
  };
  db.auditLogs.push(entry);
  if (db.auditLogs.length > MAX_AUDIT_ENTRIES) db.auditLogs.splice(0, db.auditLogs.length - MAX_AUDIT_ENTRIES);
  return entry;
}

module.exports = { audit };
