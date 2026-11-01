import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/demo.json';
import {
  defaultInputs,
  duration,
  fullRepo,
  groupedRuns,
  repositoryActivity,
  historyRuns,
  HISTORY_LIMIT,
  isActive,
  RequestEpoch,
  safePin,
  statusLabel,
  validateDispatch,
  visibleRuns,
} from './model';
import type { DispatchRequest, Pin, Run, Snapshot, Workflow } from './types';

const snapshot = () => structuredClone(fixture) as Snapshot;
const request = (
  overrides: Partial<DispatchRequest> = {},
): DispatchRequest => ({
  accountId: 'demo-personal',
  repoId: 'demo-personal-kit',
  workflowId: 101,
  ref: 'main',
  inputs: { target: 'windows-x64', version: '0.1.0', dry_run: true },
  requestId: 'test-id',
  ...overrides,
});

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
  ] as [Run['status'], Run['conclusion'], string][])(
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

describe('dispatch validation', () => {
  it('accepts exact typed inputs and provides typed defaults', () => {
    const data = snapshot();
    expect(validateDispatch(data, request())).toBeNull();
    expect(defaultInputs(data.workflows[0])).toEqual({
      target: 'windows-x64',
      version: '0.1.0',
      dry_run: true,
    });
  });
  it('falls back to false for booleans and an empty string otherwise without defaults', () => {
    const workflow: Workflow = {
      ...snapshot().workflows[0],
      inputs: (
        ['boolean', 'string', 'choice', 'number', 'environment'] as const
      ).map((type) => ({
        name: `no_default_${type}`,
        label: type,
        type,
        required: false,
        options: [],
      })),
    };
    expect(defaultInputs(workflow)).toEqual({
      no_default_boolean: false,
      no_default_string: '',
      no_default_choice: '',
      no_default_number: '',
      no_default_environment: '',
    });
  });
  it.each([
    [{ accountId: 'demo-work' }, /Konto und Repository/],
    [{ repoId: 'unknown' }, /Konto und Repository/],
    [{ workflowId: 102, inputs: {} }, /manuellen Start/],
    [{ workflowId: 201 }, /manuellen Start/],
    [{ ref: 'unlisted' }, /Branch oder Tag/],
    [{ requestId: ' ' }, /eindeutige ID/],
    [
      { inputs: { target: 'unknown', version: '1', dry_run: true } },
      /verfügbaren Wert/,
    ],
    [
      { inputs: { target: 'windows-x64', version: ' ', dry_run: true } },
      /Version ist erforderlich/,
    ],
    [
      { inputs: { target: 'windows-x64', version: '1', dry_run: 'true' } },
      /muss Ja oder Nein sein/,
    ],
    [{ inputs: { target: 'windows-x64', version: 1, dry_run: true } }, /Text/],
    [
      {
        inputs: {
          target: 'windows-x64',
          version: '1',
          dry_run: true,
          token: 'never-save',
        },
      },
      /Unbekannte/,
    ],
  ] as [Partial<DispatchRequest>, RegExp][])(
    'rejects invalid target/inputs %j',
    (overrides, expected) => {
      expect(validateDispatch(snapshot(), request(overrides))).toMatch(
        expected,
      );
    },
  );
  it('requires selected repository, write rights, and dispatch availability on default branch', () => {
    const data = snapshot();
    data.repos[0].selected = false;
    expect(validateDispatch(data, request())).toMatch(/Einstellungen/);
    data.repos[0].selected = true;
    data.repos[0].permission = 'read';
    expect(validateDispatch(data, request())).toMatch(/Schreibzugriff/);
    data.repos[0].permission = 'write';
    data.workflows[0].refs = ['develop'];
    expect(validateDispatch(data, request({ ref: 'develop' }))).toMatch(
      /Standardbranch/,
    );
  });
  it('checks number and environment inputs with exact values', () => {
    const data = snapshot();
    const base = request({
      accountId: 'demo-work',
      repoId: 'demo-team-tools',
      workflowId: 201,
      inputs: { attempts: 3 },
    });
    expect(validateDispatch(data, base)).toBeNull();
    for (const value of [Infinity, NaN, '3', false])
      expect(
        validateDispatch(data, { ...base, inputs: { attempts: value } }),
      ).toMatch(/muss eine Zahl sein/);
    data.workflows[1].inputs = [
      {
        name: 'environment',
        label: 'Environment',
        type: 'environment',
        required: true,
        options: ['preview', 'staging'],
      },
    ];
    data.workflows[1].dispatch = true;
    expect(
      validateDispatch(
        data,
        request({ workflowId: 102, inputs: { environment: 'production' } }),
      ),
    ).toMatch(/verfügbaren Wert/);
    expect(
      validateDispatch(
        data,
        request({ workflowId: 102, inputs: { environment: 'staging' } }),
      ),
    ).toBeNull();
  });
});

describe('safe pins', () => {
  it('whitelists persisted pin fields and blocks credential-named inputs', () => {
    const data = snapshot();
    const pin = { ...data.pins[0], label: '  My build  ', token: 'never-copy' };
    expect(safePin(data, pin)).toEqual({ ...data.pins[0], label: 'My build' });
    const workflow: Workflow = data.workflows[0];
    workflow.inputs.push({
      name: 'api_token',
      label: 'Token',
      type: 'string',
      required: false,
      options: [],
    });
    expect(() =>
      safePin(data, {
        ...data.pins[0],
        inputs: { ...data.pins[0].inputs, api_token: 'secret' },
      }),
    ).toThrow(/Geheime/);
    expect(() => safePin(data, { ...data.pins[0], label: ' ' })).toThrow(
      /Namen/,
    );
    expect(
      safePin(data, { ...data.pins[0], quickStart: 'yes' } as unknown as Pin)
        .quickStart,
    ).toBe(false);
  });
});

describe('stale UI response guard', () => {
  it('ignores responses from earlier account/repository selections and closed dialogs', async () => {
    const epochs = new RequestEpoch();
    const changes: string[] = [];
    let finish: (() => void) | undefined;
    const first = epochs.next();
    const delayed = new Promise<void>((resolve) => {
      finish = resolve;
    }).then(() => {
      if (epochs.current(first)) changes.push('stale');
    });
    const current = epochs.next();
    expect(epochs.current(current)).toBe(true);
    finish!();
    await delayed;
    expect(changes).toEqual([]);
    epochs.invalidate(); // closing a dialog or changing account invalidates its response
    expect(epochs.current(current)).toBe(false);
  });
});
