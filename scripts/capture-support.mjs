/*
 * Shared helpers of the review capture scripts. They drive the browser demo
 * (`pnpm dev`) on synthetic fixtures only: every capture asserts demo mode
 * and fails on any request that leaves the local dev server. Screenshots land
 * in docs/review/ (gitignored) and are never published.
 */
import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {'dark' | 'light'} Theme */
/** @typedef {'overview' | 'runs' | 'favorites' | 'repos'} PanelPage */

export const root = fileURLToPath(new URL('../', import.meta.url));
export const baseUrl = process.env.REVIEW_BASE_URL ?? 'http://127.0.0.1:1420';
/** Both themes, each reached the way a user gets it: the OS preference. */
/** @type {readonly Theme[]} */
export const THEMES = ['dark', 'light'];

export function launch() {
  return chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
    headless: true,
  });
}

/**
 * A fresh demo panel in its own context (fresh localStorage), with the OS
 * preferring `theme`. Asserts demo mode and the theme before returning.
 * @param {import('@playwright/test').Browser} browser
 * @param {{ theme: Theme; width?: number; height?: number }} options
 */
export async function openDemo(browser, { theme, width = 480, height = 760 }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    locale: 'de-DE',
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  /** @type {string[]} */
  const externalRequests = [];
  page.on('request', (request) => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname))
      externalRequests.push(request.url());
  });
  await page.goto(baseUrl);
  await expectDemo(page);
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    ),
  ).toBe(theme);
  return { context, page, externalRequests };
}

/** The panel runs the browser demo, never a live account. @param {Page} page */
export async function expectDemo(page) {
  await expect(
    page.getByRole('status', { name: 'Verbindungsstatus' }),
  ).toContainText('Demo');
  await expect(
    page.getByRole('button', { name: 'Einstellungen', exact: true }),
  ).toBeEnabled();
}

/** @param {string[]} requests */
export function assertLocalOnly(requests) {
  if (requests.length)
    throw new Error(`Unexpected external network requests: ${requests.length}`);
}

/**
 * Shows a panel page the way a user gets there: back to the overview (a
 * section page's minimize button), then a section's maximize button.
 * @param {Page} page
 * @param {PanelPage} name
 */
export async function openPage(page, name) {
  const tray = page.locator('.tray');
  const current = await tray.getAttribute('data-page');
  if (current === name) return;
  if (current !== 'overview')
    await page
      .locator('.page-header')
      .getByRole('button', { name: / verkleinern$/ })
      .click();
  const maximize = {
    runs: 'Läuft gerade maximieren',
    favorites: 'Favoriten maximieren',
    repos: 'Repositories maximieren',
  };
  if (name !== 'overview')
    await page
      .getByRole('button', { name: maximize[name], exact: true })
      .click();
  await expect(tray).toHaveAttribute('data-page', name);
}

/** The app bar button that opens the account menu. @param {Page} page */
export function accountMenuButton(page) {
  return page.getByRole('button', { name: / – Konto wechseln$/ });
}

/**
 * Picks a demo account in the account menu, e.g. `team-demo`.
 * @param {Page} page
 * @param {string} name
 */
export async function chooseAccount(page, name) {
  await accountMenuButton(page).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

/**
 * Opens the settings dialog on a tab.
 * @param {Page} page
 * @param {'Konten' | 'App' | 'Updates'} tab
 */
export async function openSettings(page, tab = 'Konten') {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Einstellungen' });
  await dialog.getByRole('tab', { name: tab, exact: true }).click();
  return dialog;
}

/**
 * Switches the demo scenario in settings and saves, which closes the dialog.
 * @param {Page} page
 * @param {string} value
 */
export async function scenario(page, value) {
  const dialog = await openSettings(page);
  await dialog.getByLabel('Demo-Szenario').selectOption(value);
  const save = dialog.getByRole('button', { name: 'Speichern', exact: true });
  // The scenario in effect stages nothing; then there is nothing to save.
  if (await save.isEnabled()) await save.click();
  else
    await dialog
      .getByRole('button', { name: 'Abbrechen', exact: true })
      .click();
  await expect(dialog).toHaveCount(0);
}

/**
 * Opens a favorite in the start dialog from the Favoriten page.
 * @param {Page} page
 * @param {string} label
 */
export async function openFavorite(page, label) {
  await openPage(page, 'favorites');
  await page
    .locator('.pin-row')
    .filter({ has: page.locator('.pin-label', { hasText: label }) })
    .locator('.pin-open')
    .click();
  return page.getByRole('dialog', { name: 'Workflow starten' });
}

/** Scrolls a dialog body to its end. @param {import('@playwright/test').Locator} dialog */
export async function scrollToEnd(dialog) {
  await dialog.locator('.modal-body').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
}

/** @param {Uint8Array | string} bytes */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** SHA-256 of a screenshot on disk. @param {string} file */
export async function fileSha256(file) {
  return sha256(await readFile(file));
}

/** Fingerprints of the panel sources a capture reflects. */
export async function sourceFingerprints() {
  const styles = (await readdir(path.join(root, 'src/styles')))
    .filter((file) => file.endsWith('.css'))
    .sort()
    .map((file) => `src/styles/${file}`);
  const files = ['src/App.svelte', ...styles, 'src/lib/ConnectPanel.svelte'];
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        sha256(await readFile(path.join(root, file))),
      ]),
    ),
  );
}
