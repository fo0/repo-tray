import type { PreferenceStorage } from './demo';

/** Mirrors src-tauri/src/refresh_interval.rs. */
export const REFRESH_DEFAULT = 60;
export const REFRESH_MIN = 15;
export const REFRESH_MAX = 3600;
/** Slider stops in seconds; the default (1 min) is the recommended one. */
export const REFRESH_PRESETS = [15, 30, 60, 120, 300, 600, 1800] as const;
export const REFRESH_ERROR =
  'Aktualisierung muss zwischen 15 s und 60 min liegen.';
export const REFRESH_KEY = 'repowatch.demo.refresh.v1';

/** Whole seconds within 15–3600. */
export function validRefresh(seconds: unknown): seconds is number {
  return (
    typeof seconds === 'number' &&
    Number.isInteger(seconds) &&
    seconds >= REFRESH_MIN &&
    seconds <= REFRESH_MAX
  );
}

/** „15 s“, „1 min“, „1 min 30 s“. */
export function formatRefresh(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!minutes) return `${rest} s`;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** The slider stop for a value: its preset, else the nearest one. */
export function presetIndex(seconds: number): number {
  let best = 0;
  REFRESH_PRESETS.forEach((preset, index) => {
    const current = REFRESH_PRESETS[best] ?? preset;
    if (Math.abs(preset - seconds) < Math.abs(current - seconds)) best = index;
  });
  return best;
}

/** The browser demo's interval: kept in memory and, when allowed, in storage. */
export function demoRefresh(storage?: PreferenceStorage) {
  let seconds = REFRESH_DEFAULT;
  try {
    const stored: unknown = JSON.parse(storage?.getItem(REFRESH_KEY) ?? 'null');
    if (validRefresh(stored)) seconds = stored;
  } catch {
    /* Corrupt or unavailable storage keeps the default. */
  }
  return {
    refreshInterval: () => Promise.resolve(seconds),
    setRefreshInterval(next: number): Promise<number> {
      if (!validRefresh(next)) return Promise.reject(new Error(REFRESH_ERROR));
      seconds = next;
      try {
        storage?.setItem(REFRESH_KEY, JSON.stringify(next));
      } catch {
        /* The value still applies for this session. */
      }
      return Promise.resolve(seconds);
    },
  };
}
