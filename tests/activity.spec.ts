import { expect, test } from './support/test';
import { chooseAccount, openPage } from './support/demo';
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
  // An open run counts up since its start; a completed one says when it
  // ended and keeps its duration in the meta line.
  await expect(time).toHaveText('seit 3 min');
  await expect(time).toHaveAttribute(
    'datetime',
    new Date(NOW - 3 * 60_000).toISOString(),
  );
  await expect(time).toHaveAttribute('title', 'Gestartet: 01.11.2026, 08:57');
  await expect(running.locator('.run-duration')).toHaveCount(0);
  await expect(finished.locator('time')).toHaveText('vor 2 Std.');
  await expect(finished.locator('time')).toHaveAttribute(
    'title',
    'Beendet: 01.11.2026, 07:00',
  );
  await expect(finished.locator('.run-duration')).toHaveText('5:00 min');

  await page.clock.runFor(60_000);
  await expect(time).toHaveText('seit 4 min');
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
  await openPage(page, 'runs');
  const running = row(page, 8401);
  const finished = row(page, 8404);
  // The demo's open run keeps its fixture duration instead of counting up.
  await expect(running.locator('time')).toHaveText('seit 1 min');
  await expect(running.locator('time')).toHaveAttribute(
    'title',
    'Gestartet: 31.10.2026, 09:42 · Demo-Zeit',
  );
  await expect(finished.locator('time')).toHaveText('vor 24 Min.');
  await expect(finished.locator('.run-duration')).toHaveText('1:00 min');
  await page.clock.runFor(60_000);
  await expect(running.locator('time')).toHaveText('seit 1 min');
  await expect(finished.locator('time')).toHaveText('vor 25 Min.');
});

test('open runs are listed under „Jetzt“, completed ones under „Abgeschlossen“', async ({
  page,
}) => {
  await page.goto('/');
  await openPage(page, 'runs');
  const heads = page.locator('.page-body .section-header h3');
  const group = (name: string) =>
    page.getByRole('group', { name, exact: true }).getByRole('article');
  await expect(heads).toHaveText(['Jetzt', 'Abgeschlossen']);
  await expect(group('Jetzt')).toHaveCount(3);
  await expect(group('Abgeschlossen')).toHaveCount(2);
  // Each head counts its runs; the unit is for assistive tech.
  const counts = page.locator('.page-body .section-count');
  await expect(counts.locator('[aria-hidden="true"]')).toHaveText(['3', '2']);
  await expect(counts.locator('.sr-only')).toHaveText(['3 Runs', '2 Runs']);
  await expect(
    page.getByRole('heading', { name: 'Letzte Aktivitäten' }),
  ).toHaveCount(0);
  await expect(page.getByText('Zuletzt abgeschlossen')).toHaveCount(0);

  await page.getByRole('button', { name: /^Fehlgeschlagen/ }).click();
  await expect(heads).toHaveText(['Abgeschlossen']);
  await expect(group('Abgeschlossen')).toHaveCount(1);
  await page.getByRole('button', { name: /^Aktiv/ }).click();
  await expect(heads).toHaveText(['Jetzt']);
  await expect(group('Jetzt')).toHaveCount(3);
});

test('the filter chips keep their names and counts; the chosen one is filled', async ({
  page,
}) => {
  await page.goto('/');
  await openPage(page, 'runs');
  const chips = page.getByRole('group', { name: 'Aktivitätsfilter' });
  const all = chips.getByRole('button', { name: 'Alle', exact: true });
  const active = chips.getByRole('button', {
    name: 'Aktiv, 3 Runs',
    exact: true,
  });
  await expect(
    chips.getByRole('button', { name: 'Fehlgeschlagen, 1 Run', exact: true }),
  ).toBeVisible();
  await expect(
    chips.getByRole('button', { name: 'Abgeschlossen', exact: true }),
  ).toBeVisible();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  // Filled with the text colour (#f1f1f4), the others stay outlined.
  await expect(all).toHaveCSS('background-color', 'rgb(241, 241, 244)');
  await expect(active).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(active.locator('b')).toHaveText('3');
  await expect(active.locator('b')).toHaveCSS('font-weight', '700');
  await active.click();
  await expect(active).toHaveAttribute('aria-pressed', 'true');
  await expect(active).toHaveCSS('background-color', 'rgb(241, 241, 244)');
});

