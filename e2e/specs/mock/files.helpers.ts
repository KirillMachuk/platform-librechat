import fs from 'fs';
import path from 'path';
import { expect } from '@playwright/test';
import type { FrameLocator, Locator, Page } from '@playwright/test';
import {
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  messagesView,
  replyPrompt,
  selectMockEndpoint,
  sendMessage,
} from './helpers';

export const FIXTURE_DIR = path.resolve(__dirname, '..', '..', 'fixtures', 'files');

const MIME_BY_EXTENSION: Record<string, string> = {
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  py: 'text/x-python',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xyz: 'application/octet-stream',
  zip: 'application/zip',
};

export type FileFixture = { name: string; mimeType: string; buffer: Buffer };

/** Load a committed fixture from `e2e/fixtures/files` for `setFiles`. */
export function fileFixture(name: string): FileFixture {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const mimeType = MIME_BY_EXTENSION[extension];
  if (!mimeType) {
    throw new Error(`no mime type mapped for fixture "${name}"`);
  }
  return { name, mimeType, buffer: fs.readFileSync(path.join(FIXTURE_DIR, name)) };
}

const composer = (page: Page) =>
  page.locator('form').filter({ has: page.getByRole('textbox', { name: 'Message input' }) });

const isUpload = (response: { url(): string; request(): { method(): string }; status(): number }) =>
  response.url().includes('/api/files') &&
  response.request().method() === 'POST' &&
  response.status() === 200;

export async function attachFixture(page: Page, fixture: FileFixture) {
  const chooserPromise = page.waitForEvent('filechooser');
  await composer(page).getByRole('button', { name: 'Attach Files' }).click();
  const chooser = await chooserPromise;
  const uploaded = page.waitForResponse(isUpload, { timeout: 60000 });
  await chooser.setFiles(fixture);
  expect((await uploaded).ok()).toBeTruthy();
  await expect(composer(page).getByRole('button', { name: fixture.name })).toBeVisible();
}

/** Open a fresh chat, attach the fixture and send it, leaving the chip in the transcript. */
export async function sendWithFixture(page: Page, fixture: FileFixture, label: string) {
  await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
  await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
  await attachFixture(page, fixture);
  const response = await sendMessage(page, replyPrompt(label));
  expect(response.ok()).toBeTruthy();
  await expect(fileChip(page, fixture.name)).toBeVisible({ timeout: 30000 });
}

export const fileChip = (page: Page, filename: string) =>
  messagesView(page).getByRole('button', { name: filename });

export const previewDialog = (page: Page) => page.getByRole('dialog');

/**
 * Office previews render into a sandboxed srcdoc iframe, so assertions about
 * document content go through the frame rather than the dialog body.
 */
export const previewFrame = (page: Page, filename: string): FrameLocator =>
  page.frameLocator(`iframe[title="Preview: ${filename}"]`);

export const previewFrameElement = (page: Page, filename: string): Locator =>
  page.locator(`iframe[title="Preview: ${filename}"]`);

/** Click the chip in the transcript and wait for the preview surface to settle. */
export async function openPreview(page: Page, filename: string) {
  await fileChip(page, filename).click();
  const dialog = previewDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Rendering document, this may take a moment…')).toBeHidden({
    timeout: 60000,
  });
  return dialog;
}

/** Attach, send and open the preview in one step. */
export async function previewFixture(page: Page, name: string, label: string) {
  const fixture = fileFixture(name);
  await sendWithFixture(page, fixture, label);
  return openPreview(page, fixture.name);
}
