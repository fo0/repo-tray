import { expect, test } from './support/test';
import { NOW, openNativeActivity, row } from './support/nativeActivity';

// Relative and absolute times are asserted; a fixed zone keeps them stable.
test.use({ timezoneId: 'UTC' });

test('live runs show relative times that tick with one shared minute clock', async ({
  page,
}) => {
  await openNativeActivity(page);
  const running = row(page, 8401);
  const finished = row(page, 8405);
  const time = running.locator('time');
  await expect(time).toHaveText('vor 3 Min.');
  await expect(time).toHaveAttribute(
    'datetime',
    new Date(NOW - 3 * 60_000).toISOString(),
  );
  await expect(time).toHaveAttribute('title', 'Gestartet: 01.11.2026, 08:57');
  await expect(running.locator('.run-duration')).toHaveText('3 min');
  await expect(finished.locator('time')).toHaveText('vor 2 Std.');
  await expect(finished.locator('time')).toHaveAttribute(
    'title',
    'Beendet: 01.11.2026, 07:00',
  );
  await expect(finished.locator('.run-duration')).toHaveText('5:00 min');

  await page.clock.runFor(60_000);
  await expect(time).toHaveText('vor 4 Min.');
  await expect(running.locator('.run-duration')).toHaveText('4 min');
  await expect(
    running.getByRole('button', { name: /· Läuft · gestartet vor 4 Min\.$/ }),
  ).toBeVisible();
  await expect(finished.locator('time')).toHaveText('vor 2 Std.');
  await expect(finished.locator('.run-duration')).toHaveText('5:00 min');
});

test('demo runs keep their fixture durations and mark the demo time', async ({
  page,
}) => {
  const demoNow = Date.parse('2026-10-31T10:00:00Z');
  await page.clock.install({ time: demoNow - 5_000 });
  await page.goto('/');
  await page.clock.pauseAt(demoNow);
  await page.getByRole('button', { name: /^Aktivität/ }).click();
  const running = row(page, 8401);
  await expect(running.locator('time')).toHaveText('vor 18 Min.');
  await expect(running.locator('time')).toHaveAttribute(
    'title',
    'Gestartet: 31.10.2026, 09:42 · Demo-Zeit',
  );
  await expect(running.locator('.run-duration')).toHaveText('1 min');
  await page.clock.runFor(60_000);
  await expect(running.locator('time')).toHaveText('vor 19 Min.');
  await expect(running.locator('.run-duration')).toHaveText('1 min');
  await expect(row(page, 8404).locator('time')).toHaveText('vor 25 Min.');
});

test('the native account chip opens the accounts settings', async ({
  page,
}) => {
  await openNativeActivity(page);
  const chip = page.getByRole('button', {
    name: 'Konto: demo-dev · Personal · demo – Einstellungen öffnen',
    exact: true,
  });
  // The chip stays inside the labelled status the account specs read.
  await expect(
    page.getByRole('status', { name: 'Aktives Konto', exact: true }),
  ).toContainText('demo-dev · Personal · demo');
  await chip.click();
  const dialog = page.getByRole('dialog', {
    name: 'Einstellungen',
    exact: true,
  });
  await expect(
    dialog.getByRole('tab', { name: 'Konten', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(chip).toBeFocused();
});

test('a search of only spaces is no search in the activity list', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByLabel('Konto auswählen', { exact: true })
    .selectOption('demo-work');
  await page.getByRole('button', { name: /^Aktivität/ }).click();
  await page.getByRole('button', { name: /^Fehlgeschlagen/ }).click();
  await page.getByLabel('Aktivität durchsuchen').fill('   ');
  await expect(
    page.getByRole('heading', { name: 'Hier ist gerade Ruhe' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Keine passenden Runs' }),
  ).toHaveCount(0);
  await page.getByLabel('Aktivität durchsuchen').fill('unmatched-query');
  await expect(
    page.getByRole('heading', { name: 'Keine passenden Runs' }),
  ).toBeVisible();
});

test('the history note opens on demand from the info button', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Aktivität/ }).click();
  const note = page.getByText('Offene Runs werden automatisch aktualisiert.');
  const info = page.getByRole('button', {
    name: 'Hinweis zum Verlauf',
    exact: true,
  });
  await expect(page.locator('article.run').first()).toBeVisible();
  await expect(note).toBeHidden();
  await expect(info).toHaveAttribute('aria-expanded', 'false');
  await info.focus();
  await page.keyboard.press('Enter');
  await expect(info).toHaveAttribute('aria-expanded', 'true');
  await expect(note).toBeVisible();
  await expect(
    page.getByText('Bis zu 50 abgeschlossene Runs bleiben im Verlauf.'),
  ).toBeVisible();
  await info.click();
  await expect(note).toBeHidden();
});
