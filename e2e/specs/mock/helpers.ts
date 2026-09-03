import { expect } from '@playwright/test';
import type { Locator, Page, Response } from '@playwright/test';

/** Substring of the reply emitted by the mock LLM server. */
export const MOCK_REPLY_TEXT = 'E2E mock reply';

/** Custom endpoints defined in e2e/config/librechat.e2e.yaml. */
export const MOCK_ENDPOINTS = [
  { label: 'Mock Provider A', model: 'mock-model-a' },
  { label: 'Mock Provider B', model: 'mock-model-b' },
] as const;

export type MockEndpoint = { label: string; model: string };

export const NEW_CHAT_PATH = '/c/new';

/** One greeting for everyone (owner decision 04.08): no time of day, no name.
 *  `interface.customWelcome` overrides it, and the e2e config does not set one. */
export const LANDING_GREETING = 'Where shall we start?';

type RefreshTokenBody = {
  token?: string;
};

export function isAgentsStream(response: Response) {
  return isAgentGenerationStart(response);
}

export function isAgentGenerationStart(response: Response) {
  const { pathname } = new URL(response.url());
  const isAgentsChat = pathname === '/api/agents/chat' || pathname.startsWith('/api/agents/chat/');
  return (
    response.request().method() === 'POST' &&
    isAgentsChat &&
    !pathname.endsWith('/abort') &&
    response.status() === 200
  );
}

const modelSelectorTrigger = (page: Page) => page.getByTestId('model-selector-trigger').first();

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Open the model selector and choose an endpoint from the "LLM models" tab.
 * Model specs surface their label as the option (e.g. "Mock Provider A"), while
 * added non-spec endpoints surface their model name directly (e.g.
 * "mock-model-c"). Click whichever the endpoint exposes.
 */
export async function selectMockEndpoint(page: Page, endpoint: MockEndpoint) {
  const trigger = modelSelectorTrigger(page);
  /* Choosing what is already chosen is a no-op for the user, but not for this helper: the
   * selected row carries its own marker and stops matching by exact name. A test that opens
   * two chats in a row would fail on the second one. */
  const chosen = (await trigger.textContent()) ?? '';
  if (chosen.includes(endpoint.label) || chosen.includes(endpoint.model)) {
    return;
  }
  await trigger.click();
  const labelOption = page.getByRole('option', { name: endpoint.label, exact: true });
  const modelOption = page.getByRole('option', { name: endpoint.model, exact: true });
  await expect(labelOption.or(modelOption).first()).toBeVisible({ timeout: 10000 });
  if (await labelOption.isVisible().catch(() => false)) {
    await labelOption.click();
    if (await modelOption.isVisible({ timeout: 1000 }).catch(() => false)) {
      await modelOption.click();
    }
  } else {
    await modelOption.click();
  }
  // Имя кнопки — это выбранная модель; до выбора текста нет вовсе.
  await expect(trigger).not.toHaveText('');
}

/** Open the model selector and choose a configured model spec by label. */
export async function selectModelSpec(page: Page, label: string) {
  const trigger = modelSelectorTrigger(page);
  await expect(trigger).toBeVisible();
  if ((await trigger.textContent())?.includes(label)) {
    return;
  }
  await trigger.click();
  await page.getByRole('option', { name: new RegExp(`(^|\\s)${escapeRegExp(label)}\\b`) }).click();
  await expect(trigger).toContainText(label);
}

/** Enable the ephemeral Skills capability from the composer tool menu. */
export async function enableSkills(page: Page) {
  await page.getByRole('button', { name: 'Tools Options' }).click();
  await page.getByTestId('tools-menu-skills').click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Skills' })).toBeVisible();
}

/**
 * Open the account menu, once the thing it hangs off has stopped moving.
 *
 * The sidebar animates its width for 300ms on load, and a menu anchored inside
 * it moves with it. Playwright refuses to click an element whose box is still
 * changing, so a click issued during that window retries until the test times
 * out — measured at two failures in fifteen runs of two-factor.spec.ts, and the
 * same pattern is used by four specs. Waiting for the trigger's box to repeat
 * is a real synchronisation point, not a sleep: it is exactly the moment a
 * person could hit the button too.
 */
