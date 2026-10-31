const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64');
  const key = await scrypt(password, salt, KEYLEN, PARAMS);
  return `scrypt$${salt}$${key.toString('base64')}`;
}

function hashPasswordSync(password) {
  const salt = crypto.randomBytes(16).toString('base64');
  const key = crypto.scryptSync(password, salt, KEYLEN, PARAMS);
  return `scrypt$${salt}$${key.toString('base64')}`;
}

// Used when the user does not exist so that response timing does not reveal
// whether an email is registered.
const DUMMY_HASH = hashPasswordSync('dummy-password-for-timing');

async function verifyPassword(password, stored) {
  const [scheme, salt, keyB64] = String(stored || DUMMY_HASH).split('$');
  if (scheme !== 'scrypt' || !salt || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(String(password), salt, expected.length, PARAMS);
  return crypto.timingSafeEqual(expected, actual);
}

const PASSWORD_RULES = 'at least 10 characters including upper and lower case letters, a number and a symbol';

function isStrongPassword(pw) {
  return typeof pw === 'string' && pw.length >= 10 && pw.length <= 128
    && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

function generateTempPassword() {
  const base = crypto.randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, 'x');
  return `Kb-${base}7!`;
}

module.exports = { hashPassword, hashPasswordSync, verifyPassword, isStrongPassword, PASSWORD_RULES, generateTempPassword };
