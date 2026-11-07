import { afterEach, describe, expect, it } from 'vitest';
import fixture from '../../fixtures/demo.json';
import { runDuration, runMoment } from './format';
import { m, setLocale } from './i18n/index.svelte';
import {
  historyRuns,
  isActive,
  recentSummary,
  repositoryStatus,
  runTone,
  statusLabel,
  TONE_ICON,
  visibleRuns,
} from './runs';
import type { Run, Snapshot } from './types';

// Synthetic fixtures only: a run GitHub still reports queued after 24 h.
const snapshot = () => structuredClone(fixture) as Snapshot;
const stuck = (run: Run): Run => ({
  ...run,
  status: 'stuck',
  conclusion: null,
  createdAt: '2026-09-01T08:00:00Z',
  updatedAt: '2026-09-01T08:00:00Z',
});

describe('stuck runs', () => {
  afterEach(() => setLocale('de'));

  it('are not open: never in the active list, sorted with the history', () => {
    const data = snapshot();
    // 8402 is the queued run of the demo; it has hung since September.
    data.runs[1] = stuck(data.runs[1]!);
    expect(isActive(data.runs[1]!)).toBe(false);
    expect(
      visibleRuns(data, '', '', 'active').map((run) => run.id),
    ).not.toContain(8402);
    expect(visibleRuns(data, '', '', 'recent').map((run) => run.id)).toEqual([
      8404, 8405, 8402,
    ]);
    // Open runs lead, the stuck one sits by its start date among the rest.
    expect(visibleRuns(data, '', '', 'all').map((run) => run.id)).toEqual([
      8401, 8403, 8404, 8405, 8402,
    ]);
    expect(historyRuns(data, '', '', 'all').at(-1)!.id).toBe(8402);
  });

  it('label and tone themselves as hanging, with a warning icon', () => {
    const run = stuck(snapshot().runs[1]!);
    expect(statusLabel(run)).toBe('Hängt');
    expect(runTone(run)).toBe('stuck');
    expect(TONE_ICON.stuck).toBe('warning');
    expect(m().runs.row.stuckHint).toContain('24 h');
    expect(repositoryStatus([run], run)).toEqual({
      tone: 'stuck',
      label: 'Hängt',
    });
    setLocale('en');
    expect(statusLabel(run)).toBe('Stuck');
    expect(m().runs.row.stuckHint).toContain('Delete it on GitHub');
  });

  it('do not count as active in the repository status line', () => {
    const data = snapshot();
    const queued = data.runs[1]!;
    const running = data.runs[0]!;
    expect(repositoryStatus([stuck(queued), running], running)).toEqual({
      tone: 'run',
      label: 'Läuft',
    });
  });

  it('are named in the strip summary', () => {
    const data = snapshot();
    const done = { ...data.runs[4]! };
    const hanging = stuck(data.runs[1]!);
    expect(recentSummary([null, hanging])).toBe('Letzter Run: hängt');
    expect(recentSummary([done, hanging, { ...hanging, id: 1 }])).toBe(
      'Letzte 3 Runs: 1 erfolgreich, 2 hängen',
    );
    setLocale('en');
    expect(recentSummary([done, hanging])).toBe(
      'Last 2 runs: 1 succeeded, 1 stuck',
    );
  });

  it('read from when they were queued and never count up', () => {
    const run = stuck(snapshot().runs[1]!);
    const now = Date.parse('2026-10-31T10:00:00Z');
    const moment = runMoment(run, now);
    expect(moment.datetime).toBe(run.createdAt);
    expect(moment.title.startsWith('Gestartet: ')).toBe(true);
    expect(runDuration(run, now, true)).toBe('0:00 min');
  });
});
