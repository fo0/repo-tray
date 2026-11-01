import { describe, expect, it } from 'vitest';
import { createDemoBridge, type Bridge } from './demo';
import { Panel } from './panel.svelte';
import { MAX_REPOS, notInTray } from './repoSelection.svelte';
import type { Snapshot } from './types';

const flush = () => new Promise((done) => setTimeout(done, 0));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

/**
 * A browser-demo panel that records every selection it sends; `gate` may
 * hold or fail the n-th call (1-based) before the demo applies it.
 */
async function setup(
  gate?: (call: number) => Promise<void> | void,
  answer: (value: Snapshot) => Snapshot = (value) => value,
) {
  const demo = createDemoBridge(undefined, 0);
  const calls: string[][] = [];
  const bridge: Bridge = {
    ...demo,
    selectRepos: async (ids) => {
      const call = calls.push([...ids].sort());
      await gate?.(call);
      return answer(await demo.selectRepos(ids));
    },
  };
  const panel = new Panel({
    bridge,
    native: false,
    observe: async () => () => {},
  });
  panel.load();
  await flush();
  return { panel, demo, bridge, calls };
}
const selected = (panel: Panel) =>
  panel
    .snapshot!.repos.filter((repo) => repo.selected)
    .map((repo) => repo.id)
    .sort();
const offer = (panel: Panel, id: string) => panel.notices.get(`repo:${id}`);
const BASE = ['demo-personal-kit', 'demo-personal-site', 'demo-team-tools'];

