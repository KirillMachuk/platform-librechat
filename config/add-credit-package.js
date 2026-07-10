const path = require('path');
const { randomUUID } = require('node:crypto');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const {
  readBillingConfig,
  createOpenRouterManagement,
  CREDIT_PACKAGE_SIZES,
} = require('@librechat/api');
const { microUsdToCredits, MICRO_USD_PER_USD } = require('@librechat/data-schemas');
const { askQuestion, silentExit } = require('./helpers');
const connect = require('./connect');

/**
 * Ручное начисление пакета Кредитов оператором (пока/вместо UI «Начислить пакет»).
 * Гарантии те же, что у admin-эндпоинта: допустимые размеры, идемпотентность по
 * ключу (повторный запуск с тем же --key НЕ задваивает), запись в auditLog
 * (billing.package_added), рекомендация/автоподнятие лимита ключа OpenRouter.
 *
 * Использование:
 *   npm run add-credit-package -- <credits> [--comment "Счёт №42"] [--invoice "42"]
 *                                 [--by operator@1ma.ai] [--key <idempotency-key>]
 */
(async () => {
  await connect();
  const db = require('~/models');

  console.purple('--------------------------------');
  console.purple('Начисление пакета Кредитов (1ma)');
  console.purple('--------------------------------');

  const args = process.argv.slice(2);
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    } else {
      positional.push(args[i]);
    }
  }

  let creditsRaw = positional[0] ?? '';
  if (!creditsRaw) {
    console.orange(`Размеры пакетов: ${CREDIT_PACKAGE_SIZES.join(' / ')}`);
    creditsRaw = await askQuestion('Размер пакета (Кредитов): ');
  }
  const credits = Number.parseInt(String(creditsRaw).replace(/\s/g, ''), 10);
  if (!CREDIT_PACKAGE_SIZES.includes(credits)) {
    console.red(`Ошибка: размер пакета должен быть одним из: ${CREDIT_PACKAGE_SIZES.join(', ')}`);
    silentExit(1);
  }

  let comment = flags.comment ?? '';
  if (!comment) {
    comment = await askQuestion('Комментарий / № счёта (для актов): ');
  }
  const invoiceRef = flags.invoice ?? '';
  const addedByEmail = flags.by ?? 'cli';
  const idempotencyKey = flags.key ?? randomUUID();

  const result = await db.addCreditPackage({
    credits,
    comment: comment || undefined,
    invoiceRef: invoiceRef || undefined,
    addedByEmail,
    idempotencyKey,
  });

  if (result.created) {
    await db.recordAuditLog({
      actorEmail: addedByEmail,
      actorRole: 'OPERATOR_CLI',
      action: 'billing.package_added',
      targetType: 'billing',
      targetId: String(result.package._id),
      metadata: { credits, comment: comment || '', invoiceRef: invoiceRef || '', idempotencyKey },
    });
    console.green(`Начислен пакет ${credits.toLocaleString('ru-RU')} Кредитов.`);
    console.purple(`Ключ идемпотентности: ${idempotencyKey}`);
    console.purple('(повторный запуск с тем же --key ничего не задвоит)');
  } else {
    console.orange('Пакет с этим ключом идемпотентности уже начислён ранее — ничего не изменено.');
  }

  const config = readBillingConfig();
  const status = await db.getCreditBillingStatus({ poolMicroUsd: config.poolMicroUsd });
  const packageRemaining = Math.max(0, microUsdToCredits(status.packageRemainingMicroUsd));
  console.purple('--------------------------------');
  console.purple(
    `Месяц ${status.month}: израсходовано ${microUsdToCredits(status.spentMicroUsd).toLocaleString('ru-RU')} из ${microUsdToCredits(status.poolMicroUsd).toLocaleString('ru-RU')} Кредитов пула`,
  );
  console.purple(`Остаток пакетов: ${packageRemaining.toLocaleString('ru-RU')} Кредитов`);
  console.purple(`Мягкая блокировка: ${status.blocked ? 'АКТИВНА' : 'нет'}`);

  /* Жёсткий предохранитель: лимит ключа OpenRouter = (пул + остаток пакетов) + headroom. */
  const allowedMicroUsd = config.poolMicroUsd + Math.max(0, status.packageRemainingMicroUsd);
  const recommendedLimitUsd = Math.ceil(
    (allowedMicroUsd / MICRO_USD_PER_USD) * (1 + config.openrouter.headroom),
  );
  const openrouter = createOpenRouterManagement(config.openrouter);
  if (result.created && openrouter.isConfigured) {
    try {
      await openrouter.updateLimit(recommendedLimitUsd);
      await db.recordAuditLog({
        actorEmail: addedByEmail,
        actorRole: 'OPERATOR_CLI',
        action: 'billing.limit_updated',
        targetType: 'billing',
        targetId: 'openrouter-key',
        metadata: { limitUsd: recommendedLimitUsd },
      });
      console.green(`Лимит ключа OpenRouter обновлён: $${recommendedLimitUsd}/мес (авто).`);
    } catch (error) {
      console.red(`Не удалось обновить лимит ключа OpenRouter автоматически: ${error.message}`);
      console.orange(`Установите вручную в дашборде OpenRouter: $${recommendedLimitUsd}/мес.`);
    }
  } else {
    console.orange(
      `Рекомендуемый лимит ключа OpenRouter: $${recommendedLimitUsd}/мес${openrouter.isConfigured ? '' : ' (management API не настроен — ставится вручную в дашборде)'}.`,
    );
  }

  silentExit(0);
})();

process.on('uncaughtException', (err) => {
  console.error('Ошибка:', err);
  process.exit(1);
});
