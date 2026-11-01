import { describe, expect, it } from 'vitest';
import {
  accountLabel,
  avatarLetter,
  clockTime,
  errorMessage,
  FALLBACK_ERROR,
  plural,
  repoLabel,
} from './format';
import { targetKey } from './model';
import type { Account, DispatchRequest, Repo } from './types';

// Synthetic fixtures only.
const repo: Repo = {
  id: 'demo-repo',
  accountId: 'demo-personal',
  owner: 'demo-dev',
  name: 'sample-demo',
  defaultBranch: 'main',
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
    expect(errorMessage({ code: 1 })).toBe(FALLBACK_ERROR);
    expect(errorMessage(undefined, 'Eigener Text.')).toBe('Eigener Text.');
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

describe('targetKey', () => {
  const target = {
    accountId: 'demo-personal',
    repoId: 'demo-repo',
    workflowId: 7,
    ref: 'main',
  };
  it('ignores inputs and request IDs', () => {
    const request: DispatchRequest = {
      ...target,
      inputs: { a: 1 },
      requestId: 'x',
    };
    expect(targetKey(request)).toBe(targetKey(target));
  });
  it('distinguishes every target field', () => {
    const base = targetKey(target);
    expect(targetKey({ ...target, ref: 'release' })).not.toBe(base);
    expect(targetKey({ ...target, workflowId: 8 })).not.toBe(base);
    expect(targetKey({ ...target, repoId: 'other' })).not.toBe(base);
    expect(targetKey({ ...target, accountId: 'demo-work' })).not.toBe(base);
  });
});
