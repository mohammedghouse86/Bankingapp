const crypto = require('crypto');
const { badRequest } = require('./errors');

const nowIso = () => new Date().toISOString();

const toCents = (amount) => Math.round(Number(amount) * 100);
const fromCents = (cents) => Math.round(cents) / 100;

function reference(prefix) {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}${ymd}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function maskTail(value, visible = 4) {
  if (!value) return null;
  const s = String(value);
  return `${'*'.repeat(Math.max(0, s.length - visible))}${s.slice(-visible)}`;
}

function maskName(first, last) {
  const m = (s) => (s ? `${s[0]}${'*'.repeat(Math.max(2, s.length - 1))}` : '');
  return `${m(first)} ${m(last)}`.trim();
}

function maskEmail(email) {
  if (!email) return null;
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}

function startOfUtcDay(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function includesText(haystacks, needle) {
  if (!needle) return true;
  const n = needle.toLowerCase();
  return haystacks.some((h) => h != null && String(h).toLowerCase().includes(n));
}

function inDateRange(iso, from, to) {
  if (from && iso < from) return false;
  if (to) {
    // A bare date (YYYY-MM-DD) for `to` is inclusive of that whole day.
    const end = to.length === 10 ? `${to}T23:59:59.999Z` : to;
    if (iso > end) return false;
  }
  return true;
}

/**
 * Sort + paginate an in-memory list. `sortable` maps public sort keys to
 * accessor functions; unknown keys are rejected so the API surface is explicit.
 */
function paginate(items, query, sortable = {}, defaultSort) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const sortKey = query.sort || defaultSort;
  let list = items;
  if (sortKey) {
    const accessor = sortable[sortKey];
    if (!accessor) {
      throw badRequest(`Unsupported sort field '${sortKey}'`, { allowed: Object.keys(sortable) });
    }
    const dir = (query.order || 'desc') === 'asc' ? 1 : -1;
    list = [...items].sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va > vb ? dir : va < vb ? -dir : 0;
    });
  }
  const total = list.length;
  const start = (page - 1) * pageSize;
  return {
    items: list.slice(start, start + pageSize),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

function toCsv(rows, columns) {
  const esc = (v) => {
    if (v == null) return '';
    let s = String(v);
    // Neutralise spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(c.value(r))).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

module.exports = {
  nowIso, toCents, fromCents, reference, sha256, maskTail, maskName, maskEmail,
  startOfUtcDay, includesText, inDateRange, paginate, toCsv,
};
