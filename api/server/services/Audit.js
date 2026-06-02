const { logger } = require('@librechat/data-schemas');
const {
  createAuditRecorder,
  createAuditBackfiller,
  auditRequestContext,
} = require('@librechat/api');

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

const HOUR_MS = 60 * 60 * 1000;
/** Trailing window each tick scans. Wider than the interval to avoid gaps; dedupe is by sourceId. */
const BACKFILL_LOOKBACK_MS = 2 * HOUR_MS;

/**
 * Starts the hourly incremental audit backfill so the activity feed (token
 * usage + agent interactions) stays current without a manual "sync". Each tick
 * only scans the trailing window, so cost stays flat as data grows. Defensive:
 * a wiring/run failure is logged, never thrown, and never blocks startup.
 * Returns the timer (unref'd) or null if it could not be started.
 */
function startAuditBackfillSchedule() {
  let backfiller;
  try {
    const db = require('~/models');
    backfiller = createAuditBackfiller({
      backfillAuditFromTransactions: db.backfillAuditFromTransactions,
      backfillAgentInvokes: db.backfillAgentInvokes,
    });
  } catch (err) {
    logger.warn('[audit] backfill schedule not started:', err);
    return null;
  }

  const tick = () => {
    backfiller.runBackfill({ now: Date.now(), lookbackMs: BACKFILL_LOOKBACK_MS }).catch(() => {});
  };

  const timer = setInterval(tick, HOUR_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  tick();
  logger.info('[audit] hourly backfill schedule started');
  return timer;
}

module.exports = { recordAudit, auditRequestContext: requestContext, startAuditBackfillSchedule };
