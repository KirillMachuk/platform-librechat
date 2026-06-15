const { logger, runAsSystem, tenantStorage } = require('@librechat/data-schemas');
const { createTopicClusterer } = require('@librechat/api');

/**
 * AI usage analytics P2 — topic clustering orchestration.
 *
 * Calls the local `topics` service (sovereign: embeds + clusters in-country) and
 * caches the result in Mongo so the admin sees themes without re-running the heavy
 * pass on every screen open. Scheduled like the audit backfill (setInterval +
 * immediate tick), but each tenant runs at most once per window (runIfStale), so a
 * restart never re-clusters. Topic LABELS (anonymized text → LLM) are a later step.
 */

const TOPICS_SERVICE_URL = (process.env.TOPICS_SERVICE_URL || '').replace(/\/$/, '');
const TOPICS_AUTH_TOKEN = process.env.TOPICS_AUTH_TOKEN || '';
const DAY_MS = 24 * 60 * 60 * 1000;

function _int(name, def) {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

const SCHEDULE_MS = _int('TOPICS_SCHEDULE_MS', DAY_MS);
const WINDOW_DAYS = _int('TOPICS_WINDOW_DAYS', 90);
const CLUSTER_TIMEOUT_MS = _int('TOPICS_CLUSTER_TIMEOUT_MS', 10 * 60 * 1000);
const FIRST_TICK_DELAY_MS = _int('TOPICS_FIRST_TICK_DELAY_MS', 30000);

function topicsEnabled() {
  const flag = (process.env.TOPICS_ENABLED || '').toLowerCase();
  if (['false', '0', 'no', 'off'].includes(flag)) {
    return false;
  }
  // Default ON when a service URL is configured (explicit opt-out via TOPICS_ENABLED=false).
  return Boolean(TOPICS_SERVICE_URL);
}

/** POSTs conversations to the topics service /cluster and returns {topics, assignments, stats}. */
async function clusterConversations(conversations) {
  if (!TOPICS_SERVICE_URL) {
    throw new Error('TOPICS_SERVICE_URL is not configured');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLUSTER_TIMEOUT_MS);
  try {
    const res = await fetch(`${TOPICS_SERVICE_URL}/cluster`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(TOPICS_AUTH_TOKEN ? { authorization: `Bearer ${TOPICS_AUTH_TOKEN}` } : {}),
      },
      body: JSON.stringify({ conversations }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`topics service responded ${res.status}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function buildClusterer() {
  const db = require('~/models');
  return createTopicClusterer({
    assembleConversationsForClustering: db.assembleConversationsForClustering,
    clusterConversations,
    createAnalyticsRun: db.createAnalyticsRun,
    saveRunResults: db.saveRunResults,
    completeAnalyticsRun: db.completeAnalyticsRun,
    failAnalyticsRun: db.failAnalyticsRun,
    getLatestAnalyticsRun: db.getLatestAnalyticsRun,
  });
}

/** One scheduler tick: cluster each tenant's recent conversations (if its last run is stale). */
async function runTick() {
  const db = require('~/models');
  const clusterer = buildClusterer();
  await runAsSystem(async () => {
    const tenantIds = await db.getClusteringTenantIds();
    for (const tenantId of tenantIds) {
      const from = new Date(Date.now() - WINDOW_DAYS * DAY_MS);
      const run = () =>
        clusterer
          .runIfStale({ tenantId, from, minIntervalMs: SCHEDULE_MS })
          .catch((err) => logger.error('[topics] tenant clustering run failed:', err));
      // Per-tenant work runs inside the tenant context so reads/writes are scoped.
      if (tenantId) {
        await tenantStorage.run({ tenantId }, run);
      } else {
        await run();
      }
    }
  });
}

/**
 * Starts the periodic topic-clustering schedule. No-op (logs) when no topics
 * service is configured. Defensive: a wiring/run failure is logged, never thrown,
 * and never blocks startup. Returns the interval timer (unref'd) or null.
 */
function startTopicClusterSchedule() {
  if (!topicsEnabled()) {
    logger.info('[topics] clustering schedule disabled (set TOPICS_SERVICE_URL to enable)');
    return null;
  }

  const tick = () => {
    runTick().catch((err) => logger.error('[topics] schedule tick failed:', err));
  };

  // Defer the first run so a heavy clustering pass doesn't block server startup.
  const initial = setTimeout(tick, FIRST_TICK_DELAY_MS);
  if (typeof initial.unref === 'function') {
    initial.unref();
  }
  const timer = setInterval(tick, SCHEDULE_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  logger.info(
    `[topics] clustering schedule started (every ${Math.round(SCHEDULE_MS / 3600000)}h, ` +
      `window ${WINDOW_DAYS}d, service ${TOPICS_SERVICE_URL})`,
  );
  return timer;
}

module.exports = { startTopicClusterSchedule, clusterConversations, runTick };
