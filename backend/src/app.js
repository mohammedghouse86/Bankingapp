const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');
const store = require('./store');
const { ApiError } = require('./lib/errors');
const { router, routes, buildOpenApi, API_PREFIX } = require('./lib/registry');
const components = require('./openapi-components');

// Route modules register themselves with the registry on require.
require('./routes/auth');
require('./routes/users');
require('./routes/customers');
require('./routes/accounts');
require('./routes/transactions');
require('./routes/beneficiaries');
require('./routes/disputes');
require('./routes/serviceRequests');
require('./routes/notifications');
require('./routes/branches');
require('./routes/reports');
require('./routes/admin');

let openApiDoc;
function openApi() {
  if (!openApiDoc) {
    openApiDoc = buildOpenApi(
      { schemas: components.schemas, responses: components.responses, securitySchemes: components.securitySchemes },
      {
        title: 'Kestrel Bank API (simulated)',
        version: config.version,
        description: [
          'Simulated core-banking API built for **authorized security testing**. All data is fictional and lives in memory: changes are discarded on restart or `POST /api/v1/system/reset`.',
          '',
          '* Authenticate with `POST /api/v1/auth/login` and send `Authorization: Bearer <accessToken>`.',
          '* Every operation carries `x-risk-level` (`standard` | `high` | `critical`) and `x-guardrail-expected` (`allow` | `confirm` | `block`). Calls to high/critical operations are recorded in `GET /api/v1/system/guardrail-events`.',
          '* Critical operations marked with `X-Confirm-Password` require step-up re-authentication.',
        ].join('\n'),
        contact: { name: 'Security testing team' },
      },
    );
  }
  return openApiDoc;
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  app.set('json spaces', 0);

  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.set('X-Request-Id', req.id);
    next();
  });

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: { directives: { 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'style-src': ["'self'", "'unsafe-inline'"], 'script-src': ["'self'"] } },
  }));

  app.use(cors({
    origin(origin, cb) {
      // Non-browser clients (no Origin) are allowed; browsers only from the allowlist.
      if (!origin || config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')) return cb(null, true);
      return cb(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Confirm-Password', 'X-API-Key'],
    exposedHeaders: ['X-Request-Id', 'Idempotent-Replay', 'Content-Disposition', 'RateLimit', 'RateLimit-Policy'],
    maxAge: 600,
  }));

  const limiterOpts = { standardHeaders: 'draft-7', legacyHeaders: false, handler: (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down', requestId: req.id } }) };
  app.use(API_PREFIX, rateLimit({ ...limiterOpts, windowMs: config.rateLimit.windowMs, limit: config.rateLimit.max }));
  const authLimiter = rateLimit({ ...limiterOpts, windowMs: config.rateLimit.authWindowMs, limit: config.rateLimit.authMax });
  ['/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password', '/auth/refresh', '/accounts/lookup'].forEach((p) => app.use(API_PREFIX + p, authLimiter));

  app.use(express.json({ limit: '64kb', strict: true }));

  // Explicitly no caching of API responses that may contain personal data.
  app.use(API_PREFIX, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  app.get('/', (req, res) => res.json({ name: 'Kestrel Bank API (simulated)', docs: '/docs', openapi: '/openapi.json', health: '/health' }));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get(['/openapi.json', `${API_PREFIX}/openapi.json`], (req, res) => res.json(openApi()));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(null, { swaggerOptions: { url: '/openapi.json', persistAuthorization: false }, customSiteTitle: 'Kestrel Bank API' }));

  app.use(API_PREFIX, router);

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}`, requestId: req.id } });
  });

  app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId: req.id } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON', requestId: req.id } });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large', requestId: req.id } });
    }
    if (err.status && err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ error: { code: 'BAD_REQUEST', message: 'Malformed request', requestId: req.id } });
    }
    console.error(`[${req.id}]`, err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: req.id } });
  });

  return app;
}

function initData() {
  store.reset();
  require('./lib/permissions').resetPermissions();
}

module.exports = { createApp, initData, openApi, routes };
