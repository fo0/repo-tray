import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from './i18n/index.svelte';
import {
  blockedReason,
  favoriteNames,
  startReasons,
  startGate,
  startReason,
} from './startReason';
import type { Snapshot } from './types';

describe('startReason', () => {
  it('names one cause, the most basic first', () => {
    const blocked = startReasons().offline;
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
    expect(blockedReason(snapshot('offline'))).toBe(startReasons().offline);
    expect(blockedReason(snapshot('forbidden'))).toBe(startReasons().forbidden);
    expect(blockedReason(null)).toBe(startReasons().offline);
  });
});

describe('favoriteNames', () => {
  it('leads every name with the repository, then the favorite', () => {
    expect(favoriteNames('launch-kit-demo', 'Release')).toEqual({
      open: 'launch-kit-demo · Release starten…',
      start: 'launch-kit-demo · Release jetzt starten',
      edit: 'launch-kit-demo · Release bearbeiten',
      remove: 'launch-kit-demo · Release aus Favoriten entfernen',
      uncertain: 'Startstatus ungeklärt: launch-kit-demo · Release',
    });
  });

  it('tells two favorites with the same label apart by repository', () => {
    const site = favoriteNames('website-demo', 'Release');
    const kit = favoriteNames('launch-kit-demo', 'Release');
    for (const key of ['open', 'start', 'edit', 'remove', 'uncertain'] as const)
      expect(site[key]).not.toBe(kit[key]);
  });
});

describe('startGate', () => {
  const blocked = startReasons().offline;

  it('refuses a favorite’s direct start for every cause, the lock included', () => {
    expect(startGate({ uncertain: true }, 'favorite')).toMatchObject({
      reason: startReasons().uncertain,
      canStart: false,
      canOpen: true,
    });
    expect(startGate({ blocked }, 'favorite').reason).toBe(blocked);
    expect(startGate({ readOnly: true }, 'favorite').reason).toBe(
      startReasons().readOnly,
    );
    expect(startGate({}, 'favorite').canStart).toBe(true);
  });

  it('refuses a workflow row’s „Starten…“ for every cause but the lock', () => {
    expect(startGate({ manual: true }, 'workflow').reason).toBe(
      startReasons().manual,
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
    ).toMatchObject({ canStart: false, canOpen: true, openReason: null });
    expect(startGate({ running: true }, 'favorite')).toMatchObject({
      reason: startReasons().running,
      canOpen: false,
    });
  });

  it('closes the dialog and the favorite change only while the target starts', () => {
    expect(startGate({ running: true, blocked }, 'workflow')).toMatchObject({
      canOpen: false,
      openReason: startReasons().running,
      canRemove: false,
    });
    expect(startGate({ blocked, uncertain: true }, 'favorite')).toMatchObject({
      canOpen: true,
      openReason: null,
      canRemove: true,
    });
    expect(startGate({ busy: true }, 'favorite').canRemove).toBe(false);
  });
});

describe('in English', () => {
  afterEach(() => setLocale('de'));

  it('names the reason and the favorite controls in the language in effect', () => {
    setLocale('en');
    expect(startReason({ uncertain: true })).toBe(
      'Start status unknown – check the runs on GitHub',
    );
    expect(blockedReason(null)).toBe('Offline – starts are disabled');
    expect(startGate({ running: true }, 'workflow').openReason).toBe(
      'Starting …',
    );
    expect(favoriteNames('launch-kit-demo', 'Release')).toEqual({
      open: 'Start launch-kit-demo · Release…',
      start: 'Start launch-kit-demo · Release now',
      edit: 'Edit launch-kit-demo · Release',
      remove: 'Remove launch-kit-demo · Release from favorites',
      uncertain: 'Start status unknown: launch-kit-demo · Release',
    });
  });
});
