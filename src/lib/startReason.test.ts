import { describe, expect, it } from 'vitest';
import {
  blockedReason,
  favoriteNames,
  START_REASONS,
  startGate,
  startReason,
} from './startReason';
import type { Snapshot } from './types';

describe('startReason', () => {
  it('names one cause, the most basic first', () => {
    const blocked = START_REASONS.offline;
    expect(
      startReason({
        manual: true,
        readOnly: true,
        blocked,
        running: true,
        uncertain: true,
      }),
    ).toBe('Kein manueller Start');
    expect(startReason({ readOnly: true, blocked })).toBe(
      'Kein Schreibzugriff auf dieses Repository',
    );
    expect(startReason({ blocked, running: true })).toBe(
      'Offline – Starts sind deaktiviert',
    );
    expect(startReason({ running: true, uncertain: true })).toBe(
      'Start läuft …',
    );
    expect(startReason({ uncertain: true })).toBe(
      'Startstatus ungeklärt – prüfe die Runs auf GitHub',
    );
    expect(startReason({})).toBe(null);
  });

  it('derives the global block from connectivity', () => {
    const snapshot = (connectivity: Snapshot['connectivity']) =>
      ({ connectivity }) as Snapshot;
    expect(blockedReason(snapshot('online'))).toBe(null);
    expect(blockedReason(snapshot('offline'))).toBe(START_REASONS.offline);
    expect(blockedReason(snapshot('forbidden'))).toBe(START_REASONS.forbidden);
    expect(blockedReason(null)).toBe(START_REASONS.offline);
  });
});

describe('favoriteNames', () => {
  it('leads every name with the repository, then the favorite', () => {
    expect(favoriteNames('launch-kit-demo', 'Release')).toEqual({
      open: 'launch-kit-demo · Release starten…',
      quickStart: 'launch-kit-demo · Release schnellstarten',
      remove: 'launch-kit-demo · Release aus Favoriten entfernen',
      uncertain: 'Startstatus ungeklärt: launch-kit-demo · Release',
    });
  });

  it('tells two favorites with the same label apart by repository', () => {
    const site = favoriteNames('website-demo', 'Release');
    const kit = favoriteNames('launch-kit-demo', 'Release');
    for (const key of ['open', 'quickStart', 'remove', 'uncertain'] as const)
      expect(site[key]).not.toBe(kit[key]);
  });
});

describe('startGate', () => {
  const blocked = START_REASONS.offline;

  it('refuses a quick start for every cause, the lock included', () => {
    expect(startGate({ uncertain: true }, 'quick')).toMatchObject({
      reason: START_REASONS.uncertain,
      canStart: false,
      canOpen: true,
    });
    expect(startGate({ blocked }, 'quick').reason).toBe(blocked);
    expect(startGate({ readOnly: true }, 'quick').reason).toBe(
      START_REASONS.readOnly,
    );
    expect(startGate({}, 'quick').canStart).toBe(true);
  });

  it('refuses a workflow row’s „Starten…“ for every cause but the lock', () => {
    expect(startGate({ manual: true }, 'workflow').reason).toBe(
      START_REASONS.manual,
    );
    expect(startGate({ blocked, uncertain: true }, 'workflow').reason).toBe(
      blocked,
    );
    expect(startGate({ uncertain: true }, 'workflow')).toMatchObject({
      reason: null,
      canStart: true,
    });
  });

  it('opens a favorite’s dialog offline and locked, only not while it starts', () => {
    expect(
      startGate({ blocked, readOnly: true, uncertain: true }, 'favorite'),
    ).toMatchObject({ reason: null, canStart: true });
    expect(startGate({ running: true }, 'favorite').reason).toBe(
      START_REASONS.running,
    );
  });

  it('closes the dialog and the favorite change only while the target starts', () => {
    expect(startGate({ running: true, blocked }, 'workflow')).toMatchObject({
      canOpen: false,
      openReason: START_REASONS.running,
      canRemove: false,
    });
    expect(startGate({ blocked, uncertain: true }, 'quick')).toMatchObject({
      canOpen: true,
      openReason: null,
      canRemove: true,
    });
    expect(startGate({ busy: true }, 'quick').canRemove).toBe(false);
  });
});
