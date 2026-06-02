const { createAuditRecorder, auditRequestContext } = require('@librechat/api');

/**
 * Lazily wires the audit recorder on first use. Kept defensive on purpose:
 * audit is a cross-cutting, fire-and-forget concern and must never break — nor
 * even delay — the action it observes (login, logout, …). If wiring fails it
 * degrades to a no-op.
 */
let cachedRecord;
function getRecord() {
  if (cachedRecord) {
    return cachedRecord;
  }
  try {
    const db = require('~/models');
    cachedRecord = createAuditRecorder({ recordAuditLog: db.recordAuditLog }).recordAudit;
  } catch {
    cachedRecord = () => {};
  }
  return cachedRecord;
}

function recordAudit(event) {
  try {
    getRecord()(event);
  } catch {
    /* never propagate audit failures to the caller */
  }
}

function requestContext(req) {
  return typeof auditRequestContext === 'function' ? auditRequestContext(req) : {};
}

module.exports = { recordAudit, auditRequestContext: requestContext };
