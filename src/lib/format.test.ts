import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { get } from 'svelte/store';
import { minuteClock } from './clock';
import { setLocale } from './i18n/index.svelte';
import {
  accountLabel,
  avatarLetter,
  clockTime,
  dateTime,
  errorMessage,
  fallbackError,
  ipcErrorMessage,
  lastRunMoment,
  plural,
  relativeTime,
  repoLabel,
  runDuration,
  runMoment,
} from './format';
import type { Account, Repo, Run } from './types';

// Synthetic fixtures only.
const repo: Repo = {
  id: 'demo-repo',
  accountId: 'demo-personal',
  owner: 'demo-dev',
  name: 'sample-demo',
  defaultBranch: 'main',
  pushedAt: null,
  selected: true,
  permission: 'write',
};
const account: Account = {
  id: 'demo-personal',
  login: 'demo-dev',
  label: 'GitHub · Personal · demo',
};

describe('errorMessage', () => {
  it('prefers an Error message, then an IPC string', () => {
    expect(errorMessage(new Error('Kaputt.'))).toBe('Kaputt.');
    expect(errorMessage('IPC-Fehler.')).toBe('IPC-Fehler.');
  });
  it('falls back for anything else', () => {
    expect(errorMessage({ code: 1 })).toBe(fallbackError());
    expect(errorMessage(undefined, 'Eigener Text.')).toBe('Eigener Text.');
  });
});

describe('ipcErrorMessage', () => {
  it('shows the native error string', () => {
    expect(ipcErrorMessage('Token wurde abgelehnt.')).toBe(
      'Token wurde abgelehnt.',
    );
  });
  it('never shows JavaScript internals, blank strings or other values', () => {
    expect(
      ipcErrorMessage(new TypeError('x is undefined'), 'Eigener Text.'),
    ).toBe('Eigener Text.');
    expect(ipcErrorMessage('  ', 'Eigener Text.')).toBe('Eigener Text.');
    expect(ipcErrorMessage({ code: 1 })).toBe(fallbackError());
    expect(ipcErrorMessage(undefined)).toBe(fallbackError());
  });
});

describe('plural', () => {
  it('uses the singular only for exactly one', () => {
    expect(plural(1, 'Repository', 'Repositories')).toBe('1 Repository');
    expect(plural(1, 'Konto', 'Konten')).toBe('1 Konto');
  });
  it('uses the plural for zero and several', () => {
    expect(plural(0, 'Konto', 'Konten')).toBe('0 Konten');
    expect(plural(2, 'Repository', 'Repositories')).toBe('2 Repositories');
    expect(plural(12, 'Run', 'Runs')).toBe('12 Runs');
  });
});

