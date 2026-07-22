const { logger } = require('@librechat/data-schemas');
const {
  readBillingConfig,
  createBillingNotifier,
  createBillingReconciler,
  createOpenRouterManagement,
} = require('@librechat/api');
const { recordAudit } = require('~/server/services/Audit');
const { sendEmail } = require('~/server/utils');

/**
 * Billing («Кредиты») wiring: config, operator alerts, OpenRouter management
 * and the ledger reconciler. Built lazily on first use — route modules load
 * before dotenv/mongoose are ready, so nothing here may run at require time.
 */

const SUBJECTS = {
  pool80: (a) => `1ma Кредиты: израсходовано ${a.percentUsed}% месячного пула (${a.month})`,
  exhausted: (a) => `1ma Кредиты: пул и пакеты исчерпаны — модели остановлены (${a.month})`,
  reconcile: (a) => `1ma Кредиты: расхождение с OpenRouter ${a.diffPercent}% (${a.month})`,
};

const TEMPLATES = {
  pool80: 'billingPool80.handlebars',
  exhausted: 'billingExhausted.handlebars',
  reconcile: 'billingReconcile.handlebars',
};

let wiring;

function getBillingWiring() {
  if (wiring) {
    return wiring;
  }

  const config = readBillingConfig();
  const db = require('~/models');
  const openrouter = createOpenRouterManagement(config.openrouter);

  /** Delivers one alert to every operator address; a mail failure only logs. */
  async function sendAlert(alert) {
    if (!config.notifyEmails.length) {
      logger.warn(
        `[billing] alert "${alert.kind}" not emailed — BILLING_NOTIFY_EMAILS/BILLING_OPERATOR_EMAILS empty`,
      );
      return;
    }
    for (const email of config.notifyEmails) {
      try {
        await sendEmail({
          email,
          subject: SUBJECTS[alert.kind](alert),
          payload: { name: email, ...alert },
          template: TEMPLATES[alert.kind],
          throwError: false,
        });
      } catch (error) {
        logger.error(`[billing] failed to email alert "${alert.kind}" to ${email}:`, error);
      }
    }
  }

  const notifier = createBillingNotifier({
    getCreditBillingStatus: db.getCreditBillingStatus,
    markCreditMonthNotified: db.markCreditMonthNotified,
    poolMicroUsd: config.poolMicroUsd,
    anchorDay: config.anchorDay,
    sendAlert,
    recordAudit,
  });

  const reconciler = createBillingReconciler({
    openrouter,
    getCreditBillingStatus: db.getCreditBillingStatus,
    sumCreditSpendJournal: db.sumCreditSpendJournal,
    sumCreditSpendJournalRange: db.sumCreditSpendJournalRange,
    getFirstCreditSpendAt: db.getFirstCreditSpendAt,
    poolMicroUsd: config.poolMicroUsd,
    anchorDay: config.anchorDay,
    headroom: config.openrouter.headroom,
    sendAlert,
    recordAudit,
  });

  wiring = { config, openrouter, notifier, reconciler, sendAlert };
  return wiring;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** First reconcile shortly after boot (give Mongo/config time), then daily. */
const FIRST_RECONCILE_DELAY_MS = 10 * 60 * 1000;
/** Index self-heal cadence — independent of reconciliation, so it runs even without OpenRouter mgmt. */
const INDEX_RESYNC_MS = 6 * 60 * 60 * 1000;

/**
 * Ledger index health. The unique indexes back idempotency (`creditpackages`) and
 * source-dedupe (`creditspends`); if a build fails (e.g. disk pressure, as seen once
 * during deploy) those guarantees silently degrade. We track the state, surface it to
 * the admin «Расходы» screen, and retry on every reconcile tick so a transient failure
 * self-heals.
 */
const creditIndexHealth = { degraded: false, error: null, lastAttempt: null };

/** Live snapshot for the admin summary (read through a getter so retries are visible). */
function getCreditIndexHealth() {
  return creditIndexHealth;
}

/** (Re)builds the ledger's unique indexes; updates {@link creditIndexHealth}. Never throws. */
async function syncCreditIndexes() {
  creditIndexHealth.lastAttempt = new Date();
  try {
    const mongoose = require('mongoose');
    await Promise.all(
      ['CreditMonth', 'CreditPackage', 'CreditSpend'].map((name) =>
        mongoose.models[name]?.syncIndexes(),
      ),
    );
    if (creditIndexHealth.degraded) {
      logger.info('[billing] credit index sync recovered — unique indexes rebuilt');
    }
    creditIndexHealth.degraded = false;
    creditIndexHealth.error = null;
  } catch (err) {
    creditIndexHealth.degraded = true;
    creditIndexHealth.error = err && err.message ? String(err.message) : String(err);
    logger.error(
      '[billing] credit index sync FAILED — idempotency/dedupe guarantees are degraded until it succeeds (retried on the next reconcile tick):',
      err,
    );
  }
}

/**
 * Startup hook: guarantees the ledger's unique indexes (idempotency and
 * source-dedupe live in them, independent of MONGO_AUTO_INDEX) and schedules
 * the daily ledger-vs-OpenRouter reconciliation when the management API is
 * configured. Defensive: failures log, never throw, never block startup.
 */
function startBillingSchedule() {
  let billing;
  try {
    billing = getBillingWiring();
  } catch (err) {
    logger.warn('[billing] wiring failed — billing schedule not started:', err);
    return null;
  }
  const { config, reconciler } = billing;

  // Build the ledger's unique indexes at boot (independent of MONGO_AUTO_INDEX).
  void syncCreditIndexes();

  if (!config.enabled) {
    logger.warn(
      '[billing] BILLING_INTERNAL_TOKEN is not set — ingest/status endpoints are disabled, Кредиты не считаются',
    );
  } else {
    const cycle =
      config.anchorDay === 1
        ? 'calendar month'
        : `rolling «month of service», anchor day ${config.anchorDay}${config.serviceStartDate ? ` (start ${config.serviceStartDate})` : ''}`;
    logger.info(
      `[billing] enabled: pool=${config.poolCredits} credits/period, cycle=${cycle}, operators=${config.operatorEmails.length}, openrouter mgmt=${billing.openrouter.isConfigured ? 'on' : 'off'}`,
    );
    // Loudly flag a set-but-unparseable service start date: it silently fell back to the
    // calendar month (anchor 1), which the operator likely did NOT intend.
    if (
      config.serviceStartDate &&
      config.anchorDay === 1 &&
      !/^\d{4}-\d{1,2}-0*1$/.test(config.serviceStartDate)
    ) {
      logger.warn(
        `[billing] BILLING_SERVICE_START_DATE="${config.serviceStartDate}" did not parse to a valid day-of-month — falling back to calendar-month billing (anchor 1). Expected YYYY-MM-DD.`,
      );
    }
    // Retry the index sync on its OWN cadence — independent of OpenRouter mgmt, so a
    // transient boot-time failure (disk pressure) self-heals even when reconciliation
    // is never scheduled (mgmt off). syncIndexes on a healthy set is a cheap no-op.
    const indexTimer = setInterval(() => {
      void syncCreditIndexes();
    }, INDEX_RESYNC_MS);
    if (typeof indexTimer.unref === 'function') {
      indexTimer.unref();
    }
  }

  if (!billing.openrouter.isConfigured) {
    return null;
  }

  const tick = () => {
    reconciler.run().catch(() => {});
  };
  const first = setTimeout(tick, FIRST_RECONCILE_DELAY_MS);
  if (typeof first.unref === 'function') {
    first.unref();
  }
  const timer = setInterval(tick, DAY_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  logger.info('[billing] daily OpenRouter reconciliation scheduled');
  return timer;
}

module.exports = { getBillingWiring, startBillingSchedule, getCreditIndexHealth };
