/*
 * Permission catalog and role -> permission mapping.
 *
 * `grantable` lists the roles that may ever hold a permission. A super admin
 * can customise role permissions at runtime (PUT /roles/:role/permissions),
 * but only within these bounds, so a misconfiguration can never hand a teller
 * or customer a system-level capability. super_admin implicitly holds every
 * permission and cannot be edited.
 */
const ROLES = ['super_admin', 'manager', 'teller', 'customer'];
const STAFF_ROLES = ['super_admin', 'manager', 'teller'];

const M = ['manager'];
const MT = ['manager', 'teller'];
const C = ['customer'];
const NONE = [];

const CATALOG = {
  'branches:read': { description: 'View branch directory and details', grantable: MT },
  'branches:manage': { description: 'Create, update and deactivate branches', grantable: NONE },
  'branch_limits:manage': { description: 'Adjust transaction limits for own branch', grantable: M },
  'users:read': { description: 'View employee records in scope', grantable: M },
  'users:manage': { description: 'Create and manage tellers in own branch', grantable: M },
  'users:privileged': { description: 'Manage managers/admins, roles, passwords and branch assignment', grantable: NONE },
  'customers:read': { description: 'Search and view customer profiles in scope', grantable: MT },
  'customers:create': { description: 'Onboard new customers', grantable: MT },
  'customers:update': { description: 'Edit customer profile and contact details', grantable: MT },
  'customers:kyc_submit': { description: 'Submit identity verification documents', grantable: MT },
  'customers:kyc_decide': { description: 'Approve or reject identity verification', grantable: M },
  'customers:status': { description: 'Activate or suspend customer profiles', grantable: M },
  'customers:portal_access': { description: 'Grant or revoke customer online banking access', grantable: M },
  'customers:export': { description: 'Bulk export of customer PII', grantable: NONE },
  'customers:delete': { description: 'Erase customer records (right to be forgotten)', grantable: NONE },
  'notes:write': { description: 'Add internal notes to customer profiles', grantable: MT },
  'accounts:read': { description: 'View accounts in scope', grantable: MT },
  'accounts:open': { description: 'Open new accounts', grantable: MT },
  'accounts:update': { description: 'Update account settings (nickname, overdraft)', grantable: M },
  'accounts:freeze': { description: 'Freeze, unfreeze and reactivate accounts', grantable: M },
  'accounts:close': { description: 'Close accounts and break fixed deposits', grantable: M },
  'accounts:holders': { description: 'Add or remove joint account holders', grantable: M },
  'transactions:read': { description: 'View transactions in scope', grantable: MT },
  'transactions:deposit': { description: 'Post cash deposits', grantable: MT },
  'transactions:withdraw': { description: 'Process cash withdrawals', grantable: MT },
  'transactions:transfer': { description: 'Initiate transfers on behalf of customers', grantable: MT },
  'transactions:approve': { description: 'Approve or reject pending transactions', grantable: M },
  'transactions:reverse': { description: 'Reverse completed transactions', grantable: M },
  'approvals:read': { description: 'View the approval queue', grantable: M },
  'disputes:read': { description: 'View transaction disputes in scope', grantable: MT },
  'disputes:manage': { description: 'Investigate and resolve disputes', grantable: M },
  'service_requests:read': { description: 'View service requests in scope', grantable: MT },
  'service_requests:manage': { description: 'Assign and update service requests', grantable: MT },
  'reports:branch': { description: 'Branch-level reports and analytics', grantable: M },
  'reports:system': { description: 'System-wide reports and analytics', grantable: NONE },
  'audit:read': { description: 'View and export audit logs', grantable: NONE },
  'settings:read': { description: 'View banking policy settings', grantable: MT },
  'settings:manage': { description: 'Change global banking policy settings', grantable: NONE },
  'roles:manage': { description: 'Edit role permissions', grantable: NONE },
  'notifications:broadcast': { description: 'Send notifications to user groups', grantable: NONE },
  'system:network': { description: 'Manage network configuration and admin IP allowlist', grantable: NONE },
  'system:api_keys': { description: 'Issue and revoke API keys', grantable: NONE },
  'system:reset': { description: 'Reset the simulated dataset', grantable: NONE },
  'system:outbox': { description: 'View the simulated email outbox', grantable: NONE },
  'portal:accounts': { description: 'View own accounts, transactions and statements', grantable: C },
  'portal:transfer': { description: 'Transfer funds from own accounts', grantable: C },
  'portal:beneficiaries': { description: 'Manage own beneficiaries', grantable: C },
  'portal:service_requests': { description: 'Create and track own service requests', grantable: C },
  'portal:disputes': { description: 'Raise and track disputes on own transactions', grantable: C },
  'portal:profile': { description: 'Update own contact details', grantable: C },
};

const ALL = Object.keys(CATALOG);

const DEFAULT_ROLE_PERMISSIONS = {
  super_admin: ALL,
  manager: [
    'branches:read', 'branch_limits:manage', 'users:read', 'users:manage',
    'customers:read', 'customers:create', 'customers:update', 'customers:kyc_submit', 'customers:kyc_decide',
    'customers:status', 'customers:portal_access', 'notes:write',
    'accounts:read', 'accounts:open', 'accounts:update', 'accounts:freeze', 'accounts:close', 'accounts:holders',
    'transactions:read', 'transactions:deposit', 'transactions:withdraw', 'transactions:transfer',
    'transactions:approve', 'transactions:reverse', 'approvals:read',
    'disputes:read', 'disputes:manage', 'service_requests:read', 'service_requests:manage',
    'reports:branch', 'settings:read',
  ],
  teller: [
    'branches:read', 'customers:read', 'customers:create', 'customers:kyc_submit', 'notes:write',
    'accounts:read', 'transactions:read', 'transactions:deposit', 'transactions:withdraw', 'transactions:transfer',
    'disputes:read', 'service_requests:read', 'service_requests:manage', 'settings:read',
  ],
  customer: ['portal:accounts', 'portal:transfer', 'portal:beneficiaries', 'portal:service_requests', 'portal:disputes', 'portal:profile'],
};

// Runtime (mutable) mapping; reset together with the data store.
let rolePermissions = {};

function resetPermissions() {
  rolePermissions = Object.fromEntries(Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([r, p]) => [r, new Set(p)]));
}
resetPermissions();

function permissionsFor(role) {
  if (role === 'super_admin') return new Set(ALL);
  return rolePermissions[role] || new Set();
}

function hasPermission(principal, perm) {
  if (principal.apiKeyScopes) return principal.apiKeyScopes.includes(perm);
  return permissionsFor(principal.role).has(perm);
}

function setRolePermissions(role, perms) {
  rolePermissions[role] = new Set(perms);
}

module.exports = { ROLES, STAFF_ROLES, CATALOG, ALL, DEFAULT_ROLE_PERMISSIONS, permissionsFor, hasPermission, setRolePermissions, resetPermissions };
