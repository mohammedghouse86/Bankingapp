// Generates docs/API_ENDPOINTS.md from the route registry.
const fs = require('fs');
const path = require('path');
const { routes } = require('../src/app');
const { DEFAULT_ROLE_PERMISSIONS } = require('../src/lib/permissions');

function rolesFor(r) {
  if (!r.auth) return 'public';
  const perms = r.permission ? [].concat(r.permission) : null;
  const roles = ['super_admin', 'manager', 'teller', 'customer'].filter((role) => {
    if (r.roles && !r.roles.includes(role)) return false;
    return !perms || perms.some((p) => DEFAULT_ROLE_PERMISSIONS[role].includes(p));
  });
  return roles.join(', ') || '-';
}

const byTag = {};
routes.forEach((r) => { (byTag[r.tag] = byTag[r.tag] || []).push(r); });

const lines = [
  '# API endpoint inventory',
  '',
  `Generated from the route registry - **${routes.length} endpoints** under the \`/api/v1\` prefix. ` +
  `Risk levels: **critical** ${routes.filter((r) => r.risk === 'critical').length}, **high** ${routes.filter((r) => r.risk === 'high').length}, standard ${routes.filter((r) => !r.risk).length}.`,
  '',
  'Columns: *Roles* are the roles allowed by default permissions (object-level and branch-scope checks apply on top). ',
  '*Step-up* means the `X-Confirm-Password` header is required. Regenerate with `npm run inventory`.',
  '',
];
Object.entries(byTag).forEach(([tag, list]) => {
  lines.push(`## ${tag} (${list.length})`, '', '| Method | Path | Summary | Permission | Roles | Risk | Step-up |', '|---|---|---|---|---|---|---|');
  list.forEach((r) => {
    lines.push(`| ${r.method.toUpperCase()} | \`/api/v1${r.path}\` | ${r.summary.replace(/\|/g, '/')} | ${r.permission ? [].concat(r.permission).map((p) => `\`${p}\``).join(' or ') : r.auth ? 'authenticated' : 'none'} | ${rolesFor(r)} | ${r.risk || 'standard'} | ${r.stepUp ? 'yes' : ''} |`);
  });
  lines.push('');
});

const out = path.join(__dirname, '..', '..', 'docs', 'API_ENDPOINTS.md');
fs.writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`Wrote ${out} (${routes.length} endpoints)`);

// ---- Role-permission matrix (default permissions; grantable bounds in brackets) ----
const { CATALOG } = require('../src/lib/permissions');
const ROLE_LIST = ['super_admin', 'manager', 'teller', 'customer'];
const matrix = [
  '# Role-permission matrix',
  '',
  'Generated from `backend/src/lib/permissions.js` (`npm run inventory`). ✅ = granted by default, ◻️ = not granted by default but a super admin may grant it at runtime, — = can never be granted to this role. `super_admin` always holds every permission and cannot be edited.',
  '',
  'Object-level rules apply on top of permissions: managers and tellers are confined to their branch, customers to records they own, and nobody may approve or reverse their own transactions.',
  '',
  `| Permission | Description | ${ROLE_LIST.join(' | ')} |`,
  `|---|---|${ROLE_LIST.map(() => ':-:').join('|')}|`,
  ...Object.entries(CATALOG).map(([perm, def]) => {
    const cells = ROLE_LIST.map((r) => {
      if (r === 'super_admin' || DEFAULT_ROLE_PERMISSIONS[r].includes(perm)) return '✅';
      return def.grantable.includes(r) ? '◻️' : '—';
    });
    return `| \`${perm}\` | ${def.description} | ${cells.join(' | ')} |`;
  }),
  '',
];
const matrixOut = path.join(__dirname, '..', '..', 'docs', 'ROLE_PERMISSIONS.md');
fs.writeFileSync(matrixOut, `${matrix.join('\n')}\n`);
console.log(`Wrote ${matrixOut}`);
