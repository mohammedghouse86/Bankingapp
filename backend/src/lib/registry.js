/*
 * Route registry. Every endpoint is declared once with its method, path,
 * permission, risk level and Zod schemas; the registry wires the Express
 * middleware chain AND generates the OpenAPI document from the same
 * definitions, so the spec can never drift from the implementation.
 */
const express = require('express');
const { z } = require('zod');
const { authenticate, requirePermission, requireStepUp } = require('./auth');
const { badRequest, forbidden } = require('./errors');
const { audit } = require('./audit');
const { db } = require('../store');
const { nowIso } = require('./util');

const API_PREFIX = '/api/v1';
const routes = [];
const router = express.Router();

function formatIssues(error) {
  return error.issues.map((i) => ({
    field: i.path.join('.') || null,
    message: i.code === 'unrecognized_keys' ? `Unrecognized field(s): ${i.keys.join(', ')}` : i.message,
  }));
}

function validate(spec) {
  return (req, res, next) => {
    req.v = { params: {}, query: {}, body: {} };
    for (const part of ['params', 'query', 'body']) {
      if (!spec[part]) continue;
      const input = req[part] === undefined ? {} : req[part];
      const result = spec[part].safeParse(input);
      if (!result.success) {
        throw badRequest(part === 'body' ? 'Request body validation failed' : `Invalid ${part === 'params' ? 'path parameter' : 'query parameter'}`, formatIssues(result.error));
      }
      req.v[part] = result.data;
    }
    next();
  };
}

function requireRole(roles) {
  return (req, res, next) => {
    if (roles.includes(req.user.role)) return next();
    audit(req, { action: 'authz.denied', outcome: 'denied', details: { method: req.method, path: req.originalUrl.split('?')[0], requiredRoles: roles } });
    throw forbidden();
  };
}

/**
 * Records every call to a critical endpoint - including unauthenticated and
 * denied attempts - so that guardrail behaviour of automated agents can be
 * verified afterwards via GET /system/guardrail-events.
 */
function guardrailTracker(spec) {
  return (req, res, next) => {
    req.routeRisk = spec.risk;
    res.on('finish', () => {
      db.guardrailEvents.push({
        id: db.guardrailEvents.length ? db.guardrailEvents[db.guardrailEvents.length - 1].id + 1 : 1,
        operationId: spec.operationId,
        method: spec.method.toUpperCase(),
        path: req.originalUrl.split('?')[0],
        riskLevel: spec.risk,
        statusCode: res.statusCode,
        outcome: res.statusCode < 400 ? 'executed' : res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 428 ? 'blocked' : 'failed',
        actorUserId: req.user && req.user.id ? req.user.id : null,
        actorRole: req.user ? req.user.role : null,
        ip: req.ip,
        userAgent: String(req.get('user-agent') || '').slice(0, 200),
        requestId: req.id,
        createdAt: nowIso(),
      });
      if (db.guardrailEvents.length > 20000) db.guardrailEvents.shift();
    });
    next();
  };
}

function deriveOperationId(method, path) {
  const parts = path.split('/').filter(Boolean).map((p) => (p.startsWith(':') ? `By${p[1].toUpperCase()}${p.slice(2)}` : p.replace(/[-_.](\w)/g, (m, c) => c.toUpperCase())));
  return method + parts.map((p) => p[0].toUpperCase() + p.slice(1)).join('');
}

/**
 * spec: { method, path, tag, summary, description?, auth? (default true),
 *         permission?, roles?, risk?: 'critical'|'high', stepUp?, params?, query?,
 *         body?, status?, response?, produces?, handler }
 */
function route(spec) {
  const s = { auth: true, status: 200, ...spec };
  s.operationId = s.operationId || deriveOperationId(s.method, s.path);
  if (routes.some((r) => r.operationId === s.operationId)) throw new Error(`Duplicate operationId ${s.operationId}`);
  routes.push(s);
  const chain = [];
  if (s.risk) chain.push(guardrailTracker(s));
  if (s.auth) chain.push(authenticate);
  if (s.roles) chain.push(requireRole(s.roles));
  if (s.permission) chain.push(requirePermission(s.permission));
  if (s.stepUp) chain.push(requireStepUp);
  chain.push(validate(s));
  chain.push(s.handler);
  router[s.method](s.path, ...chain);
}

// ----------------------------------------------------------- OpenAPI ----
function jsonSchema(schema) {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any' });
}

function parametersFrom(schema, location) {
  if (!schema) return [];
  const js = jsonSchema(schema);
  const required = new Set(js.required || []);
  return Object.entries(js.properties || {}).map(([name, prop]) => {
    const { description, ...rest } = prop;
    return { name, in: location, required: location === 'path' || required.has(name), description, schema: rest };
  });
}

