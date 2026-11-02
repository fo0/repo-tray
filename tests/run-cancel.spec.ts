import fixture from '../fixtures/demo.json' with { type: 'json' };
import { expect, test, type Page } from './support/test';
import { maximizeButton, openPage } from './support/demo';
import { installTauriMock, readCalls } from './support/tauriMock';

const liveSection = (page: Page) =>
  page.getByRole('region', { name: 'Läuft gerade', exact: true });
const stop = (page: Page, id: number) =>
  page.locator(`button[data-cancel-run="${id}"]`);
const RUN = 'demo-dev/launch-kit-demo · Desktop build #8401';

test.describe('demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(maximizeButton(page, 'runs')).toBeVisible();
  });

  test('„Läuft gerade“ cancels a run with two clicks on its stop button', async ({
    page,
  }) => {
    const button = stop(page, 8401);
    await expect(button).toHaveAccessibleName(`${RUN} abbrechen`);
    await expect(button).toHaveAttribute('title', 'Run abbrechen');
    // Every open demo run belongs to a repository with write access.
    await expect(liveSection(page).locator('.live-cancel')).toHaveCount(3);

    await button.click();
    await expect(button).toHaveText('Abbrechen?');
    await expect(button).toHaveAccessibleName(`${RUN} wirklich abbrechen?`);
    // The first click never cancels; the row is still there.
    await expect(
      liveSection(page).locator(
        '[data-focus-key="run:demo-personal-kit:8401"]',
      ),
    ).toBeVisible();

    await button.click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Abbruch von #8401 angefordert.' }),
    ).toBeVisible();
    await expect(
      liveSection(page).locator(
        '[data-focus-key="run:demo-personal-kit:8401"]',
      ),
    ).toHaveCount(0);
    await openPage(page, 'runs');
    await expect(
      page.locator('article.run').filter({ hasText: '#8401' }),
    ).toContainText('Abgebrochen');
  });

  test('leaving an armed stop button disarms it', async ({ page }) => {
    const button = stop(page, 8402);
    await button.click();
    await expect(button).toHaveText('Abbrechen?');
    await page.keyboard.press('Tab');
    await expect(button).not.toHaveText('Abbrechen?');
    await expect(button).toHaveAccessibleName(/abbrechen$/);
  });

  test('an open run’s details in the Verlauf offer „Run abbrechen“', async ({
    page,
  }) => {
    await openPage(page, 'runs');
    const row = page.locator('article.run').filter({ hasText: '#8403' });
    await row.locator('.run-button').click();
    // By class: the accessible name changes once it is armed.
    const cancel = row.locator('.run-cancel');
    await expect(cancel).toHaveText('Run abbrechen');
    await cancel.click();
    await expect(cancel).toHaveText('Wirklich abbrechen?');
    await cancel.click();
    await expect(row.locator('.run-status')).toHaveText('Abgebrochen');
    // A completed run offers no cancel.
    await expect(row.getByRole('button', { name: /abbrechen/i })).toHaveCount(
      0,
    );
  });
});

test('natively the stop button sends exactly one cancel_run for the run', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'repowatch.activeAccount.v1',
      JSON.stringify('demo-personal'),
    ),
  );
  await installTauriMock<typeof fixture, { cancelled: number }>(
    page,
    (fixture, state) => {
      const snapshot = {
        ...structuredClone(fixture),
        mode: 'live',
        stale: false,
        connectivity: 'online',
        message: undefined,
      };
      return (cmd) => {
        if (cmd === 'snapshot' || cmd === 'refresh_snapshot')
          return structuredClone(snapshot);
        if (cmd === 'cancel_run') {
          state.cancelled++;
          return structuredClone(snapshot);
        }
        return null;
      };
    },
    { arg: fixture, state: { cancelled: 0 } },
  );
  await page.goto('/');
  const button = stop(page, 8401);
  await button.click();
  await button.click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Abbruch von #8401 angefordert.' }),
  ).toBeVisible();
  // Accepted is not cancelled: the run stays „wird abgebrochen“ until a
  // snapshot reports it closed.
  await expect(button).toHaveAccessibleName(`${RUN} wird abgebrochen`);
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  // A press while it is cancelling sends nothing more.
  await button.dispatchEvent('click');
  expect(await readCalls(page, 'cancel_run')).toEqual([
    { cmd: 'cancel_run', args: { repoId: 'demo-personal-kit', runId: 8401 } },
  ]);
});
