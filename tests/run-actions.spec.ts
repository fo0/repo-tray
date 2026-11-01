import { expect, test, type Page } from '@playwright/test';
import {
  type ActivityMock,
  openNativeActivity,
  row,
  RUN_URL,
} from './support/nativeActivity';
import { configureMock, readCalls } from './support/tauriMock';

// Rows render local times; a fixed zone keeps them stable.
test.use({ timezoneId: 'UTC' });

/** Replaces the clipboard with a recorder; `fail` makes writes reject. */
async function recordClipboard(page: Page, fail = false) {
  await page.addInitScript((fail) => {
    const copied: string[] = [];
    Object.assign(window, { __copied: copied });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (fail) throw new DOMException('denied', 'NotAllowedError');
          copied.push(text);
        },
      },
    });
  }, fail);
}
const copied = (page: Page) =>
  page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
const notice = (page: Page, text: string) =>
  page.getByRole('status').filter({ hasText: text });

test('each run opens through the shell and copies its link without expanding', async ({
  page,
}) => {
  await recordClipboard(page);
  await openNativeActivity(page);
  const running = row(page, 8401);
  const toggle = running.locator('.run-button');
  const open = running.getByRole('link', {
    name: 'Desktop build #8401 auf GitHub öffnen',
    exact: true,
  });
  const copy = running.getByRole('button', {
    name: 'Link zu Desktop build #8401 kopieren',
    exact: true,
  });
  // Every name says which run it acts on; rows of one workflow differ by id.
  await expect(toggle).toHaveAccessibleName(/^Desktop build #8401 · /);
  await toggle.focus();
  await page.keyboard.press('Tab');
  await expect(open).toBeFocused();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => readCalls(page, 'open_run'))
    .toEqual([{ cmd: 'open_run', args: { url: RUN_URL } }]);
  await page.keyboard.press('Tab');
  await expect(copy).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(notice(page, 'Link kopiert.')).toBeVisible();
  expect(await copied(page)).toEqual([RUN_URL]);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(page.context().pages()).toHaveLength(1);

  await configureMock<ActivityMock>(page, {
    openError: 'Browser konnte nicht geöffnet werden.',
  });
  await open.click();
  await expect(
    notice(page, 'Browser konnte nicht geöffnet werden.'),
  ).toBeVisible();
});

test('a refused clipboard explains that the link was not copied', async ({
  page,
}) => {
  await recordClipboard(page, true);
  await openNativeActivity(page);
  await row(page, 8405)
    .getByRole('button', { name: 'Link zu Desktop build #8405 kopieren' })
    .click();
  await expect(notice(page, 'Link konnte nicht kopiert werden.')).toBeVisible();
  await expect(notice(page, 'Link kopiert.')).toHaveCount(0);
});

test('demo runs offer both row actions disabled with the demo hint', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Aktivität/ }).click();
  const running = row(page, 8401);
  for (const name of [
    'Desktop build #8401 auf GitHub öffnen',
    'Link zu Desktop build #8401 kopieren',
  ]) {
    const action = running.getByRole('button', { name, exact: true });
    await expect(action).toBeDisabled();
    await expect(action).toHaveAttribute(
      'title',
      'Demo-Runs haben keinen GitHub-Link',
    );
  }
});

for (const width of [360, 480]) {
  test(`row actions fit beside the run text at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 760 });
    await openNativeActivity(page);
    const layout = await page.evaluate(() =>
      [...document.querySelectorAll('article.run')].map((run) => {
        const box = (selector: string) =>
          run.querySelector(selector)!.getBoundingClientRect();
        const button = box('.run-button');
        const actions = box('.run-actions');
        const time = box('.run-time');
        const main = box('.run-main');
        const targets = [...run.querySelectorAll('.run-action')].map((action) =>
          action.getBoundingClientRect(),
        );
        return {
          rowHeight: button.height,
          insideRow:
            actions.bottom <= button.bottom && actions.right <= button.right,
          belowTime: actions.top >= time.bottom,
          besideText: actions.left >= main.right,
          minTarget: Math.min(
            ...targets.flatMap((target) => [target.width, target.height]),
          ),
        };
      }),
    );
    for (const item of layout) {
      expect(item.rowHeight).toBeLessThanOrEqual(79);
      expect(item.insideRow).toBe(true);
      expect(item.belowTime).toBe(true);
      expect(item.besideText).toBe(true);
      expect(item.minTarget).toBeGreaterThanOrEqual(24);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath(`activity-rows-${width}.png`),
    });
  });
}
