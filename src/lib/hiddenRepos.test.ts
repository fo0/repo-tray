import { describe, expect, it } from 'vitest';
import { createDemoBridge, type Bridge, type PreferenceStorage } from './demo';
import { HiddenChoice } from './hiddenChoice.svelte';
import { HIDDEN_KEY, isHidden } from './hiddenRepos';
import { UNDO_TIMEOUT } from './favorites.svelte';
import { Panel } from './panel.svelte';
import { repositoryActivity } from './repoActivity';
import { visibleRuns } from './runs';
import type { HiddenRepo, Snapshot } from './types';

const memory = (seed: Record<string, string> = {}) => {
  const values = new Map(Object.entries(seed));
  const storage: PreferenceStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
  return { storage, values };
};
const flush = () => new Promise((done) => setTimeout(done, 0));
const selected = (snapshot: Snapshot) =>
  snapshot.repos.filter((repo) => repo.selected).map((repo) => repo.id);
/** demo-work's newest repository, with an open run (#8403). */
const TOOLS = 'demo-team-tools';
/** demo-work's 11th newest repository: it moves up when one is hidden. */
const NEXT = 'demo-work-legacy';
/** demo-work's 12th newest repository: only opening it from the search loads it. */
const OPENED = 'demo-extra';

describe('demo bridge', () => {
  it('hides at once, frees the place, persists and shows again', async () => {
    const { storage, values } = memory();
    const bridge = createDemoBridge(storage, 0);
    const hidden = await bridge.setRepoHidden('demo-work', TOOLS, true);
    expect(hidden.hiddenRepos).toEqual([
      {
        accountId: 'demo-work',
        repoId: TOOLS,
        owner: 'example-org',
        name: 'runner-tools-demo',
      },
    ]);
    expect(selected(hidden)).not.toContain(TOOLS);
    expect(selected(hidden)).toContain(NEXT);
    // Hiding again keeps one entry.
    await bridge.setRepoHidden('demo-work', TOOLS, true);
    expect(JSON.parse(values.get(HIDDEN_KEY)!)).toHaveLength(1);

    const restarted = await createDemoBridge(storage, 0).snapshot();
    expect(restarted.hiddenRepos).toEqual(hidden.hiddenRepos);
    expect(selected(restarted)).toContain(NEXT);

    const shown = await bridge.setRepoHidden('demo-work', TOOLS, false);
    expect(shown.hiddenRepos).toBeUndefined();
    expect(selected(shown)).toContain(TOOLS);
    expect(selected(shown)).not.toContain(NEXT);
    expect(values.has(HIDDEN_KEY)).toBe(false);
  });

  it('refuses an unknown repository and ignores corrupt or blocked storage', async () => {
    const bridge = createDemoBridge(memory().storage, 0);
    await expect(
      bridge.setRepoHidden('demo-work', 'missing', true),
    ).rejects.toThrow('Repository nicht gefunden.');
    // Showing an entry that is not hidden succeeds.
    await expect(
      bridge.setRepoHidden('demo-work', 'missing', false),
    ).resolves.toBeDefined();
    const corrupt = memory({
      [HIDDEN_KEY]: '[{"accountId":1},"x",{"nope"',
    }).storage;
    expect((await createDemoBridge(corrupt, 0).snapshot()).hiddenRepos).toBe(
      undefined,
    );
    const blocked = createDemoBridge(
      {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
        removeItem: () => undefined,
      },
      0,
    );
    const value = await blocked.setRepoHidden('demo-work', TOOLS, true);
    expect(value.hiddenRepos).toHaveLength(1);
  });

  it('keeps a repository opened from the search, unless it is hidden', async () => {
    const bridge = createDemoBridge(memory().storage, 0);
    await bridge.openRepository(OPENED);
    // Hiding another repository leaves the opened one loaded.
    const other = await bridge.setRepoHidden('demo-work', TOOLS, true);
    expect(selected(other)).toEqual(expect.arrayContaining([OPENED, NEXT]));
    const own = await bridge.setRepoHidden('demo-work', OPENED, true);
    expect(selected(own)).not.toContain(OPENED);
  });

  it('a reset shows every repository again', async () => {
    const { storage, values } = memory();
    const bridge = createDemoBridge(storage, 0);
    await bridge.setRepoHidden('demo-work', TOOLS, true);
    expect(selected(await bridge.resetDemo())).toContain(TOOLS);
    expect(values.has(HIDDEN_KEY)).toBe(false);
  });
});

