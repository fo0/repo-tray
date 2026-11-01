import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const output = new URL('../docs/review/navigation/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 480, height: 760 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  /** @type {string[]} */
  const externalRequests = [];
  page.on('request', (request) => {
    if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      externalRequests.push(request.url());
  });
  await page.goto('http://127.0.0.1:1420/');
  await expect(
    page.getByRole('status', { name: 'Verbindungsstatus' }),
  ).toContainText('Demo');
  await expect(page.getByRole('heading', { name: /RepoTray/ })).toBeVisible();
  const first = page.locator('.repository-card').first();
  await first.locator('.repository-toggle').click();
  const team = page.getByRole('region', {
    name: 'example-org/runner-tools-demo',
    exact: true,
  });
  await team.locator('.repository-toggle').click();
  await expect(
    first.getByRole('button', { name: 'Desktop build starten', exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: new URL('repositories.png', output).pathname });

  await team
    .getByRole('button', {
      name: 'Runner health als Favorit speichern',
      exact: true,
    })
    .click();
  await expect(
    team.getByRole('button', {
      name: 'Runner health aus Favoriten entfernen',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('button', { name: 'Meldung schließen', exact: true })
    .click();
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Runner health', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: new URL('favorites.png', output).pathname });

  await page.getByRole('button', { name: /^Aktivität/ }).click();
  await expect(page.locator('article.run')).toHaveCount(5);
  await expect(
    page.getByRole('button', { name: 'Alle', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: new URL('activity.png', output).pathname });
  if (externalRequests.length)
    throw new Error('Unexpected external requests during demo capture');
  await writeFile(
    new URL('manifest.json', output),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        mode: 'browser-demo',
        viewport: { width: 480, height: 760 },
        deviceScaleFactor: 2,
        images: ['repositories.png', 'favorites.png', 'activity.png'],
        externalRequests,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Captured repository disclosures, saved favorites and activity history from the running app.',
  );
} finally {
  await browser.close();
}
