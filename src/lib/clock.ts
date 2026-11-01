import { readable } from 'svelte/store';

export const MINUTE = 60_000;

/**
 * Wall-clock time in milliseconds for relative times and running durations.
 * One shared interval serves every subscriber; it starts with the first one
 * and stops with the last, so rows never own timers. A panel that becomes
 * visible again catches up immediately instead of waiting for the next tick.
 */
export const minuteClock = readable(Date.now(), (set) => {
  const tick = () => set(Date.now());
  tick();
  const timer = setInterval(tick, MINUTE);
  const visible = () => {
    if (document.visibilityState === 'visible') tick();
  };
  const watchesVisibility = typeof document !== 'undefined';
  if (watchesVisibility) document.addEventListener('visibilitychange', visible);
  return () => {
    clearInterval(timer);
    if (watchesVisibility)
      document.removeEventListener('visibilitychange', visible);
  };
});
