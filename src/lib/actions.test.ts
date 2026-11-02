import { describe, expect, it, vi } from 'vitest';
import { ARM_MS, ArmedConfirm } from './armedConfirm.svelte';
import { createDemoBridge, type Bridge } from './demo';
import { Panel } from './panel.svelte';

const flush = () => new Promise((done) => setTimeout(done, 0));

async function setup(overrides: Partial<Bridge> = {}) {
  const bridge = { ...createDemoBridge(undefined, 0), ...overrides };
  const panel = new Panel({
    bridge,
    native: false,
    observe: async () => () => {},
  });
  panel.load();
  await flush();
  return { panel, bridge };
}
const run = (panel: Panel, id: number) =>
  panel.snapshot!.runs.find((item) => item.id === id)!;
const texts = (panel: Panel) => panel.notices.items.map((item) => item.text);

describe('Run cancellation', () => {
  it('offers cancel only for open runs of a repository with write access', async () => {
    const { panel } = await setup();
    expect(panel.canCancel(run(panel, 8401))).toBe(true);
    // Completed history cannot be cancelled.
    expect(panel.canCancel(run(panel, 8404))).toBe(false);
    const readOnly = {
      ...panel.snapshot!,
      repos: panel.snapshot!.repos.map((repo) =>
        repo.id === 'demo-personal-kit'
          ? { ...repo, permission: 'read' as const }
          : repo,
      ),
    };
    panel.accept(readOnly);
    expect(panel.canCancel(run(panel, 8401))).toBe(false);
  });

  it('sends one request, keeps the run „wird abgebrochen“ until it closes and confirms it', async () => {
    let calls = 0;
    const { panel, bridge } = await setup();
    const cancel = bridge.cancelRun;
    bridge.cancelRun = (...args) => (calls++, cancel(...args));
    const open = run(panel, 8402);
    const pending = panel.actions.cancelRun(open);
    expect(panel.actions.isCancelling(open)).toBe(true);
    // A second press while the first is pending sends nothing.
    await panel.actions.cancelRun(open);
    await pending;
    expect(calls).toBe(1);
    expect(run(panel, 8402)).toMatchObject({
      status: 'completed',
      conclusion: 'cancelled',
    });
    expect(panel.actions.isCancelling(run(panel, 8402))).toBe(false);
    expect(texts(panel)).toContain('Abbruch von #8402 angefordert.');
  });

  it('names a refusal and lets the user try again', async () => {
    const { panel } = await setup({
      cancelRun: async () => {
        throw new Error('Run lässt sich nicht mehr abbrechen.');
      },
    });
    const open = run(panel, 8401);
    await panel.actions.cancelRun(open);
    expect(panel.actions.isCancelling(open)).toBe(false);
    expect(panel.notices.items.at(-1)).toMatchObject({
      text: 'Run lässt sich nicht mehr abbrechen.',
      tone: 'warning',
    });
  });

  it('drops a cancel answer that arrives after the account changed', async () => {
    let release: () => void = () => {};
    const { panel, bridge } = await setup();
    const cancel = bridge.cancelRun;
    bridge.cancelRun = async (...args) => {
      await new Promise<void>((done) => (release = done));
      return cancel(...args);
    };
    const pending = panel.actions.cancelRun(run(panel, 8401));
    panel.changeAccount('demo-work');
    expect(panel.actions.cancelling.size).toBe(0);
    release();
    await pending;
    // The demo cancelled it, but the stale answer was not taken over.
    expect(run(panel, 8401).status).toBe('in_progress');
  });
});

describe('Actions and a refresh in flight', () => {
  it('a cancel answer frees the refresh button, so the next refresh runs', async () => {
    let finish: () => void = () => {};
    const { panel, bridge } = await setup();
    const read = bridge.refreshSnapshot;
    bridge.refreshSnapshot = async () => {
      await new Promise<void>((done) => (finish = done));
      return read();
    };
    const refreshing = panel.refresh();
    expect(panel.refreshing).toBe(true);
    await panel.actions.cancelRun(run(panel, 8401));
    expect(panel.refreshing).toBe(false);
    finish();
    // The older read lost to the cancel answer and leaves nothing behind.
    expect(await refreshing).toBeNull();
    expect(panel.refreshing).toBe(false);
    bridge.refreshSnapshot = read;
    expect(await panel.refresh()).not.toBeNull();
  });

  it('a refusal for the previous account stays out of the new view', async () => {
    let fail: (cause: Error) => void = () => {};
    const { panel } = await setup({
      cancelRun: () => new Promise((_, reject) => (fail = reject)),
      openRepository: () => new Promise((_, reject) => (fail = reject)),
    });
    const cancel = panel.actions.cancelRun(run(panel, 8401));
    panel.changeAccount('demo-work');
    fail(new Error('Abbrechen nicht erlaubt.'));
    await cancel;
    const open = panel.actions.openRepository('demo-extra');
    panel.changeAccount('demo-personal');
    fail(new Error('Repository nicht gefunden.'));
    await open;
    expect(texts(panel)).toEqual([]);
  });
});

describe('Repositories from the search', () => {
  it('expands at once, loads the repository and keeps it open', async () => {
    const { panel } = await setup();
    const loading = panel.actions.openRepository('demo-extra');
    expect(panel.expandedRepos.has('demo-extra')).toBe(true);
    expect(panel.actions.opening.has('demo-extra')).toBe(true);
    await loading;
    expect(panel.actions.opening.size).toBe(0);
    expect(
      panel.snapshot!.repos.find((repo) => repo.id === 'demo-extra')?.selected,
    ).toBe(true);
    expect(panel.expandedRepos.has('demo-extra')).toBe(true);
  });

  it('collapses again and warns when loading fails', async () => {
    const { panel } = await setup({
      openRepository: async () => {
        throw new Error('Repository nicht gefunden.');
      },
    });
    await panel.actions.openRepository('demo-extra');
    expect(panel.expandedRepos.has('demo-extra')).toBe(false);
    expect(texts(panel)).toContain('Repository nicht gefunden.');
  });
});

describe('ArmedConfirm', () => {
  it('runs the action on the second press only and disarms after a while', () => {
    vi.useFakeTimers();
    const confirm = new ArmedConfirm<number>();
    let ran = 0;
    confirm.press(1, () => ran++);
    expect(confirm.is(1)).toBe(true);
    // Another key re-arms instead of running.
    confirm.press(2, () => ran++);
    expect([confirm.is(1), confirm.is(2), ran]).toEqual([false, true, 0]);
    confirm.press(2, () => ran++);
    expect([confirm.is(2), ran]).toEqual([false, 1]);
    confirm.press(3, () => ran++);
    vi.advanceTimersByTime(ARM_MS - 1);
    expect(confirm.is(3)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(confirm.is(3)).toBe(false);
    vi.useRealTimers();
  });
});
