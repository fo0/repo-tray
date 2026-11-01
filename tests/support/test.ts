import { test as base, expect, type ConsoleMessage } from '@playwright/test';

/**
 * Shared Playwright entry point: every spec imports `test` and `expect` from
 * here. An automatic fixture fails the test on any uncaught page error and on
 * any console error, so a crash that the UI happens to survive (e.g. a Svelte
 * `state_unsafe_mutation` thrown from an event handler) never passes silently.
 */

/** The dev server serves no favicon; Chromium reports that 404 as an error. */
function expected(message: ConsoleMessage) {
  return /\/favicon\.ico$/.test(message.location().url);
}

export const test = base.extend<{ cleanConsole: void }>({
  cleanConsole: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('pageerror', (error) =>
        problems.push(`pageerror: ${error.stack ?? error.message}`),
      );
      page.on('console', (message) => {
        if (message.type() === 'error' && !expected(message))
          problems.push(`console.error: ${message.text()}`);
      });
      await use();
      expect(problems, 'uncaught page errors or console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
export type { Locator, Page } from '@playwright/test';