describe('RepoSelection', () => {
  it('adds at once and offers „Rückgängig“, which flips only that repository', async () => {
    const { panel, calls } = await setup();
    await panel.selection.add('demo-extra');
    expect(calls).toEqual([[...BASE, 'demo-extra'].sort()]);
    expect(selected(panel)).toContain('demo-extra');
    expect(offer(panel, 'demo-extra')).toMatchObject({
      text: 'sandbox-demo hinzugefügt.',
      tone: 'subtle',
      timeout: 8000,
      action: { label: 'Rückgängig' },
    });
    // A later change stays: undo flips the one repository against it.
    await panel.selection.remove('demo-team-tools');
    expect(offer(panel, 'demo-team-tools')!.text).toBe(
      'runner-tools-demo aus dem Tray entfernt.',
    );
    offer(panel, 'demo-extra')!.action!.run();
    await flush();
    expect(selected(panel)).toEqual([
      'demo-personal-kit',
      'demo-personal-site',
    ]);
    expect(offer(panel, 'demo-extra')).toMatchObject({
      text: 'sandbox-demo wieder entfernt.',
    });
    expect(offer(panel, 'demo-extra')!.action).toBeUndefined();
    // Undoing the removal brings the repository back.
    offer(panel, 'demo-team-tools')!.action!.run();
    await flush();
    expect(selected(panel)).toEqual(BASE);
    expect(offer(panel, 'demo-team-tools')!.text).toBe(
      'runner-tools-demo ist wieder im Tray.',
    );
  });

  it('collects rapid changes into one wanted set and sends one call at a time', async () => {
    const hold = deferred();
    const { panel, calls } = await setup((call) =>
      call === 1 ? hold.promise : undefined,
    );
    const done = Promise.all([
      panel.selection.add('demo-extra'),
      panel.selection.remove('demo-team-tools'),
      panel.selection.remove('demo-personal-site'),
      panel.selection.toggle('demo-personal-site'),
    ]);
    // The wanted state shows at once and stays busy until confirmed.
    expect(panel.selection.has('demo-extra')).toBe(true);
    expect(panel.selection.has('demo-team-tools')).toBe(false);
    expect(panel.selection.busy('demo-team-tools')).toBe(true);
    expect(panel.selection.busy('demo-personal-kit')).toBe(false);
    expect(panel.selectionBusy).toBe(true);
    expect(calls).toHaveLength(1);
    hold.resolve();
    await done;
    expect(calls).toEqual([
      [...BASE, 'demo-extra'].sort(),
      ['demo-extra', 'demo-personal-kit', 'demo-personal-site'],
    ]);
    expect(selected(panel)).toEqual([
      'demo-extra',
      'demo-personal-kit',
      'demo-personal-site',
    ]);
    expect(panel.selection.busy('demo-team-tools')).toBe(false);
    expect(panel.selectionBusy).toBe(false);
  });

  it('a refresh started between two calls never keeps spinning', async () => {
    const hold = deferred();
    const { panel, demo, bridge } = await setup((call) =>
      call === 1 ? hold.promise : undefined,
    );
    const first = panel.selection.add('demo-extra');
    const answer = deferred();
    bridge.refreshSnapshot = async () => {
      await answer.promise;
      return demo.refreshSnapshot();
    };
    const refresh = panel.refresh();
    expect(panel.refreshing).toBe(true);
    // The second call supersedes the refresh: its result is dropped.
    const second = panel.selection.remove('demo-team-tools');
    hold.resolve();
    await Promise.all([first, second]);
    answer.resolve();
    expect(await refresh).toBeNull();
    expect(panel.refreshing).toBe(false);
    expect(selected(panel)).toEqual([
      'demo-extra',
      'demo-personal-kit',
      'demo-personal-site',
    ]);
  });

  it('a change back before the call returns sends the original selection again', async () => {
    const hold = deferred();
    const { panel, calls } = await setup((call) =>
      call === 1 ? hold.promise : undefined,
    );
    const done = Promise.all([
      panel.selection.add('demo-extra'),
      panel.selection.remove('demo-extra'),
    ]);
    expect(panel.selection.has('demo-extra')).toBe(false);
    expect(panel.selection.busy('demo-extra')).toBe(true);
    hold.resolve();
    await done;
    expect(calls).toEqual([[...BASE, 'demo-extra'].sort(), BASE]);
    expect(selected(panel)).toEqual(BASE);
    expect(offer(panel, 'demo-extra')!.text).toBe(
      'sandbox-demo aus dem Tray entfernt.',
    );
  });

  it('reports only the user’s own changes, not others the snapshot brings', async () => {
    // E.g. a revoked repository the service dropped meanwhile.
    const { panel } = await setup(undefined, (value) => ({
      ...value,
      repos: value.repos.map((repo) =>
        repo.id === 'demo-team-tools' ? { ...repo, selected: false } : repo,
      ),
    }));
    await panel.selection.add('demo-extra');
    expect(selected(panel)).not.toContain('demo-team-tools');
    expect(panel.notices.items.map((item) => item.text)).toEqual([
      'sandbox-demo hinzugefügt.',
    ]);
  });

  it('a failed call warns and falls back to the snapshot', async () => {
    const { panel, calls } = await setup(() => {
      throw new Error('Wähle höchstens 50 bekannte Repositories.');
    });
    await panel.selection.add('demo-extra');
    expect(calls).toHaveLength(1);
    expect(panel.selection.has('demo-extra')).toBe(false);
    expect(panel.selection.busy('demo-extra')).toBe(false);
    expect(panel.selectionBusy).toBe(false);
    expect(
      panel.notices.items.map(({ text, tone }) => ({ text, tone })),
    ).toEqual([
      {
        text: 'Repository-Auswahl nicht geändert: Wähle höchstens 50 bekannte Repositories.',
        tone: 'warning',
      },
    ]);
  });

  it('refuses more than the native limit before sending anything', async () => {
    const { panel, demo, calls } = await setup();
    const full = await demo.snapshot();
    full.repos = Array.from({ length: MAX_REPOS + 1 }, (_, index) => ({
      ...full.repos[0]!,
      id: `repo-${index}`,
      name: `repo-${index}`,
      selected: index < MAX_REPOS,
    }));
    panel.accept(full);
    await panel.selection.add(`repo-${MAX_REPOS}`);
    expect(calls).toEqual([]);
    expect(panel.selection.has(`repo-${MAX_REPOS}`)).toBe(false);
    expect(panel.notices.items.at(-1)).toMatchObject({
      text: 'Höchstens 50 Repositories passen in den Tray. Entferne zuerst ein anderes.',
      tone: 'warning',
    });
  });

  it('a repository of an account that is not shown is added and named as such', async () => {
    const { panel } = await setup();
    panel.changeAccount('demo-personal');
    await panel.selection.add('demo-extra');
    expect(offer(panel, 'demo-extra')!.text).toBe(
      'sandbox-demo hinzugefügt. Sichtbar, sobald team-demo aktiv ist.',
    );
    // In the tray, but the overview shows only the active account's repositories.
    expect(panel.repos.map((repo) => repo.id)).not.toContain('demo-extra');
    panel.changeAccount('demo-work');
    expect(panel.repos.map((repo) => repo.id)).toContain('demo-extra');
  });

  it('a new account drops the undo offers of the previous view', async () => {
    const { panel } = await setup();
    await panel.selection.add('demo-extra');
    expect(offer(panel, 'demo-extra')).toBeDefined();
    panel.changeAccount('demo-work');
    expect(offer(panel, 'demo-extra')).toBeUndefined();
  });

  it('keeps the favorites of a removed repository for its return', async () => {
    const { panel } = await setup();
    const pins = panel.snapshot!.pins;
    expect(pins.map((pin) => pin.repoId)).toContain('demo-personal-kit');
    await panel.selection.remove('demo-personal-kit');
    expect(panel.snapshot!.pins).toEqual(pins);
    await panel.selection.add('demo-personal-kit');
    expect(panel.snapshot!.pins).toEqual(pins);
    expect(panel.repos.map((repo) => repo.id)).toContain('demo-personal-kit');
  });
});

describe('notInTray', () => {
  it('lists unselected matches of the shown accounts only while searching', async () => {
    const { panel } = await setup();
    const shows = (id: string): boolean => id === 'demo-work';
    const ids = (query: string, scope = shows) =>
      notInTray(panel.snapshot, scope, query).map((repo) => repo.id);
    expect(ids('  ')).toEqual([]);
    expect(ids('SANDBOX')).toEqual(['demo-extra']);
    expect(ids('team-demo/')).toEqual(['demo-extra']);
    // Selected ones are in the tray already; other accounts are out of scope.
    expect(ids('runner')).toEqual([]);
    expect(ids('sandbox', () => false)).toEqual([]);
  });
});
