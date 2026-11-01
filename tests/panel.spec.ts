import { expect, test, type Page } from '@playwright/test';

async function openLaunch(page: Page) {
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  await page.getByRole('button', { name: 'Neu konfigurieren' }).click();
  return page.getByRole('dialog', { name: 'Workflow starten' });
}

async function scenario(page: Page, value: string) {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByLabel('Demo-Szenario').selectOption(value);
  await page.getByRole('button', { name: 'Dialog schließen' }).click();
}

async function uncertainTemplate(page: Page, quickStart = false) {
  await page.getByLabel('Account auswählen').selectOption('demo-personal');
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  const card = page.locator('article.pin-card').filter({
    has: page.getByRole('heading', { name: 'Windows build', exact: true }),
  });
  if (quickStart) {
    await card.getByRole('button', { name: 'Öffnen', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
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
    await dialog
      .getByRole('button', { name: 'Abbrechen', exact: true })
      .click();
  }
  await scenario(page, 'uncertain');
  await card
    .getByRole('button', {
      name: quickStart ? 'Vorlage Windows build konfigurieren' : 'Öffnen',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await dialog
    .getByRole('button', { name: 'Start simulieren', exact: true })
    .click();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  return card;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /RepoTray/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Einstellungen', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: /^Aktivität/ }).click();
});

test('account and owner context, filters and search stay isolated', async ({
  page,
}) => {
  await expect(
    page.getByText('demo-dev/launch-kit-demo', { exact: true }).first(),
  ).toBeVisible();
  await page.getByLabel('Account auswählen').selectOption('demo-work');
  await expect(
    page.getByText('example-org/runner-tools-demo', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText('demo-dev/launch-kit-demo', { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Aktivität durchsuchen').fill('unmatched-query');
  await expect(
    page.getByRole('heading', { name: 'Hier ist gerade Ruhe' }),
  ).toBeVisible();
  await page.getByLabel('Account auswählen').selectOption('demo-personal');
  await page.getByRole('button', { name: /^Fehlgeschlagen/ }).click();
  await expect(
    page.getByText('demo-dev/website-demo', { exact: true }).first(),
  ).toBeVisible();
});

test('closing the launch dialog and cancelling connection create no runs', async ({
  page,
}) => {
  const dialog = await openLaunch(page);
  await expect(dialog.getByLabel('Version')).toHaveValue('0.1.0');
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.getByRole('button', { name: /^Aktivität/ }).click();
  await expect(page.getByText(/9001/)).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('button', { name: 'Einrichten' }).click();
  await expect(
    page.getByRole('button', {
      name: 'Mit GitHub anmelden',
    }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('double-click accepts exactly one simulated run and cannot submit twice', async ({
  page,
}) => {
  const dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).dblclick();
  await expect(
    dialog.getByText('Simulierter Start angenommen', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
  await expect(dialog.getByText(/Demo-Run #9001/)).toBeVisible();
  await expect(page.getByText(/9002/)).toHaveCount(0);
});

test('offline and forbidden scenarios disable starts while showing cached activity', async ({
  page,
}) => {
  for (const value of ['offline', 'forbidden']) {
    await scenario(page, value);
    const dialog = await openLaunch(page);
    await expect(
      dialog.getByRole('button', { name: 'Start simulieren' }),
    ).toBeDisabled();
    await dialog
      .getByRole('button', { name: 'Abbrechen', exact: true })
      .click();
    await page.getByRole('button', { name: /^Aktivität/ }).click();
    await expect(
      page.getByText('demo-dev/launch-kit-demo', { exact: true }).first(),
    ).toBeVisible();
  }
});

test('unknown response remains quarantined when the form is reopened', async ({
  page,
}) => {
  await scenario(page, 'uncertain');
  let dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.getByRole('button', { name: 'Neu konfigurieren' }).click();
  dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Status prüfen', exact: true })
    .click();
  await expect(
    dialog.getByText(/Status geprüft. Die Startannahme bleibt ungeklärt/),
  ).toBeVisible();
});

test('pins persist and keep quick launch disabled until explicitly enabled', async ({
  page,
}) => {
  let dialog = await openLaunch(page);
  await dialog.getByText('Als Vorlage speichern', { exact: true }).click();
  await dialog.getByLabel('Name der Vorlage').fill('My saved build');
  await dialog
    .getByRole('button', { name: 'Vorlage speichern', exact: true })
    .click();
  await expect(
    dialog.getByText('Vorlage lokal gespeichert.', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'My saved build' }) });
  await expect(
    card.getByText('Mit Bestätigung', { exact: false }),
  ).toBeVisible();
  await card.getByRole('button', { name: 'Öffnen' }).click();
  dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await expect(dialog.getByLabel('Branch oder Tag')).toHaveValue('main');
  await expect(dialog.getByLabel('Version')).toHaveValue('0.1.0');
});

test('a late start response cannot overwrite a newly chosen repository form', async ({
  page,
}) => {
  let dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await dialog.getByRole('button', { name: 'Dialog schließen' }).click();
  await page.getByLabel('Account auswählen').selectOption('demo-work');
  await page.getByRole('button', { name: 'Neu konfigurieren' }).click();
  dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await expect(dialog.getByLabel('Repository')).toHaveValue('demo-team-tools');
  await expect(dialog.getByLabel('Attempts')).toHaveValue('3');
  await expect(dialog.getByLabel('Version')).toHaveCount(0);
  await expect(
    dialog.getByText('Simulierter Start angenommen', { exact: true }),
  ).toHaveCount(0);
});

test('explicitly enabled quick launch dispatches from a saved template', async ({
  page,
}) => {
  const dialog = await openLaunch(page);
  await dialog.getByText('Als Vorlage speichern', { exact: true }).click();
  await dialog.getByLabel('Name der Vorlage').fill('Quick build');
  await dialog
    .getByLabel('Schnellstart ausdrücklich aktivieren', { exact: false })
    .check();
  await dialog
    .getByRole('button', { name: 'Vorlage speichern', exact: true })
    .click();
  await expect(
    dialog.getByText('Vorlage lokal gespeichert.', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Quick build' }) });
  await card.getByRole('button', { name: 'Schnellstart', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/Demo-Run #9001/)).toBeVisible();
});

test('Enter in a template name saves it without starting a run', async ({
  page,
}) => {
  const dialog = await openLaunch(page);
  await dialog.getByText('Als Vorlage speichern', { exact: true }).click();
  await dialog.getByLabel('Name der Vorlage').fill('Saved with Enter');
  await dialog.getByLabel('Name der Vorlage').press('Enter');
  await expect(
    dialog.getByText('Vorlage lokal gespeichert.', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText('Simulierter Start angenommen', { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.getByRole('button', { name: /^Aktivität/ }).click();
  await expect(page.getByText(/9001/)).toHaveCount(0);
});

test('saving is blocked during dispatch and the result still appears', async ({
  page,
}) => {
  const dialog = await openLaunch(page);
  await dialog.getByText('Als Vorlage speichern', { exact: true }).click();
  await dialog
    .getByLabel('Name der Vorlage')
    .fill('Do not save during dispatch');
  const blocked = await dialog.evaluate(async (node) => {
    const buttons = [...node.querySelectorAll('button')];
    const start = buttons.find((button) =>
      button.textContent?.includes('Start simulieren'),
    )!;
    const save = buttons.find((button) =>
      button.textContent?.includes('Vorlage speichern'),
    )!;
    start.click();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const disabled = save.disabled;
    save.click();
    return disabled;
  });
  expect(blocked).toBe(true);
  await expect(
    dialog.getByText('Simulierter Start angenommen', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText('Vorlage lokal gespeichert.', { exact: true }),
  ).toHaveCount(0);
});

test('offline still allows opening and editing a saved template', async ({
  page,
}) => {
  await scenario(page, 'offline');
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Windows build' }) });
  await expect(card.getByRole('button', { name: 'Öffnen' })).toBeEnabled();
  await card.getByRole('button', { name: 'Öffnen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await expect(dialog.getByLabel('Version')).toBeEnabled();
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
});

test('an empty launch search hides empty groups and offers a clear action', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  await page.getByLabel('Workflows durchsuchen').fill('unmatched-query');
  const state = page.locator('.empty-state').filter({
    has: page.getByRole('heading', {
      name: 'Keine passenden Vorlagen oder Workflows',
    }),
  });
  await expect(state).toBeVisible();
  await expect(page.locator('.repo-group')).toHaveCount(0);
  await state.getByRole('button', { name: 'Suche leeren' }).click();
  await expect(
    page.getByRole('heading', { name: 'Windows build' }),
  ).toBeVisible();
});

test('an offline status check never claims a successful refresh of an uncertain start', async ({
  page,
}) => {
  await scenario(page, 'uncertain');
  let dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await scenario(page, 'offline');
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Windows build' }) });
  await card.getByRole('button', { name: 'Öffnen' }).click();
  dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await dialog
    .getByRole('button', { name: 'Status prüfen', exact: true })
    .click();
  await expect(
    dialog.getByText(
      'Status konnte nicht geprüft werden. Starts bleiben gesperrt.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    dialog.getByText(/Status geprüft\. Die Startannahme/),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
});

test('copying an existing template keeps the original and its values', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  const original = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Windows build' }) });
  await original.getByRole('button', { name: 'Öffnen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await dialog.getByLabel('Branch oder Tag').selectOption('develop');
  await dialog.getByText('Als Vorlage speichern', { exact: true }).click();
  await dialog.getByLabel('Name der Vorlage').fill('Develop copy');
  await expect(
    dialog.getByRole('button', { name: 'Vorlage aktualisieren', exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Als neue Vorlage speichern', exact: true })
    .click();
  await expect(
    dialog.getByText('Vorlage lokal gespeichert.', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Develop copy', exact: true }),
  ).toBeVisible();
  await original.getByRole('button', { name: 'Öffnen' }).click();
  await expect(
    page.getByRole('dialog').getByLabel('Branch oder Tag'),
  ).toHaveValue('main');
});

async function openConnection(page: Page) {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('button', { name: 'Einrichten', exact: true }).click();
  return page.getByRole('dialog', { name: 'GitHub verbinden' });
}

test('browser sign-in preview is explicitly paused and offers token entry', async ({
  page,
}) => {
  const dialog = await openConnection(page);
  await expect(
    dialog.getByRole('button', { name: /Mit GitHub anmelden/ }),
  ).toBeDisabled();
  await expect(
    dialog.getByText(
      /Browser-Anmeldung \/ GitHub App ist vorübergehend deaktiviert/,
    ),
  ).toBeVisible();
  await dialog
    .getByText('Alternativ: Token hinterlegen', { exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Token prüfen und verbinden' }),
  ).toBeDisabled();
  expect(page.context().pages()).toHaveLength(1);
});

test('cancelling a pending token preview invalidates its late confirmation', async ({
  page,
}) => {
  await page.clock.install();
  const dialog = await openConnection(page);
  await dialog
    .getByText('Alternativ: Token hinterlegen', { exact: true })
    .click();
  await dialog.getByLabel('Beispiel-Token').fill('demo-token');
  await dialog
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await dialog.getByRole('button', { name: 'Anmeldung abbrechen' }).click();
  await page.clock.fastForward(1000);
  await expect(
    dialog.getByRole('heading', { name: 'Anmeldung abgebrochen' }),
  ).toBeVisible();
  await expect(page.getByText(/Demo-Token geprüft und verworfen/)).toHaveCount(
    0,
  );
});

test('token preview clears its masked input and never persists user input', async ({
  page,
}) => {
  const dialog = await openConnection(page);
  await dialog
    .getByText('Alternativ: Token hinterlegen', { exact: true })
    .click();
  const input = dialog.getByLabel('Beispiel-Token');
  await input.fill('not-a-real-token-example');
  await dialog
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await expect(input).toHaveValue('');
  await expect(dialog.getByRole('alert')).toContainText(
    'nur der Beispielwert demo-token',
  );
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...localStorage }),
  );
  expect(storage).not.toContain('not-a-real-token-example');
  await input.fill('demo-token');
  await dialog
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText(/Demo-Token geprüft und verworfen/),
  ).toBeVisible();
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage })),
  ).not.toContain('demo-token');
});

for (const width of [360, 480]) {
  test(`compact panel preserves readable text and click targets at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 760 });
    const geometry = await page.evaluate(() => {
      const header = document
        .querySelector('.app-header')!
        .getBoundingClientRect();
      const status = document
        .querySelector('.connection')!
        .getBoundingClientRect();
      const run = document
        .querySelector('.run-button')!
        .getBoundingClientRect();
      return {
        headerHeight: header.height,
        statusInside:
          status.top >= header.top && status.bottom <= header.bottom,
        rowHeight: run.height,
        runFont: parseFloat(
          getComputedStyle(document.querySelector('.run-name')!).fontSize,
        ),
        minIconTarget: Math.min(
          ...[...document.querySelectorAll('.icon-button')].map((button) =>
            Math.min(
              button.getBoundingClientRect().width,
              button.getBoundingClientRect().height,
            ),
          ),
        ),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(geometry.headerHeight).toBeLessThanOrEqual(56);
    expect(geometry.statusInside).toBe(true);
    expect(geometry.rowHeight).toBeLessThanOrEqual(79);
    expect(geometry.runFont).toBeGreaterThanOrEqual(12);
    expect(geometry.minIconTarget).toBeGreaterThanOrEqual(24);
    expect(geometry.overflow).toBe(false);
    const dialog = await openLaunch(page);
    const fieldHeight = await dialog
      .getByLabel('Version')
      .evaluate((input) => input.getBoundingClientRect().height);
    expect(fieldHeight).toBeGreaterThanOrEqual(34);
    await expect(
      dialog.getByRole('button', { name: 'Start simulieren' }),
    ).toBeVisible();
  });
}

test('compact saved templates keep quick-start configuration and removal reachable', async ({
  page,
}) => {
  const dialog = await openLaunch(page);
  await dialog.getByText('Als Vorlage speichern', { exact: true }).click();
  await dialog.getByLabel('Name der Vorlage').fill('Compact quick build');
  await dialog
    .getByLabel('Schnellstart ausdrücklich aktivieren', { exact: false })
    .check();
  await dialog
    .getByRole('button', { name: 'Vorlage speichern', exact: true })
    .click();
  await expect(
    dialog.getByText('Vorlage lokal gespeichert.', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  const card = page.locator('article.pin-card').filter({
    has: page.getByRole('heading', {
      name: 'Compact quick build',
      exact: true,
    }),
  });
  await expect(
    card.getByText('Schnellstart aktiv', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole('button', { name: 'Schnellstart', exact: true }),
  ).toBeVisible();
  await card
    .getByRole('button', {
      name: 'Vorlage Compact quick build konfigurieren',
      exact: true,
    })
    .click();
  await expect(page.getByRole('dialog').getByLabel('Version')).toHaveValue(
    '0.1.0',
  );
  await expect(page.getByText(/9001/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await card
    .getByRole('button', {
      name: 'Vorlage Compact quick build entfernen',
      exact: true,
    })
    .click();
  await expect(card).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Windows build', exact: true }),
  ).toBeVisible();
});

test('compact cards preserve long labels, account context and click targets at 360px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await page.getByLabel('Account auswählen').selectOption('demo-work');
  const dialog = await openLaunch(page);
  const label =
    'Nightly runner health checks for the shared maintenance environment';
  await dialog.getByText('Als Vorlage speichern', { exact: true }).click();
  await dialog.getByLabel('Name der Vorlage').fill(label);
  await dialog
    .getByLabel('Schnellstart ausdrücklich aktivieren', { exact: false })
    .check();
  await dialog
    .getByRole('button', { name: 'Vorlage speichern', exact: true })
    .click();
  await expect(
    dialog.getByText('Vorlage lokal gespeichert.', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  const card = page
    .locator('article.pin-card')
    .filter({ has: page.getByRole('heading', { name: label, exact: true }) });
  await expect(card).toContainText('example-org/runner-tools-demo');
  await expect(card).toContainText('team-demo');
  await expect(card.getByText('main', { exact: true })).toBeVisible();
  const sizes = await card.evaluate((element) => {
    const cardBounds = element.getBoundingClientRect();
    return {
      overflow: element.scrollWidth > element.clientWidth,
      font: parseFloat(getComputedStyle(element.querySelector('h3')!).fontSize),
      targets: [...element.querySelectorAll('button')].map((button) => {
        const r = button.getBoundingClientRect();
        return {
          width: r.width,
          height: r.height,
          inside: r.left >= cardBounds.left && r.right <= cardBounds.right,
        };
      }),
    };
  });
  expect(sizes.overflow).toBe(false);
  expect(sizes.font).toBeGreaterThanOrEqual(12);
  for (const target of sizes.targets) {
    expect(target.width).toBeGreaterThanOrEqual(24);
    expect(target.height).toBeGreaterThanOrEqual(24);
    expect(target.inside).toBe(true);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

for (const width of [360, 480]) {
  test(`uncertain status uses the existing row with hover and keyboard help at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 760 });
    const card = await uncertainTemplate(page);
    const status = card.getByRole('button', {
      name: 'Start-Status ungeklärt',
      exact: true,
    });
    const tooltip = page.getByRole('tooltip');
    const height = (await card.boundingBox())!.height;
    expect(height).toBe(62);
    await expect(status).toBeVisible();
    expect((await status.boundingBox())!.height).toBeGreaterThanOrEqual(24);
    await expect(tooltip).toHaveCount(0);
    await status.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(
      'Ein erneuter Start für dieses Ziel bleibt gesperrt.',
    );
    const bounds = (await tooltip.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(12);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 12);
    expect(bounds.y).toBeGreaterThanOrEqual(12);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(748);
    expect((await card.boundingBox())!.height).toBe(height);
    await tooltip.hover();
    await expect(tooltip).toBeVisible();
    await page.getByRole('heading', { name: /^RepoTray/ }).hover();
    await expect(tooltip).toHaveCount(0);
    await status.focus();
    await expect(tooltip).toBeVisible();
    await expect(status).toHaveAccessibleDescription(
      /erneuter Start.*gesperrt/,
    );
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await expect(status).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      card.getByRole('button', { name: 'Öffnen', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
    await expect(
      dialog.getByRole('button', { name: 'Start simulieren' }),
    ).toBeDisabled();
    await expect(
      dialog.getByText('Startstatus ungeklärt', { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  });
}

test('touch can open and dismiss uncertain-start help without enabling quick start', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    viewport: { width: 360, height: 760 },
  });
  const page = await context.newPage();
  try {
    await page.goto('/');
    const card = await uncertainTemplate(page, true);
    const status = card.getByRole('button', {
      name: 'Start-Status ungeklärt',
      exact: true,
    });
    const tooltip = page.getByRole('tooltip');
    await expect(
      card.getByRole('button', { name: 'Schnellstart', exact: true }),
    ).toBeDisabled();
    await status.tap();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Schnellstart aktiviert');
    await expect(tooltip).toContainText('Konfigurieren');
    await status.tap();
    await expect(tooltip).toHaveCount(0);
    await status.tap();
    await expect(tooltip).toBeVisible();
    await page.getByRole('heading', { name: /^RepoTray/ }).tap();
    await expect(tooltip).toHaveCount(0);
    await card
      .getByRole('button', { name: 'Vorlage Windows build konfigurieren' })
      .tap();
    await expect(
      page
        .getByRole('dialog')
        .getByRole('button', { name: 'Start simulieren' }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  } finally {
    await context.close();
  }
});

test('confirmation notice centers text, icon and close target at narrow and standard widths', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('button', { name: 'Einrichten', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'GitHub verbinden' });
  await dialog
    .getByText('Alternativ: Token hinterlegen', { exact: true })
    .click();
  await dialog.getByLabel('Beispiel-Token').fill('demo-token');
  await dialog
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText(/Demo-Token geprüft und verworfen/),
  ).toBeVisible();
  for (const width of [480, 360]) {
    await page.setViewportSize({ width, height: 760 });
    const geometry = await page.locator('.notice-banner').evaluate((banner) => {
      const center = (node: Element) => {
        const r = node.getBoundingClientRect();
        return r.top + r.height / 2;
      };
      return {
        center: center(banner),
        children: ['span', 'svg', 'button'].map((selector) =>
          center(banner.querySelector(selector)!),
        ),
        height: banner.getBoundingClientRect().height,
      };
    });
    for (const center of geometry.children)
      expect(Math.abs(center - geometry.center)).toBeLessThanOrEqual(0.5);
    expect(geometry.height).toBeLessThanOrEqual(53);
  }
});