async function settle(locator: Locator, page: Page) {
  /* Short, tolerant reads: an element that goes away mid-loop must not hold the
   * whole test hostage — `boundingBox()` on a vanished locator waits out the
   * test timeout otherwise. */
  const box = () => locator.boundingBox({ timeout: 2000 }).catch(() => null);
  /* Width included: the animation this exists for is a WIDTH animation, and
   * comparing only x, y and height let the one dimension that actually moves
   * pass unnoticed — an element sliding open horizontally from a fixed corner
   * changes nothing else. */
  const same = (a: NonNullable<Awaited<ReturnType<typeof box>>>, b: typeof a) =>
    Math.abs(a.x - b.x) < 1 &&
    Math.abs(a.y - b.y) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1;

  let previous = await box();
  let missedInARow = previous ? 0 : 1;
  for (let attempt = 0; attempt < 40; attempt++) {
    /* The wait comes FIRST. Two reads back to back land in the same animation
     * frame, match, and this returned on the very first attempt having waited
     * for nothing at all — measured against a 300ms width transition, nine runs
     * in twelve returned inside 26ms, at under half the final width. A
     * synchronisation point that does not synchronise is worse than a sleep,
     * because it reads like one that does. */
    await page.waitForTimeout(50);
    const current = await box();
    if (previous && current && same(previous, current)) {
      return;
    }
    missedInARow = current ? 0 : missedInARow + 1;
    /* Three tolerant reads with no box at all means the element is not there.
     * Left to run, forty of them at a two-second timeout each burned eighty
     * seconds of the test's budget and then returned as if all was well, so the
     * eventual failure surfaced somewhere unrelated. */
    if (missedInARow >= 3) {
      throw new Error('settle: element has no bounding box after three reads — it is not there');
    }
    previous = current;
  }
}

export async function openAccountMenu(page: Page) {
  const trigger = page.getByTestId('nav-user');
  await expect(trigger).toBeVisible();
  await settle(trigger, page);
  const menu = page.getByRole('menu');
  await trigger.click();
  /* The first interaction after the sidebar mounts is sometimes swallowed — the
   * click lands and no menu appears. That is a real product defect, not a test
   * artefact: a user meets it as "I clicked my avatar and nothing happened". It
   * has a `gap` row of its own in e2e/COVERAGE_MAP.md so this workaround does
   * not stand in for a fix.
   *
   * One retry covers it without hiding a menu that is genuinely broken: the
   * assertion below still has its full timeout, so a menu that never opens
   * still fails. The visibility check is repeated immediately before the second
   * click because the menu is a toggle — if the first click was merely slow
   * rather than swallowed, clicking again would close what just opened. The
   * window between that check and the click is not closable from here; it is
   * narrow enough that the loop below has never been observed to need it. */
  if (!(await menu.isVisible().catch(() => false))) {
    await page.waitForTimeout(300);
    if (!(await menu.isVisible().catch(() => false))) {
      await trigger.click();
    }
  }
  await expect(menu).toBeVisible();
  /* The menu animates in as well, and its items move with it. */
  await settle(menu, page);
  return menu;
}

/** The conversation messages container. */
export const messagesView = (page: Page) => page.getByTestId('messages-view');

/** Build the mock-model reply trigger and its expected rendered text for a label. */
export const replyPrompt = (label: string) => `E2E_REPLY:${label}`;
export const replyText = (label: string) => `E2E reply ${label}`;

/** The mock reply as rendered in the conversation, scoped to the messages view. */
export function mockReply(page: Page) {
  return messagesView(page).getByText(new RegExp(MOCK_REPLY_TEXT, 'i'));
}

/**
 * Type a message, send it, and wait for the streamed `/api/agents` response.
 *
 * The response resolves on the stream's HEADERS, while the turn is still being
 * generated — so a second `sendMessage` straight after the first used to press
 * Enter into a composer that was still busy, which swallows the key (the text
 * stayed in the box, «Send message» came back, nothing was sent, and the wait
 * for a response timed out). Seen twice in a row on message-actions.spec under
 * load. The composer is idle once «Stop generating» is gone, so that is waited
 * for before the key goes down; on a fresh chat the button never existed and
 * the wait is free.
 */
export async function sendMessage(page: Page, text: string): Promise<Response> {
  const input = page.getByRole('textbox', { name: 'Message input' });
  await input.click();
  await input.fill(text);
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({
    timeout: 30000,
  });
  const [response] = await Promise.all([
    page.waitForResponse(isAgentsStream, { timeout: 30000 }),
    input.press('Enter'),
  ]);
  return response;
}

export async function getAccessToken(page: Page): Promise<string> {
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, text, json };
  });

  if (!result.ok) {
    throw new Error(
      `Expected /api/auth/refresh to return 2xx, got ${result.status}: ${result.text}`,
    );
  }

  const body = result.json as RefreshTokenBody | null;
  if (!body?.token) {
    throw new Error(`Expected /api/auth/refresh to return a token, got: ${result.text}`);
  }

  return body.token;
}

export async function requestJson<T>(
  page: Page,
  params: {
    path: string;
    token: string;
    method?: string;
    body?: unknown;
  },
): Promise<T> {
  const result = await page.evaluate(
    async ({ accessToken, body, method, urlPath }) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
      };
      const init: RequestInit = {
        method,
        credentials: 'include',
        headers,
      };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const response = await fetch(urlPath, init);
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { ok: response.ok, status: response.status, text, json };
    },
    {
      accessToken: params.token,
      body: params.body,
      method: params.method ?? 'GET',
      urlPath: params.path,
    },
  );

  if (!result.ok) {
    throw new Error(
      `Expected ${params.method ?? 'GET'} ${params.path} to return 2xx, got ${result.status}: ${result.text}`,
    );
  }
  return result.json as T;
}

export async function fetchJson<T>(page: Page, path: string, token: string): Promise<T> {
  return requestJson<T>(page, { path, token });
}
