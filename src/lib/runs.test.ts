import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/demo.json';
import { fullRepo } from './model';
import {
  duration,
  groupedRuns,
  historyRuns,
  HISTORY_LIMIT,
  isActive,
  repositoryActivity,
  statusLabel,
  visibleRuns,
} from './runs';
import type { Run, Snapshot } from './types';

const snapshot = () => structuredClone(fixture) as Snapshot;

describe('activity model', () => {
  it('orders repositories by latest activity, including completed runs, and keeps unused repositories', () => {
    const data = snapshot();
    data.repos[3].selected = true;
    data.runs[3].updatedAt = '2026-10-31T10:00:00Z';
    expect(repositoryActivity(data, '', '').map(({ repo }) => repo.id)).toEqual(
      [
        'demo-personal-site',
        'demo-personal-kit',
        'demo-team-tools',
        'demo-extra',
      ],
    );
    expect(
      repositoryActivity(data, 'demo-work', '').map(({ repo }) => repo.id),
    ).toEqual(['demo-team-tools', 'demo-extra']);
    expect(
      repositoryActivity(data, '', 'desktop build').map(({ workflows }) =>
        workflows.map((w) => w.id),
      ),
    ).toEqual([[101]]);
    expect(repositoryActivity(data, '', 'not-found')).toEqual([]);
  });
  it('limits completed history across repositories without evicting older open runs', () => {
    const data = snapshot();
    const completed = data.runs.find((run) => run.status === 'completed')!;
    data.runs.push(
      ...Array.from({ length: 80 }, (_, index) => ({
        ...completed,
        id: 10000 + index,
        createdAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
      })),
    );
    const history = historyRuns(data, '', '', 'all');
    expect(history.filter(isActive)).toHaveLength(3);
    expect(history.filter((run) => !isActive(run))).toHaveLength(HISTORY_LIMIT);
    expect(history.at(-1)?.id).toBe(10030);
    expect(
      historyRuns(data, 'demo-work', '', 'all').map((run) => run.repoId),
    ).toEqual(['demo-team-tools']);
  });
  it('groups full repository names with live counts and sorts active repositories first', () => {
    const data = snapshot();
    const groups = groupedRuns(data, '', '', 'all');
    expect(
      groups.map((group) => [fullRepo(group.repo), group.activeCount]),
    ).toEqual([
      ['demo-dev/launch-kit-demo', 2],
      ['example-org/runner-tools-demo', 1],
      ['demo-dev/website-demo', 0],
    ]);
    expect(groups[0].runs.map((run) => run.id)).toEqual([8402, 8401, 8405]);
    expect(
      groupedRuns(data, 'demo-work', '', 'all').map((group) => group.repo.id),
    ).toEqual(['demo-team-tools']);
    expect(
      groupedRuns(data, '', '', 'failed').map((group) => group.repo.id),
    ).toEqual(['demo-personal-site']);
  });
  it('filters selected repos, full owner/repo, accounts and activity states', () => {
    const data = snapshot();
    expect(visibleRuns(data, '', '', 'active')).toHaveLength(3);
    expect(
      visibleRuns(data, 'demo-work', '', 'all').map((run) => run.repoId),
    ).toEqual(['demo-team-tools']);
    expect(
      visibleRuns(data, '', 'example-org/runner-tools-demo', 'all'),
    ).toHaveLength(1);
    expect(
      visibleRuns(data, '', 'DEVELOP', 'all').map((run) => run.id),
    ).toEqual([8402]);
    expect(visibleRuns(data, '', '', 'failed').map((run) => run.id)).toEqual([
      8404,
    ]);
    expect(
      visibleRuns(data, '', '', 'recent').every((run) => !isActive(run)),
    ).toBe(true);
    data.repos[0].selected = false;
    expect(
      visibleRuns(data, 'demo-personal', '', 'all').map((run) => run.id),
    ).toEqual([8404]);
  });
  it('sorts active first, then by start date and reports truthful status', () => {
    const data = snapshot();
    data.runs[4].createdAt = '2030-01-01T00:00:00Z';
    expect(visibleRuns(data, '', '', 'all').map((run) => run.id)).toEqual([
      8402, 8401, 8403, 8405, 8404,
    ]);
    expect(statusLabel(data.runs[1])).toBe('In Warteschlange');
    expect(statusLabel(data.runs[3])).toBe('Fehlgeschlagen');
    expect(duration(data.runs[0])).toBe('1:00 min');
    expect(fullRepo(data.repos[1])).toBe('example-org/runner-tools-demo');
  });
  it.each([
    ['queued', null, 'In Warteschlange'],
    ['in_progress', null, 'Läuft'],
    ['waiting', null, 'Wartet'],
    ['completed', 'success', 'Erfolgreich'],
    ['completed', 'failure', 'Fehlgeschlagen'],
    ['completed', 'cancelled', 'Abgebrochen'],
    ['completed', null, 'Abgebrochen'],
  ] satisfies [Run['status'], Run['conclusion'], string][])(
    'labels status %s with conclusion %s as %s',
    (status, conclusion, label) => {
      const run = { ...snapshot().runs[0], status, conclusion };
      expect(statusLabel(run)).toBe(label);
    },
  );
  it.each([
    [59, '0:59 min'],
    [0, '0:00 min'],
    [65, '1:05 min'],
    [725, '12:05 min'],
    [-30, '0:00 min'], // updatedAt before createdAt (clock skew) clamps to zero
  ])('formats a run of %i seconds as %s', (seconds, label) => {
    const createdAt = '2026-10-31T09:00:00Z';
    const updatedAt = new Date(Date.parse(createdAt) + seconds * 1000);
    expect(
      duration({
        ...snapshot().runs[0],
        createdAt,
        updatedAt: updatedAt.toISOString(),
      }),
    ).toBe(label);
  });
});
