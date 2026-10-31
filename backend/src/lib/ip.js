// Minimal IPv4 / CIDR helpers used by the admin IP allowlist.
const net = require('net');

function normalizeIp(ip) {
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function isValidCidr(cidr) {
  const [ip, bits, extra] = String(cidr).split('/');
  if (extra !== undefined || !net.isIPv4(ip)) return false;
  if (bits === undefined) return true;
  return /^\d{1,2}$/.test(bits) && Number(bits) <= 32;
}

function ipInCidr(ip, cidr) {
  const addr = normalizeIp(ip);
  if (!net.isIPv4(addr)) return false;
  const [base, bitsStr] = cidr.split('/');
  const bits = bitsStr === undefined ? 32 : Number(bitsStr);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(addr) & mask) === (ipv4ToInt(base) & mask);
}

module.exports = { normalizeIp, isValidCidr, ipInCidr };
