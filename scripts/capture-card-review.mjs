/*
 * Favorite row review: the Favoriten page with one and two favorites, an
 * uncertain start with its help, a quick-start favorite and the overview
 * rows, in both themes, with layout metrics per shot. CARD_REVIEW_DIR
 * redirects the files.
 */
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  THEMES,
  assertLocalOnly,
  chooseAccount,
  fileSha256,
  launch,
  openDemo,
  openFavorite,
  openPage,
  root,
  scenario,
  sourceFingerprints,
} from './capture-support.mjs';

const output =
  process.env.CARD_REVIEW_DIR ?? path.join(root, 'docs/review/card-revision');
await mkdir(output, { recursive: true });
const browser = await launch();
/**
 * Manifest entries with the layout each shot measured.
 * @type {{ filename: string; theme: string; caption: string; metrics: ReturnType<typeof measure>; sha256: string }[]}
 */
const shots = [];
/** @type {string[]} */
const externalRequests = [];

/** Layout of the shown panel: bars, favorite rows and the notice. */
function measure() {
  /** @param {string} selector */
  const rect = (selector) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  /** @param {Element | null} node */
  const center = (node) => {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return r.top + r.height / 2;
  };
  const banner = document.querySelector('.notice-banner');
  return {
    appBar: rect('.app-bar'),
    search: rect('.search-field'),
    content: rect('.content'),
    pinList: rect('.pin-rows'),
    cards: [...document.querySelectorAll('.pin-row')].map((card) => ({
      title: card.querySelector('.pin-label')?.textContent ?? '',
      height: card.getBoundingClientRect().height,
      width: card.getBoundingClientRect().width,
      warning: !!card.querySelector('.uncertain-start'),
    })),
    overflow: document.documentElement.scrollWidth > innerWidth,
    notice: banner
      ? {
          height: banner.getBoundingClientRect().height,
          center: center(banner),
          textCenter: center(banner.querySelector('span')),
          iconCenter: center(banner.querySelector('svg')),
          closeCenter: center(banner.querySelector('button')),
        }
      : null,
  };
}

try {
  for (const theme of THEMES) {
    const demo = await openDemo(browser, { theme });
    const { page } = demo;
    /**
     * @param {string} name
     * @param {string} caption
     */
    const capture = async (name, caption) => {
      const filename = `${name}-${theme}.png`;
      await page.screenshot({
        path: path.join(output, filename),
        animations: 'disabled',
      });
      shots.push({
        filename,
        theme,
        caption,
        metrics: await page.evaluate(measure),
        sha256: await fileSha256(path.join(output, filename)),
      });
    };

    await chooseAccount(page, 'demo-dev');
    await openPage(page, 'favorites');
    await capture(
      '04-favoriten',
      'Favoriten: kompakte Zeile mit Repository, Name, Ref, Start und Herz.',
    );

    let dialog = await openFavorite(page, 'Windows build');
    await dialog.getByLabel('Branch oder Tag').selectOption('develop');
    await dialog.getByLabel('Build target').selectOption('linux-x64');
    await dialog.getByLabel('Version', { exact: true }).fill('0.2.0');
    await dialog.getByText('Als Favorit speichern', { exact: true }).click();
    await dialog.getByLabel('Name des Favoriten').fill('Linux develop');
    await dialog
      .getByRole('button', { name: 'Als neuen Favoriten speichern' })
      .click();
    await expect(
      dialog.getByText('„Linux develop“ als Favorit gespeichert.', {
        exact: true,
      }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Abbrechen', exact: true })
      .click();
    await capture(
      '07-favorit-gespeichert',
      'Zwei Favoriten: eine Zeile je Favorit, Repository vorn, Branch und Start rechts.',
    );

    await scenario(page, 'uncertain');
    dialog = await openFavorite(page, 'Windows build');
    await dialog.getByRole('button', { name: 'Start simulieren' }).click();
    await expect(
      dialog.getByText('Startstatus ungeklärt', { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Schließen', exact: true })
      .click();
    await capture(
      '17-ungeklaert',
      'Warnsymbol in der Zeile, keine zusätzliche Warnzeile.',
    );
    await page
      .getByRole('button', {
        name: 'Startstatus ungeklärt: launch-kit-demo · Windows build',
        exact: true,
      })
      .click();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await capture(
      '23-startstatus-hilfe',
      'Geöffnete Statushilfe: Grund, unveränderte Startsperre und nächster Schritt; erreichbar per Hover, Fokus und Klick.',
    );
    await page.keyboard.press('Escape');

    await scenario(page, 'normal');
    dialog = await openFavorite(page, 'Linux develop');
    await dialog.getByText('Als Favorit speichern', { exact: true }).click();
    await dialog
      .getByLabel('Schnellstart aktivieren', { exact: false })
      .check();
    await dialog
      .getByRole('button', { name: 'Favorit aktualisieren', exact: true })
      .click();
    await expect(dialog.getByText(/als Favorit gespeichert/)).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Abbrechen', exact: true })
      .click();
    await capture(
      '22-favoriten-schnellstart',
      'Schnellstart-Favorit: Blitz startet, Zeile öffnet den Dialog, Herz entfernt.',
    );

    await openPage(page, 'overview');
    await expect(page.locator('.pin-row')).not.toHaveCount(0);
    await capture(
      '25-favoriten-zeilen',
      'Übersicht: Favoriten als kompakte Zeilen mit rundem Start und Herz zum Entfernen.',
    );
    externalRequests.push(...demo.externalRequests);
    await demo.context.close();
  }
  assertLocalOnly(externalRequests);
  await writeFile(
    path.join(output, 'manifest.json'),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        mode: 'browser-demo',
        viewport: { width: 480, height: 760 },
        deviceScaleFactor: 2,
        themes: THEMES,
        externalRequests,
        fingerprints: await sourceFingerprints(),
        shots,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      output,
      count: shots.length,
      cardHeights: shots
        .filter((shot) => shot.theme === 'dark')
        .map((shot) => shot.metrics.cards.map((card) => card.height)),
      appBarHeight: shots[0]?.metrics.appBar?.height,
    }),
  );
} finally {
  await browser.close();
}
