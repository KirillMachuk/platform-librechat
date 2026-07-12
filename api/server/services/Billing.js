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
    sendAlert,
    recordAudit,
  });

  const reconciler = createBillingReconciler({
    openrouter,
    getCreditBillingStatus: db.getCreditBillingStatus,
    sumCreditSpendJournal: db.sumCreditSpendJournal,
    poolMicroUsd: config.poolMicroUsd,
    sendAlert,
    recordAudit,
  });

  wiring = { config, openrouter, notifier, reconciler, sendAlert };
  return wiring;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** First reconcile shortly after boot (give Mongo/config time), then daily. */
const FIRST_RECONCILE_DELAY_MS = 10 * 60 * 1000;

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

  try {
    const mongoose = require('mongoose');
    Promise.all(
      ['CreditMonth', 'CreditPackage', 'CreditSpend'].map((name) =>
        mongoose.models[name]?.syncIndexes(),
      ),
    ).catch((err) => logger.warn('[billing] credit index sync failed:', err));
  } catch (err) {
    logger.warn('[billing] credit index sync failed:', err);
  }

  if (!config.enabled) {
    logger.warn(
      '[billing] BILLING_INTERNAL_TOKEN is not set — ingest/status endpoints are disabled, Кредиты не считаются',
    );
  } else {
    logger.info(
      `[billing] enabled: pool=${config.poolCredits} credits/month, operators=${config.operatorEmails.length}, openrouter mgmt=${billing.openrouter.isConfigured ? 'on' : 'off'}`,
    );
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

module.exports = { getBillingWiring, startBillingSchedule };
