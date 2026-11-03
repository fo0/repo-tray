import { describe, expect, it } from 'vitest';
import { createDemoBridge, type PreferenceStorage } from './demo';
import {
  demoRefresh,
  formatRefresh,
  presetIndex,
  REFRESH_DEFAULT,
  REFRESH_ERROR,
  REFRESH_KEY,
  REFRESH_PRESETS,
  validRefresh,
} from './refresh';
import { RefreshChoice } from './refresh.svelte';

function memory(seed: Record<string, string> = {}): PreferenceStorage & {
  items: Map<string, string>;
} {
  const items = new Map(Object.entries(seed));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

describe('refresh interval values', () => {
  it('accepts whole seconds from 15 to 3600 only', () => {
    for (const value of [15, 60, 90, 3600])
      expect(validRefresh(value)).toBe(true);
    for (const value of [14, 3601, 60.5, Number.NaN, '60', null])
      expect(validRefresh(value)).toBe(false);
  });
  it('names a value in seconds and minutes', () => {
    expect(formatRefresh(15)).toBe('15 s');
    expect(formatRefresh(60)).toBe('1 min');
    expect(formatRefresh(90)).toBe('1 min 30 s');
    expect(formatRefresh(1800)).toBe('30 min');
  });
  it('puts a value on its preset or the nearest one', () => {
    expect(REFRESH_PRESETS[presetIndex(REFRESH_DEFAULT)]).toBe(60);
    expect(REFRESH_PRESETS[presetIndex(90)]).toBe(60);
    expect(REFRESH_PRESETS[presetIndex(3600)]).toBe(1800);
    expect(REFRESH_PRESETS[presetIndex(15)]).toBe(15);
  });
});

describe('demo refresh interval', () => {
  it('defaults, validates and keeps a saved value across bridges', async () => {
    const storage = memory();
    const bridge = createDemoBridge(storage, 0);
    expect(await bridge.refreshInterval()).toBe(REFRESH_DEFAULT);
    await expect(bridge.setRefreshInterval(14)).rejects.toThrow(REFRESH_ERROR);
    await expect(bridge.setRefreshInterval(3601)).rejects.toThrow(
      REFRESH_ERROR,
    );
    expect(await bridge.setRefreshInterval(300)).toBe(300);
    expect(await createDemoBridge(storage, 0).refreshInterval()).toBe(300);
  });
  it('ignores a corrupt stored value and works without storage', async () => {
    const corrupt = demoRefresh(memory({ [REFRESH_KEY]: '{"nope"' }));
    expect(await corrupt.refreshInterval()).toBe(REFRESH_DEFAULT);
    const foreign = demoRefresh(memory({ [REFRESH_KEY]: '5' }));
    expect(await foreign.refreshInterval()).toBe(REFRESH_DEFAULT);
    const blocked = demoRefresh({
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => undefined,
    });
    expect(await blocked.setRefreshInterval(120)).toBe(120);
    expect(await blocked.refreshInterval()).toBe(120);
  });
});

describe('RefreshChoice', () => {
  it('stages a value and writes it only with apply', async () => {
    const port = demoRefresh();
    const choice = new RefreshChoice(port);
    await choice.read();
    expect(choice.value).toBe(60);
    choice.stage(300);
    expect(choice.pending).toBe(true);
    expect(await port.refreshInterval()).toBe(60);
    await choice.apply();
    expect(await port.refreshInterval()).toBe(300);
    expect(choice.pending).toBe(false);
    // Staging the saved value again is no change.
    choice.stage(120);
    choice.stage(300);
    expect(choice.pending).toBe(false);
  });
  it('blocks an invalid own value and never sends it', async () => {
    let sent = 0;
    const choice = new RefreshChoice({
      refreshInterval: async () => 60,
      setRefreshInterval: async (seconds) => (sent++, seconds),
    });
    await choice.read();
    choice.stage(Number.NaN);
    expect(choice.invalid).toBe(true);
    choice.stage(5);
    expect(choice.invalid).toBe(true);
    await expect(choice.apply()).rejects.toThrow(REFRESH_ERROR);
    expect(sent).toBe(0);
    choice.stage(45);
    expect(choice.invalid).toBe(false);
    await choice.apply();
    expect(sent).toBe(1);
    expect(choice.saved).toBe(45);
  });
  it('shows the default when the shell answers nothing usable', async () => {
    const choice = new RefreshChoice({
      refreshInterval: async () => null as unknown as number,
      setRefreshInterval: async (seconds) => seconds,
    });
    await choice.read();
    expect(choice.saved).toBe(REFRESH_DEFAULT);
    const failing = new RefreshChoice({
      refreshInterval: () => Promise.reject('Dienst nicht verfügbar.'),
      setRefreshInterval: () =>
        Promise.reject('Einstellung konnte nicht gespeichert werden.'),
    });
    await failing.read();
    expect(failing.value).toBe(REFRESH_DEFAULT);
    failing.stage(120);
    await expect(failing.apply()).rejects.toBe(
      'Einstellung konnte nicht gespeichert werden.',
    );
    expect(failing.pending).toBe(true);
  });
});
