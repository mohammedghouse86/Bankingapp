/*
 * In-memory data store backed by data/seed.json.
 *
 * The seed is loaded once and deep-cloned on every reset, so all API writes
 * are ephemeral: restarting the process (or calling POST /api/v1/system/reset)
 * restores the original dataset. Timestamps in the seed are shifted forward so
 * that the data always looks recent relative to the moment it is loaded.
 *
 * Node.js executes each request handler's synchronous section without
 * interleaving, so balance checks and balance updates performed in the same
 * synchronous block are atomic with respect to concurrent requests.
 */
const fs = require('fs');
const config = require('../config');

const db = {};
const counters = {};
let seedText = null;
let loadedAt = null;

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function shiftDates(node, deltaMs) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => {
      if (typeof v === 'string' && ISO_DATETIME.test(v)) node[i] = new Date(Date.parse(v) + deltaMs).toISOString();
      else if (v && typeof v === 'object') shiftDates(v, deltaMs);
    });
    return;
  }
  Object.keys(node).forEach((k) => {
    const v = node[k];
    if (typeof v === 'string' && ISO_DATETIME.test(v)) node[k] = new Date(Date.parse(v) + deltaMs).toISOString();
    else if (v && typeof v === 'object') shiftDates(v, deltaMs);
  });
}

function maxId(list) {
  return list.reduce((m, x) => (typeof x.id === 'number' && x.id > m ? x.id : m), 0);
}

function reset() {
  if (!seedText) seedText = fs.readFileSync(config.seedFile, 'utf8');
  const data = JSON.parse(seedText);
  const delta = Date.now() - Date.parse(data.meta.generatedAt);
  delete data.meta;
  shiftDates(data, delta);

  // Guardrail events deliberately survive resets: a reset is itself a
  // critical action whose record must not erase itself.
  const guardrailEvents = db.guardrailEvents || [];
  Object.keys(db).forEach((k) => delete db[k]);
  Object.assign(db, data, { sessions: [], passwordResetTokens: [], guardrailEvents });

  Object.keys(counters).forEach((k) => delete counters[k]);
  Object.entries(db).forEach(([k, v]) => {
    if (Array.isArray(v)) counters[k] = maxId(v);
  });
  counters.ipAllowlist = maxId(db.network.ipAllowlist);
  loadedAt = new Date().toISOString();
}

function nextId(collection) {
  counters[collection] = (counters[collection] || 0) + 1;
  return counters[collection];
}

function findById(collection, id) {
  return db[collection].find((x) => x.id === id) || null;
}

function stats() {
  return {
    loadedAt,
    collections: Object.fromEntries(Object.entries(db).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])),
  };
}

module.exports = { db, reset, nextId, findById, stats };
