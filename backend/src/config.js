require('dotenv').config();
const path = require('path');

const env = process.env;
const isProd = env.NODE_ENV === 'production';

const jwtSecret = env.JWT_SECRET || (isProd ? null : 'dev-only-insecure-jwt-secret-do-not-use-in-prod');
if (!jwtSecret) {
  throw new Error('JWT_SECRET must be set when NODE_ENV=production');
}

function list(value, fallback) {
  return (value || fallback).split(',').map((s) => s.trim()).filter(Boolean);
}

module.exports = {
  env: env.NODE_ENV || 'development',
  isProd,
  port: Number(env.PORT || 4000),
  jwtSecret,
  accessTokenTtlSec: Number(env.ACCESS_TOKEN_TTL_SECONDS || 4 * 60 * 60),
  refreshTokenTtlSec: Number(env.REFRESH_TOKEN_TTL_SECONDS || 60 * 60 * 12),
  corsOrigins: list(env.CORS_ORIGINS, 'http://localhost:5173,http://127.0.0.1:5173'),
  trustProxy: env.TRUST_PROXY || (isProd ? '1' : 'loopback'),
  rateLimit: {
    windowMs: 60 * 1000,
    max: Number(env.RATE_LIMIT_MAX || 600),
    authWindowMs: 15 * 60 * 1000,
    authMax: Number(env.AUTH_RATE_LIMIT_MAX || 30),
  },
  seedFile: env.SEED_FILE || path.join(__dirname, '..', 'data', 'seed.json'),
  autoResetMinutes: Number(env.AUTO_RESET_MINUTES || 0),
  version: require('../package.json').version,
};
