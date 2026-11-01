import type { Page } from '@playwright/test';
import fixture from '../../fixtures/demo.json' with { type: 'json' };
import { installTauriMock } from './tauriMock';

export const NOW = Date.parse('2026-11-01T09:00:00Z');
export const RUN_URL =
  'https://github.com/demo-dev/launch-kit-demo/actions/runs/8401';
export type ActivityMock = { openError: string };

/** Native panel (labelled IPC mock) with one running and one finished run. */
export async function openNativeActivity(page: Page) {
  await page.clock.install({ time: NOW - 5_000 });
  await page.addInitScript(() =>
    localStorage.setItem(
      'repotray.activeAccount.v1',
      JSON.stringify('demo-personal'),
    ),
  );
  await installTauriMock<
    { fixture: typeof fixture; now: number; url: string },
    ActivityMock
  >(
    page,
    ({ fixture, now, url }, state) => {
      const ago = (minutes: number) =>
        new Date(now - minutes * 60_000).toISOString();
      const snapshot = {
        ...structuredClone(fixture),
        mode: 'live',
        stale: false,
        connectivity: 'online',
        updatedAt: ago(0),
        message: undefined,
        runs: [
          {
            ...fixture.runs[0],
            createdAt: ago(3),
            updatedAt: ago(2),
            htmlUrl: url,
          },
          {
            ...fixture.runs[4],
            createdAt: ago(125),
            updatedAt: ago(120),
            htmlUrl: url.replace(/8401$/, '8405'),
          },
        ],
      };
      return (cmd) => {
        if (cmd === 'snapshot' || cmd === 'refresh_snapshot')
          return structuredClone(snapshot);
        if (cmd === 'open_run' && state.openError) throw state.openError;
        return null;
      };
    },
    { arg: { fixture, now: NOW, url: RUN_URL }, state: { openError: '' } },
  );
  await page.goto('/');
  // Paused, so the view reads exactly NOW when it subscribes to the clock.
  await page.clock.pauseAt(NOW);
  await page.getByRole('button', { name: /^Aktivität/ }).click();
}

export const row = (page: Page, id: number) =>
  page.locator('article.run').filter({ hasText: `#${id}` });