describe('clockTime', () => {
  it('formats local time as two-digit hours and minutes', () => {
    expect(clockTime(new Date(2026, 4, 1, 9, 5))).toBe('09:05');
    expect(clockTime(new Date(2026, 4, 1, 21, 40).toISOString())).toBe('21:40');
  });
  it('defaults to the current time', () => {
    expect(clockTime()).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('repoLabel and accountLabel', () => {
  const snapshot = { repos: [repo], accounts: [account] };
  it('names known repositories and accounts', () => {
    expect(repoLabel(snapshot, 'demo-repo')).toBe('demo-dev/sample-demo');
    expect(accountLabel(snapshot, 'demo-personal', false)).toBe('demo-dev');
    expect(accountLabel(snapshot, 'demo-personal', true)).toBe(
      'demo-dev · Personal · demo',
    );
  });
  it('labels missing entries without throwing', () => {
    expect(repoLabel(snapshot, 'missing')).toBe('Repository nicht verfügbar');
    expect(repoLabel(null, 'demo-repo')).toBe('Repository nicht verfügbar');
    expect(accountLabel(undefined, '', true)).toBe('Kein aktives Konto');
  });
});

describe('avatarLetter', () => {
  it('uses the upper-cased first login letter', () => {
    expect(avatarLetter('team-demo', 'A')).toBe('T');
    expect(avatarLetter('demo-dev', 'A')).toBe('D');
  });
  it('guards empty or missing logins', () => {
    expect(avatarLetter('', '?')).toBe('?');
    expect(avatarLetter(undefined, 'A')).toBe('A');
  });
});

describe('relative run times', () => {
  // Mid-June keeps every time zone clear of a daylight-saving switch.
  const noon = new Date(2026, 5, 17, 12, 0);
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 5, day, hour, minute).toISOString();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(noon);
  });
  afterEach(() => vi.useRealTimers());

  it('counts minutes, then hours, as the clock advances', () => {
    const started = at(17, 12);
    expect(relativeTime(started)).toBe('gerade eben');
    vi.advanceTimersByTime(59_000);
    expect(relativeTime(started)).toBe('gerade eben');
    vi.advanceTimersByTime(1_000);
    expect(relativeTime(started)).toBe('vor 1 Min.');
    vi.advanceTimersByTime(58 * 60_000);
    expect(relativeTime(started)).toBe('vor 59 Min.');
    vi.advanceTimersByTime(60_000);
    expect(relativeTime(started)).toBe('vor 1 Std.');
    vi.advanceTimersByTime(22 * 3_600_000 + 59 * 60_000);
    expect(relativeTime(started)).toBe('vor 23 Std.');
    vi.advanceTimersByTime(60_000);
    expect(relativeTime(started)).toBe('gestern');
  });
  it('says „gestern“ for the previous calendar day, then days, then the date', () => {
    expect(relativeTime(at(16, 13))).toBe('vor 23 Std.');
    expect(relativeTime(at(16, 11))).toBe('gestern');
    expect(relativeTime(at(16, 0, 5))).toBe('gestern');
    expect(relativeTime(at(15, 23, 59))).toBe('vor 2 Tagen');
    expect(relativeTime(at(14, 12))).toBe('vor 3 Tagen');
    expect(relativeTime(at(11, 0, 1))).toBe('vor 6 Tagen');
    expect(relativeTime(at(10, 23, 59))).toBe('10.06.2026');
    vi.setSystemTime(new Date(2026, 5, 17, 0, 30));
    expect(relativeTime(at(16, 0, 10))).toBe('gestern');
    expect(relativeTime(at(15, 23))).toBe('vor 2 Tagen');
    expect(relativeTime(at(11, 0))).toBe('vor 6 Tagen');
    expect(relativeTime(at(10, 23, 59))).toBe('10.06.2026');
    // Calendar days, not 24-hour spans: late yesterday and early today.
    vi.setSystemTime(new Date(2026, 5, 17, 23, 59));
    expect(relativeTime(at(15, 0, 1))).toBe('vor 2 Tagen');
    expect(relativeTime(at(10, 23, 59))).toBe('10.06.2026');
  });
  it('reads future times as „gerade eben“ and invalid ones as empty', () => {
    expect(relativeTime(at(17, 12, 5))).toBe('gerade eben');
    expect(relativeTime('kein Datum')).toBe('');
  });
  it('formats the absolute local date and time', () => {
    expect(dateTime(new Date(2026, 5, 17, 9, 5))).toBe('17.06.2026, 09:05');
  });

  const run = (overrides: Partial<Run>): Run => ({
    id: 42,
    repoId: 'demo-repo',
    workflowId: 7,
    name: 'Build',
    branch: 'main',
    status: 'in_progress',
    conclusion: null,
    createdAt: at(17, 11, 57),
    updatedAt: at(17, 11, 58),
    htmlUrl: '',
    ...overrides,
  });
  it('dates an open run by its start and a completed run by its end', () => {
    expect(runMoment(run({}), Date.now())).toEqual({
      datetime: at(17, 11, 57),
      relative: 'vor 3 Min.',
      title: 'Gestartet: 17.06.2026, 11:57',
      spoken: 'gestartet vor 3 Min.',
    });
    const done = run({
      status: 'completed',
      conclusion: 'success',
      createdAt: at(15, 8),
      updatedAt: at(15, 9),
    });
    expect(runMoment(done, Date.now(), true)).toEqual({
      datetime: at(15, 9),
      relative: 'vor 2 Tagen',
      title: 'Beendet: 15.06.2026, 09:00 · Demo-Zeit',
      spoken: 'beendet vor 2 Tagen',
    });
    const old = run({
      status: 'completed',
      conclusion: 'success',
      createdAt: at(8, 8),
      updatedAt: at(8, 9),
    });
    expect(runMoment(old, Date.now()).spoken).toBe('beendet am 08.06.2026');
  });
  it('says when a scope last ran, or that it runs right now', () => {
    expect(
      lastRunMoment({ at: at(14, 9, 30), active: false }, Date.now()),
    ).toEqual({
      datetime: at(14, 9, 30),
      relative: 'vor 3 Tagen',
      title: 'Letzter Run: 14.06.2026, 09:30',
      summary: 'Letzter Run: 14.06.2026, 09:30',
    });
    expect(
      lastRunMoment({ at: at(1, 8), active: false }, Date.now(), true),
    ).toMatchObject({
      relative: '01.06.2026',
      title: 'Letzter Run: 01.06.2026, 08:00 · Demo-Zeit',
    });
    expect(
      lastRunMoment({ at: at(17, 11, 57), active: true }, Date.now()),
    ).toMatchObject({
      relative: 'vor 3 Min.',
      summary: 'Läuft gerade · Letzter Run: 17.06.2026, 11:57',
    });
  });
  it('counts open runs in whole minutes and lets only live ones run on', () => {
    const open = run({});
    expect(runDuration(open, Date.now(), true)).toBe('3 min');
    expect(runDuration(open, Date.now(), false)).toBe('1 min');
    // Seconds would freeze between minute ticks, so they are cut, not shown.
    expect(runDuration(open, Date.now() + 59_000, true)).toBe('3 min');
    const fresh = run({ createdAt: at(17, 12), updatedAt: at(17, 12) });
    expect(runDuration(fresh, Date.now() + 59_000, true)).toBe('< 1 min');
    // Clock skew (created after now) clamps to under a minute.
    expect(
      runDuration(run({ createdAt: at(17, 12, 1) }), Date.now(), true),
    ).toBe('< 1 min');
    // A snapshot newer than the last tick never makes the duration shrink.
    const ahead = run({ updatedAt: at(17, 12, 2) });
    expect(runDuration(ahead, Date.now(), true)).toBe('5 min');
  });
  it('keeps m:ss for completed runs', () => {
    const done = run({
      status: 'completed',
      conclusion: 'failure',
      updatedAt: new Date(Date.parse(at(17, 11, 58)) + 5_000).toISOString(),
    });
    expect(runDuration(done, Date.now(), true)).toBe('1:05 min');
    expect(runDuration(done, Date.now(), false)).toBe('1:05 min');
  });

  it('ticks one shared minute clock that stops with its last subscriber', () => {
    const seen: number[] = [];
    const first = minuteClock.subscribe((value) => seen.push(value));
    const second = minuteClock.subscribe(() => {});
    expect(vi.getTimerCount()).toBe(1);
    expect(seen.at(-1)).toBe(noon.getTime());
    vi.advanceTimersByTime(60_000);
    expect(seen.at(-1)).toBe(noon.getTime() + 60_000);
    first();
    expect(vi.getTimerCount()).toBe(1);
    second();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('lets a view that joins a running clock catch up at once', async () => {
    const seen: number[] = [];
    const overview = minuteClock.subscribe((value) => seen.push(value));
    vi.setSystemTime(noon.getTime() + 45_000);
    const page = minuteClock.subscribe(() => {});
    // No tick is due yet; the new reader still gets the current time.
    expect(vi.getTimerCount()).toBe(1);
    await Promise.resolve();
    expect(seen.at(-1)).toBe(noon.getTime() + 45_000);
    // The next tick counts from the catch-up, still on one shared timer.
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(59_000);
    expect(seen.at(-1)).toBe(noon.getTime() + 45_000);
    vi.advanceTimersByTime(1_000);
    expect(seen.at(-1)).toBe(noon.getTime() + 105_000);
    overview();
    page();
  });
  it('moves relative times and live durations with each tick', () => {
    const open = run({ createdAt: at(17, 12), updatedAt: at(17, 12) });
    const stop = minuteClock.subscribe(() => {});
    expect(relativeTime(open.createdAt, get(minuteClock))).toBe('gerade eben');
    vi.advanceTimersByTime(3 * 60_000);
    expect(relativeTime(open.createdAt, get(minuteClock))).toBe('vor 3 Min.');
    expect(runDuration(open, get(minuteClock), true)).toBe('3 min');
    stop();
  });
});

describe('relative run times across a daylight-saving switch', () => {
  // Node re-reads TZ on assignment; restore it for the rest of the file.
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Europe/Berlin';
  });
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it('keeps hours for earlier the same day on the 25-hour day', () => {
    // 25.10.2026 23:30 CET; 00:10 that day was still CEST (24 h 20 min ago).
    const now = Date.parse('2026-10-25T22:30:00Z');
    expect(new Date(now).getHours()).toBe(23);
    expect(relativeTime('2026-10-24T22:10:00Z', now)).toBe('vor 24 Std.');
    // 24.10. 23:50 CEST is the previous calendar day.
    expect(relativeTime('2026-10-24T21:50:00Z', now)).toBe('gestern');
  });
  it('keeps „gestern“ and hours right on the 23-hour day', () => {
    // 29.03.2026 23:30 CEST; 00:10 that day was CET (22 h 20 min ago).
    const now = Date.parse('2026-03-29T21:30:00Z');
    expect(relativeTime('2026-03-28T23:10:00Z', now)).toBe('vor 22 Std.');
    // 28.03. 00:10 CET: 46 h 20 min ago, still the previous calendar day.
    expect(relativeTime('2026-03-27T23:10:00Z', now)).toBe('gestern');
    expect(relativeTime('2026-03-27T22:50:00Z', now)).toBe('vor 2 Tagen');
  });
  it('counts calendar days across both switches', () => {
    // 30.03.2026 00:30 CEST; 24.03. 00:10 CET is six calendar days back,
    // although the 23-hour day makes it 5 days 23 h 20 min.
    const spring = Date.parse('2026-03-29T22:30:00Z');
    expect(relativeTime('2026-03-23T23:10:00Z', spring)).toBe('vor 6 Tagen');
    expect(relativeTime('2026-03-23T22:50:00Z', spring)).toBe('23.03.2026');
    // 31.10.2026 23:30 CET; 25.10. 00:10 CEST is six calendar days back,
    // although the 25-hour day makes it 7 days 20 min.
    const autumn = Date.parse('2026-10-31T22:30:00Z');
    expect(relativeTime('2026-10-24T22:10:00Z', autumn)).toBe('vor 6 Tagen');
    expect(relativeTime('2026-10-24T21:50:00Z', autumn)).toBe('24.10.2026');
  });
});

describe('format in English', () => {
  const noon = new Date(2026, 5, 17, 12, 0);
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 5, day, hour, minute).toISOString();
  beforeEach(() => {
    setLocale('en');
    vi.useFakeTimers();
    vi.setSystemTime(noon);
  });
  afterEach(() => {
    vi.useRealTimers();
    setLocale('de');
  });

  it('reads relative times, dates and labels in English', () => {
    expect(relativeTime(at(17, 12))).toBe('just now');
    expect(relativeTime(at(17, 11, 57))).toBe('3 min ago');
    expect(relativeTime(at(17, 9))).toBe('3 h ago');
    expect(relativeTime(at(16, 11))).toBe('yesterday');
    expect(relativeTime(at(14, 12))).toBe('3 days ago');
    expect(relativeTime(at(10, 23, 59))).toBe('06/10/2026');
    expect(repoLabel(null, 'x')).toBe('Repository unavailable');
    expect(accountLabel(undefined, '', true)).toBe('No active account');
    expect(errorMessage({ code: 1 })).toBe(
      'The operation could not be completed. Try again.',
    );
  });
  it('names run moments in English, with „on“ only before a date', () => {
    const base: Run = {
      id: 42,
      repoId: 'demo-repo',
      workflowId: 7,
      name: 'Build',
      branch: 'main',
      status: 'in_progress',
      conclusion: null,
      createdAt: at(17, 11, 57),
      updatedAt: at(17, 11, 58),
      htmlUrl: '',
    };
    expect(runMoment(base, Date.now()).spoken).toBe('started 3 min ago');
    const old = {
      ...base,
      status: 'completed' as const,
      conclusion: 'success' as const,
      updatedAt: at(8, 9),
    };
    expect(runMoment(old, Date.now(), true)).toMatchObject({
      spoken: 'finished on 06/08/2026',
      title: 'Finished: 06/08/2026, 09:00 AM · demo time',
    });
    expect(
      lastRunMoment({ at: at(17, 11, 57), active: true }, Date.now()),
    ).toMatchObject({
      summary: 'Running now · Last run: 06/17/2026, 11:57 AM',
    });
  });
});