describe('panel lists', () => {
  it('leave out a hidden repository and its runs; the search still finds it', async () => {
    const bridge = createDemoBridge(undefined, 0);
    const snapshot = await bridge.setRepoHidden('demo-work', TOOLS, true);
    // A favorite keeps a hidden repository selected; the lists still skip it.
    const pinned: Snapshot = {
      ...snapshot,
      repos: snapshot.repos.map((repo) =>
        repo.id === TOOLS ? { ...repo, selected: true } : repo,
      ),
    };
    for (const value of [snapshot, pinned]) {
      const ids = repositoryActivity(value, '', '').map((g) => g.repo.id);
      expect(ids).not.toContain(TOOLS);
      expect(
        visibleRuns(value, '', '', 'all').map((run) => run.repoId),
      ).not.toContain(TOOLS);
      const found = repositoryActivity(value, '', 'runner-tools');
      expect(found.map((g) => [g.repo.id, g.hidden])).toEqual([[TOOLS, true]]);
      expect(found[0]!.loaded).toBe(value === pinned);
    }
    expect(
      isHidden(snapshot.hiddenRepos, { accountId: 'demo-work', id: TOOLS }),
    ).toBe(true);
    expect(
      isHidden(snapshot.hiddenRepos, { accountId: 'other', id: TOOLS }),
    ).toBe(false);
  });
});

async function setup(overrides: Partial<Bridge> = {}) {
  const bridge = { ...createDemoBridge(undefined, 0), ...overrides };
  const panel = new Panel({
    bridge,
    native: false,
    observe: async () => () => {},
  });
  panel.load();
  await flush();
  return panel;
}
const tools = (panel: Panel) =>
  panel.snapshot!.repos.find((repo) => repo.id === TOOLS)!;

describe('Actions.setHidden', () => {
  it('hides, offers „Rückgängig“ for 8 s and shows the repository again', async () => {
    const panel = await setup();
    await panel.actions.setHidden(tools(panel), true);
    expect(panel.snapshot!.hiddenRepos).toHaveLength(1);
    const offer = panel.notices.items.find(
      (item) => item.text === 'runner-tools-demo ausgeblendet',
    )!;
    expect(offer).toMatchObject({ tone: 'subtle', timeout: UNDO_TIMEOUT });
    expect(offer.action?.label).toBe('Rückgängig');
    offer.action!.run();
    await flush();
    expect(panel.snapshot!.hiddenRepos).toBeUndefined();
    expect(panel.notices.items.map((item) => item.text)).toEqual([
      'runner-tools-demo eingeblendet',
    ]);
  });

  it('warns on a refusal and drops the offer when the account changes', async () => {
    const refused = await setup({
      setRepoHidden: async () => {
        throw new Error('Einstellung konnte nicht gespeichert werden.');
      },
    });
    await refused.actions.setHidden(tools(refused), true);
    expect(refused.notices.items).toMatchObject([
      { text: 'Einstellung konnte nicht gespeichert werden.', tone: 'warning' },
    ]);
    expect(refused.actions.hiding.size).toBe(0);
    const panel = await setup();
    await panel.actions.setHidden(tools(panel), true);
    panel.changeAccount('demo-personal');
    expect(panel.notices.items).toEqual([]);
  });
});

describe('HiddenChoice', () => {
  const entry = (repoId: string): HiddenRepo => ({
    accountId: 'demo-work',
    repoId,
    owner: 'example-org',
    name: repoId,
  });

  it('stages rows and shows only the staged ones that are still hidden', async () => {
    const choice = new HiddenChoice();
    const rows = [entry('a'), entry('b'), entry('c')];
    expect(choice.pendingIn(rows)).toBe(false);
    choice.toggle(rows[0]!);
    choice.toggle(rows[2]!);
    choice.toggle(rows[2]!);
    choice.toggle(entry('gone'));
    expect(choice.pendingIn(rows)).toBe(true);
    const shown: string[] = [];
    await choice.apply(rows, async (row) => void shown.push(row.repoId));
    expect(shown).toEqual(['a']);
    expect(choice.pendingIn(rows)).toBe(false);
  });

  it('keeps the rows after a failure staged', async () => {
    const choice = new HiddenChoice();
    const rows = [entry('a'), entry('b')];
    rows.forEach(choice.toggle);
    await expect(
      choice.apply(rows, async (row) => {
        if (row.repoId === 'b') throw new Error('Repository nicht gefunden.');
      }),
    ).rejects.toThrow('Repository nicht gefunden.');
    expect([choice.has(rows[0]!), choice.has(rows[1]!)]).toEqual([false, true]);
  });
});
