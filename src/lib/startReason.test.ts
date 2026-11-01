import { describe, expect, it } from 'vitest';
import { blockedReason, START_REASONS, startReason } from './startReason';
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
