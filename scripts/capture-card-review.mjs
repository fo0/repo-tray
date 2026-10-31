import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output =
  process.env.CARD_REVIEW_DIR ?? path.join(root, 'docs/review/card-revision');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 480, height: 760 },
  deviceScaleFactor: 2,
  locale: 'de-DE',
});
const externalRequests = [];
page.on('request', (request) => {
  if (!['localhost', '127.0.0.1'].includes(new URL(request.url()).hostname))
    externalRequests.push(request.url());
});
const shots = [];
async function capture(filename, caption) {
  await page.screenshot({
    path: path.join(output, filename),
    animations: 'disabled',
  });
  const metrics = await page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      header: rect('.app-header'),
      toolbar: rect('.toolbar'),
      tabs: rect('.tabs'),
      content: rect('.content'),
      pinList: rect('.pin-list'),
      cards: [...document.querySelectorAll('.pin-card')].map((card) => ({
        title: card.querySelector('h3').textContent,
        height: card.getBoundingClientRect().height,
        width: card.getBoundingClientRect().width,
        warning: !!card.querySelector('.uncertain-start'),
      })),
      workflowRow: rect('.workflow-item'),
      workflowHeading: rect('.workflow-heading'),
      overflow: document.documentElement.scrollWidth > innerWidth,
      notice: (() => {
        const banner = document.querySelector('.notice-banner');
        if (!banner) return null;
        const center = (node) => {
          const r = node.getBoundingClientRect();
          return r.top + r.height / 2;
        };
        return {
          height: banner.getBoundingClientRect().height,
          center: center(banner),
          textCenter: center(banner.querySelector('span')),
          iconCenter: center(banner.querySelector('svg')),
          closeCenter: center(banner.querySelector('button')),
        };
      })(),
    };
  });
  shots.push({
    filename,
    caption,
    metrics,
    sha256: createHash('sha256')
      .update(await readFile(path.join(output, filename)))
      .digest('hex'),
  });
}
async function openPin(name) {
  await page
    .locator('article.pin-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .getByRole('button', { name: 'Öffnen', exact: true })
    .click();
  return page.getByRole('dialog', { name: 'Workflow starten' });
}
try {
  await page.goto('http://127.0.0.1:1420');
  await expect(
    page.getByRole('status', { name: 'Verbindungsstatus' }),
  ).toContainText('Demo');
  await page.getByLabel('Account auswählen').selectOption('demo-personal');
  await page.getByRole('button', { name: 'Starten', exact: true }).click();
  await capture(
    '04-vorlagen.png',
    'Starten: kompakte Standardvorlage mit Repository, Konto, Ref und Bestätigungsmodus.',
  );
  let dialog = await openPin('Windows build');
  await dialog.getByLabel('Branch oder Tag').selectOption('develop');
  await dialog.getByLabel('Build target').selectOption('linux-x64');
  await dialog.getByLabel('Version', { exact: true }).fill('0.2.0');
  await dialog.getByText('Als Vorlage speichern', { exact: true }).click();
  await dialog.getByLabel('Name der Vorlage').fill('Linux develop');
  await dialog
    .getByRole('button', { name: 'Als neue Vorlage speichern', exact: true })
    .click();
  await expect(
    dialog.getByText('Vorlage lokal gespeichert.', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await capture(
    '07-vorlage-gespeichert.png',
    'Zwei gespeicherte Vorlagen: direkte Aktionen, vollständige Repo-/Kontozuordnung und Branch je Zeile.',
  );
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByLabel('Demo-Szenario').selectOption('uncertain');
  await page.getByRole('button', { name: 'Dialog schließen' }).click();
  dialog = await openPin('Windows build');
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  // Replay the existing demo sign-in solely to reproduce the previous main-view state.
  // No login screen is captured or changed by this card review.
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('button', { name: 'Einrichten', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'GitHub verbinden' });
  await dialog
    .getByRole('button', { name: 'Mit GitHub anmelden', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Bestätigung simulieren' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/Demo-Anmeldung bestätigt/)).toBeVisible();
  await capture(
    '17-automatisch-zur-app.png',
    'Hauptansicht: Warnstatus in der vorhandenen Metazeile, keine zusätzliche Warnzeile; Bestätigungsmeldung vertikal zentriert.',
  );
  await page
    .getByRole('button', { name: 'Start-Status ungeklärt', exact: true })
    .click();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await capture(
    '23-startstatus-hilfe.png',
    'Geöffnete Statushilfe: Grund, unveränderte Startsperre und nächster Schritt; erreichbar per Hover, Fokus und Klick.',
  );
  await page.keyboard.press('Escape');
  dialog = await openPin('Linux develop');
  await dialog.getByText('Als Vorlage speichern', { exact: true }).click();
  await dialog
    .getByLabel('Schnellstart ausdrücklich aktivieren', { exact: false })
    .check();
  await dialog
    .getByRole('button', { name: 'Vorlage aktualisieren', exact: true })
    .click();
  await expect(
    dialog.getByText('Vorlage lokal gespeichert.', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await capture(
    '22-vorlagen-schnellstart.png',
    'Schnellstart-Vorlage: Start, Konfigurieren und Entfernen bleiben unmittelbar erreichbar.',
  );
  if (externalRequests.length) throw new Error('Unexpected external requests');
  const fingerprints = Object.fromEntries(
    await Promise.all(
      ['src/App.svelte', 'src/app.css', 'src/lib/ConnectPanel.svelte'].map(
        async (file) => [
          file,
          createHash('sha256')
            .update(await readFile(path.join(root, file)))
            .digest('hex'),
        ],
      ),
    ),
  );
  await writeFile(
    path.join(output, 'manifest.json'),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        mode: 'browser-demo',
        viewport: { width: 480, height: 760 },
        deviceScaleFactor: 2,
        externalRequests,
        fingerprints,
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
      normalHeight: shots[0].metrics.cards[0].height,
      twoCardList: shots[1].metrics.pinList.height,
      warningHeight: shots[2].metrics.cards[0].height,
      workflowHeight: shots[0].metrics.workflowRow.height,
      headerHeight: shots[0].metrics.header.height,
    }),
  );
} finally {
  await browser.close();
}
