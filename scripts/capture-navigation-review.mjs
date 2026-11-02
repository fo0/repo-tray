/*
 * Navigation review: the overview, every maximized page, the picker, the
 * account menu and the settings App tab in both themes at 480×760, plus the
 * overview at the 360×560 minimum. NAVIGATION_REVIEW_DIR and
 * NAVIGATION_REVIEW_PREFIX redirect the files, e.g. into a step folder.
 */
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  THEMES,
  accountMenuButton,
  assertLocalOnly,
  fileSha256,
  launch,
  openDemo,
  openPage,
  openSettings,
  root,
  sourceFingerprints,
} from './capture-support.mjs';

const output =
  process.env.NAVIGATION_REVIEW_DIR ??
  path.join(root, 'docs/review/navigation');
const prefix = process.env.NAVIGATION_REVIEW_PREFIX ?? '';
await mkdir(output, { recursive: true });
const browser = await launch();
/** @type {{ filename: string; theme: string; viewport: string; sha256: string }[]} */
const images = [];
/** @type {string[]} */
const externalRequests = [];
try {
  for (const theme of THEMES) {
    const wide = await openDemo(browser, { theme });
    const { page } = wide;
    /** @param {string} name */
    const capture = async (name) => {
      const filename = `${prefix}${name}-${theme}.png`;
      await page.screenshot({
        path: path.join(output, filename),
        animations: 'disabled',
      });
      images.push({
        filename,
        theme,
        viewport: '480x760',
        sha256: await fileSha256(path.join(output, filename)),
      });
    };

    await expect(page.locator('.repository-card')).toHaveCount(3);
    await capture('overview');

    await openPage(page, 'runs');
    await expect(page.locator('article.run')).toHaveCount(5);
    await page.locator('article.run .run-button').first().click();
    await capture('verlauf');

    await openPage(page, 'favorites');
    await expect(page.locator('.pin-row')).toHaveCount(1);
    await capture('favoriten');

    await openPage(page, 'repos');
    await capture('repositories');

    await openPage(page, 'picker');
    await expect(
      page.getByRole('button', { name: /^Hinzufügen: / }).first(),
    ).toBeVisible();
    await capture('picker');

    await openPage(page, 'overview');
    await accountMenuButton(page).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await capture('kontomenue');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    const settings = await openSettings(page, 'App');
    await expect(
      settings.getByRole('radio', { name: 'System', exact: true }),
    ).toBeChecked();
    await capture('einstellungen-app');
    externalRequests.push(...wide.externalRequests);
    await wide.context.close();

    const narrow = await openDemo(browser, { theme, width: 360, height: 560 });
    const filename = `${prefix}overview-360-${theme}.png`;
    await narrow.page.screenshot({
      path: path.join(output, filename),
      animations: 'disabled',
    });
    images.push({
      filename,
      theme,
      viewport: '360x560',
      sha256: await fileSha256(path.join(output, filename)),
    });
    externalRequests.push(...narrow.externalRequests);
    await narrow.context.close();
  }
  assertLocalOnly(externalRequests);
  await writeFile(
    path.join(output, `${prefix}manifest.json`),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        mode: 'browser-demo',
        deviceScaleFactor: 2,
        themes: THEMES,
        fingerprints: await sourceFingerprints(),
        externalRequests,
        images,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Captured ${images.length} navigation screenshots in both themes. No external requests.`,
  );
} finally {
  await browser.close();
}
