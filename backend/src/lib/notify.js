const { db, nextId } = require('../store');
const { nowIso } = require('./util');

function notifyUser(userId, { type = 'info', title, message, link = null }) {
  if (!userId) return;
  db.notifications.push({ id: nextId('notifications'), userId, type, title, message, link, readAt: null, createdAt: nowIso() });
}

function notifyCustomer(customerId, n) {
  db.users.filter((u) => u.role === 'customer' && u.customerId === customerId).forEach((u) => notifyUser(u.id, n));
}

function notifyBranchManagers(branchId, n) {
  db.users.filter((u) => u.role === 'manager' && u.branchId === branchId && u.status === 'active').forEach((u) => notifyUser(u.id, n));
}

function notifyAdmins(n) {
  db.users.filter((u) => u.role === 'super_admin' && u.status === 'active').forEach((u) => notifyUser(u.id, n));
}

/** Simulated email delivery: messages land in an outbox visible to super admins. */
function sendEmail(to, subject, body) {
  db.emailOutbox.push({ id: nextId('emailOutbox'), to, subject, body, createdAt: nowIso() });
}

const setting = (key) => db.settings[key].value;

module.exports = { notifyUser, notifyCustomer, notifyBranchManagers, notifyAdmins, sendEmail, setting };
