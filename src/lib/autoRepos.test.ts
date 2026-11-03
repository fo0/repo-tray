import { describe, expect, it } from 'vitest';
import { AUTO_REPOS, autoSelect } from './autoRepos';
import type { HiddenRepo, Pin, Repo } from './types';

const repo = (
  accountId: string,
  name: string,
  pushedAt: string | null,
): Repo => ({
  id: `${accountId}:${name}`,
  accountId,
  owner: 'fixture-owner',
  name,
  defaultBranch: 'main',
  pushedAt,
  selected: false,
  permission: 'write',
});
const pin = (accountId: string, repoId: string): Pin => ({
  id: `pin-${repoId}`,
  label: 'Fixture',
  accountId,
  repoId,
  workflowId: 9,
  ref: 'main',
  inputs: {},
  quickStart: false,
});
const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}T08:00:00Z`;
const shown = (repos: Repo[]) =>
  repos.filter((item) => item.selected).map((item) => item.id);

describe('autoSelect', () => {
  it('picks the newest pushes per account, a missing push time last', () => {
    const repos = [
      ...Array.from({ length: 12 }, (_, n) => repo('a', `r${n}`, day(n + 1))),
      repo('a', 'never', null),
      repo('a', 'garbled', 'yesterday'),
      { ...repo('b', 'lonely', null), selected: true },
    ];
    const picked = shown(autoSelect(repos, []));
    expect(picked).toEqual([
      ...Array.from({ length: AUTO_REPOS }, (_, n) => `a:r${n + 2}`),
      'b:lonely',
    ]);
  });

  it('breaks ties by owner and name', () => {
    const repos = ['delta', 'Alpha', 'charlie', 'bravo'].map((name) =>
      repo('a', name, day(1)),
    );
    const many = [
      ...repos,
      ...Array.from({ length: AUTO_REPOS - 2 }, (_, n) =>
        repo('a', `new-${n}`, day(2)),
      ),
    ];
    expect(shown(autoSelect(many, []))).toContain('a:Alpha');
    expect(shown(autoSelect(many, []))).toContain('a:bravo');
    expect(shown(autoSelect(many, []))).not.toContain('a:charlie');
  });

  it('keeps the repository of a favorite of the same account', () => {
    const repos = [
      ...Array.from({ length: AUTO_REPOS }, (_, n) =>
        repo('a', `new-${n}`, day(2)),
      ),
      repo('a', 'old', day(1)),
      repo('a', 'other', day(1)),
    ];
    const picked = shown(
      autoSelect(repos, [pin('a', 'a:old'), pin('b', 'a:other')]),
    );
    expect(picked).toHaveLength(AUTO_REPOS + 1);
    expect(picked).toContain('a:old');
    expect(picked).not.toContain('a:other');
  });

  it('hands the place of a hidden repository to the next one, unless a favorite needs it', () => {
    const hide = (name: string): HiddenRepo => ({
      accountId: 'a',
      repoId: `a:${name}`,
      owner: 'fixture-owner',
      name,
    });
    const repos = [
      ...Array.from({ length: AUTO_REPOS + 2 }, (_, n) =>
        repo('a', `r${n}`, day(n + 1)),
      ),
      repo('b', 'r11', day(12)),
    ];
    const picked = shown(autoSelect(repos, [], [hide('r11')]));
    expect(picked).not.toContain('a:r11');
    expect(picked).toContain('a:r1');
    expect(picked).not.toContain('a:r0');
    expect(picked).toContain('b:r11');
    const kept = shown(
      autoSelect(repos, [pin('a', 'a:r11')], [hide('r11'), hide('r10')]),
    );
    expect(kept).toContain('a:r11');
    expect(kept).not.toContain('a:r10');
    expect(kept).toContain('a:r0');
    expect(kept.filter((id) => id.startsWith('a:'))).toHaveLength(
      AUTO_REPOS + 1,
    );
  });
});