test('a row leads with the repository without its owner, which stays in its title and name', async ({
  page,
}) => {
  await page.goto('/');
  await openPage(page, 'runs');
  const run = row(page, 8403);
  // The repository is the bold first line; workflow and run number open
  // the meta line, since every repository may call its workflow „Release“.
  await expect(run.locator('.run-repo')).toHaveText('runner-tools-demo');
  await expect(run.locator('.run-repo')).toHaveAttribute(
    'title',
    'example-org/runner-tools-demo',
  );
  await expect(run.locator('.run-meta > .run-workflow')).toHaveText(
    'Runner health#8403',
  );
  await expect(run.locator('.run-workflow .run-number')).toHaveText('#8403');
  await expect(run.locator('.branch-chip')).toHaveText('main');
  await expect(run.getByRole('button')).toHaveAccessibleName(
    /^example-org\/runner-tools-demo · Runner health #8403 · Wartet · /,
  );
});

test('status text, dot and tile take the colour of the run’s tone', async ({
  page,
}) => {
  await page.goto('/');
  await openPage(page, 'runs');
  // Tokens --run (#6cb6ff) and --fail (#f87171) of the dark theme.
  for (const [id, label, colour] of [
    [8401, 'Läuft', 'rgb(108, 182, 255)'],
    [8404, 'Fehlgeschlagen', 'rgb(248, 113, 113)'],
  ] as const) {
    const status = row(page, id).locator('.run-status');
    await expect(status).toHaveText(label);
    await expect(status).toHaveCSS('color', colour);
    expect(
      await status.evaluate(
        (node) => getComputedStyle(node, '::before').backgroundColor,
      ),
    ).toBe(colour);
    await expect(row(page, id).locator('.status-tile')).toHaveCSS(
      'color',
      colour,
    );
  }
});

test('the running tile turns its spinner unless reduced motion is asked for', async ({
  page,
}) => {
  await page.goto('/');
  await openPage(page, 'runs');
  const tile = row(page, 8401).locator('.status-tile');
  const spinner = tile.locator('.tile-spinner');
  await expect(spinner).toBeVisible();
  await expect(spinner).toHaveCSS('animation-name', 'spin');
  await expect(tile.locator('svg')).toHaveCount(2);
  await expect(tile.locator('svg').nth(1)).toBeHidden();
  // A waiting run has no spinner.
  await expect(row(page, 8403).locator('.tile-spinner')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(spinner).toBeHidden();
  await expect(tile.locator('svg').nth(1)).toBeVisible();
});

test('the native account menu opens the accounts settings', async ({
  page,
}) => {
  await openNativeActivity(page);
  const trigger = page.getByRole('button', {
    name: 'Konto: demo-dev · Personal · demo – Konto wechseln',
    exact: true,
  });
  // The menu button stays inside the labelled status the account specs read.
  await expect(
    page.getByRole('status', { name: 'Aktives Konto', exact: true }),
  ).toContainText('demo-dev · Personal · demo');
  await trigger.click();
  await page
    .getByRole('menuitem', { name: 'Konten verwalten …', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Einstellungen',
    exact: true,
  });
  await expect(
    dialog.getByRole('tab', { name: 'Konten', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('a search of only spaces is no search in the activity list', async ({
  page,
}) => {
  await page.goto('/');
  await chooseAccount(page, 'team-demo');
  await openPage(page, 'runs');
  await page.getByRole('button', { name: /^Fehlgeschlagen/ }).click();
  await page.getByLabel('Verlauf durchsuchen').fill('   ');
  await expect(
    page.getByRole('heading', { name: 'Hier ist gerade Ruhe' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Keine passenden Runs' }),
  ).toHaveCount(0);
  await page.getByLabel('Verlauf durchsuchen').fill('unmatched-query');
  await expect(
    page.getByRole('heading', { name: 'Keine passenden Runs' }),
  ).toBeVisible();
});

test('the history note opens on demand from the info button', async ({
  page,
}) => {
  await page.goto('/');
  await openPage(page, 'runs');
  const note = page.getByText('Offene Runs werden automatisch aktualisiert.');
  const info = page.getByRole('button', {
    name: 'Hinweis zum Verlauf',
    exact: true,
  });
  await expect(page.locator('article.run').first()).toBeVisible();
  // The hint sits in the first group head.
  await expect(
    page
      .locator('.section-header')
      .filter({ has: page.getByRole('heading', { name: 'Jetzt' }) })
      .getByRole('button', { name: 'Hinweis zum Verlauf', exact: true }),
  ).toBeVisible();
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