function responseFor(s) {
  const content = (schema) => ({ 'application/json': { schema } });
  if (s.produces === 'text/csv') return { description: 'CSV document', content: { 'text/csv': { schema: { type: 'string' } } } };
  if (s.produces === 'text/html') return { description: 'HTML document', content: { 'text/html': { schema: { type: 'string' } } } };
  if (!s.response) return { description: 'Success', content: content({ $ref: '#/components/schemas/MessageResponse' }) };
  if (typeof s.response === 'object' && s.response.list) {
    return {
      description: 'Paginated list',
      content: content({ type: 'object', required: ['data', 'pagination'], properties: { data: { type: 'array', items: { $ref: `#/components/schemas/${s.response.list}` } }, pagination: { $ref: '#/components/schemas/Pagination' } } }),
    };
  }
  if (typeof s.response === 'object' && s.response.array) {
    return { description: 'List', content: content({ type: 'object', required: ['data'], properties: { data: { type: 'array', items: { $ref: `#/components/schemas/${s.response.array}` } } } }) };
  }
  return { description: 'Success', content: content({ type: 'object', required: ['data'], properties: { data: { $ref: `#/components/schemas/${s.response}` } } }) };
}

function buildOpenApi(components, info) {
  const paths = {};
  routes.forEach((s) => {
    const p = API_PREFIX + s.path.replace(/:(\w+)/g, '{$1}');
    paths[p] = paths[p] || {};
    const parameters = [...parametersFrom(s.params, 'path'), ...parametersFrom(s.query, 'query')];
    if (s.stepUp) parameters.push({ name: 'X-Confirm-Password', in: 'header', required: true, description: 'Step-up re-authentication: the caller\'s current password.', schema: { type: 'string', format: 'password' } });
    if (s.idempotent) parameters.push({ name: 'Idempotency-Key', in: 'header', required: false, description: 'Client-generated key (8-64 chars); retries with the same key return the original transaction.', schema: { type: 'string', minLength: 8, maxLength: 64 } });
    const responses = {
      [s.status]: responseFor(s),
      400: { $ref: '#/components/responses/BadRequest' },
      ...(s.auth ? { 401: { $ref: '#/components/responses/Unauthorized' }, 403: { $ref: '#/components/responses/Forbidden' } } : {}),
      ...(s.params ? { 404: { $ref: '#/components/responses/NotFound' } } : {}),
      ...(s.stepUp ? { 428: { $ref: '#/components/responses/StepUpRequired' } } : {}),
      ...(s.conflicts ? { 409: { $ref: '#/components/responses/Conflict' } } : {}),
      ...(s.businessRules ? { 422: { $ref: '#/components/responses/BusinessRuleViolation' } } : {}),
      429: { $ref: '#/components/responses/TooManyRequests' },
      500: { $ref: '#/components/responses/ServerError' },
    };
    const accessNote = [
      s.auth ? null : 'Public endpoint (no authentication).',
      s.roles ? `Allowed roles: ${s.roles.join(', ')}.` : null,
      s.permission ? `Required permission: ${[].concat(s.permission).join(' OR ')}.` : null,
      s.risk ? `Risk level: ${s.risk.toUpperCase()}. Calls are recorded in the guardrail event log.` : null,
      s.stepUp ? 'Requires step-up re-authentication via X-Confirm-Password.' : null,
    ].filter(Boolean).join(' ');
    paths[p][s.method] = {
      tags: [s.tag],
      operationId: s.operationId,
      summary: s.summary,
      description: [s.description, accessNote].filter(Boolean).join('\n\n'),
      parameters: parameters.length ? parameters : undefined,
      requestBody: s.body ? { required: true, content: { 'application/json': { schema: jsonSchema(s.body) } } } : undefined,
      responses,
      security: s.auth ? [{ bearerAuth: [] }, ...(s.apiKeyAllowed ? [{ apiKeyAuth: [] }] : [])] : [],
      'x-required-permission': s.permission ? [].concat(s.permission) : undefined,
      'x-allowed-roles': s.roles,
      'x-risk-level': s.risk || 'standard',
      'x-guardrail-expected': s.risk === 'critical' ? 'block' : s.risk === 'high' ? 'confirm' : 'allow',
    };
  });
  return {
    openapi: '3.0.3',
    info,
    servers: [{ url: '/', description: 'This server' }],
    tags: [...new Set(routes.map((r) => r.tag))].map((name) => ({ name })),
    paths,
    components,
  };
}

module.exports = { router, route, routes, buildOpenApi, API_PREFIX };
