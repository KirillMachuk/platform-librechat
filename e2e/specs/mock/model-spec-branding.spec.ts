import { expect, test } from '@playwright/test';
import { LANDING_GREETING, NEW_CHAT_PATH, selectModelSpec } from './helpers';

/** Spec with `showOnLanding: true` and an HTML `description` in e2e/config/librechat.e2e.yaml. */
const BRANDED_SPEC = {
  label: 'E2E Branded',
  descriptionText: 'Branded answers',
  descriptionIcon: '/assets/openai.svg',
};

/** The `softDefault: true` spec does not set `showOnLanding`, so it is unbranded. */
const UNBRANDED_SPEC_LABEL = 'E2E Soft Default';

test.describe('model spec branding on landing', () => {
  /* Ред. 12.08 (владелец): заголовок пустого чата — ВСЕГДА продуктовая строка;
   * ни агент, ни брендированная карточка его не подменяют. Брендинг живёт
   * СТРОКОЙ НИЖЕ: описание карточки с showOnLanding рендерится под приветствием
   * (HTML с иконкой — как и раньше), лейбл в заголовок больше не поднимается. */
  test('branded spec keeps the greeting and renders its description below', async ({ page }) => {
    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectModelSpec(page, BRANDED_SPEC.label);

    const main = page.getByRole('main');
    await expect(main).toContainText(LANDING_GREETING);
    await expect(main).toContainText(BRANDED_SPEC.descriptionText);
    await expect(main.locator(`img[src$="${BRANDED_SPEC.descriptionIcon}"]`)).toBeVisible();

    await expect(main.locator('h1')).not.toContainText(BRANDED_SPEC.label);
  });

  test('unbranded spec keeps the default greeting', async ({ page }) => {
    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectModelSpec(page, UNBRANDED_SPEC_LABEL);

    const main = page.getByRole('main');
    await expect(main).toContainText(LANDING_GREETING);
    await expect(main).not.toContainText(BRANDED_SPEC.label);
  });

  test('branded spec renders its description in the model selector', async ({ page }) => {
    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });

    await page.getByTestId('model-selector-trigger').first().click();
    const option = page.getByRole('option', { name: new RegExp(BRANDED_SPEC.label) });
    await expect(option).toContainText(BRANDED_SPEC.descriptionText);
    await expect(option.locator(`img[src$="${BRANDED_SPEC.descriptionIcon}"]`)).toBeVisible();
  });
});
