import { accountTitle } from './accountSelection';
import { fullRepo } from './model';
import { duration, isActive } from './runs';
import type { Run, Snapshot } from './types';

export const FALLBACK_ERROR =
  'Der Vorgang konnte nicht abgeschlossen werden. Versuche es erneut.';

/** User-facing text for a rejection: an Error's message, an IPC error string, or a fallback. */
export function errorMessage(cause: unknown, fallback = FALLBACK_ERROR) {
  return cause instanceof Error
    ? cause.message
    : typeof cause === 'string'
      ? cause
      : fallback;
}

/** A count with its German noun form, e.g. `1 Repository` or `3 Repositories`. */
export function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Local wall-clock time as `HH:MM` (de-DE); defaults to now. */
export function clockTime(value: string | number | Date = new Date()) {
  return new Date(value).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Local date and time as `01.11.2026, 09:42` (de-DE). */
export function dateTime(value: string | number | Date) {
  return new Date(value).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const dayStart = (time: number) => new Date(time).setHours(0, 0, 0, 0);

/**
 * German relative time: „gerade eben“, „vor 3 Min.“, „vor 2 Std.“ (under a
 * day, or earlier the same calendar day: a 25-hour DST day reaches „vor 24
 * Std.“), „gestern“ (the previous calendar day), then the date. A time ahead
 * of `now` (clock skew, a stale tick) reads „gerade eben“.
 */
export function relativeTime(
  value: string | number | Date,
  now: number = Date.now(),
) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';
  const elapsed = now - time;
  if (elapsed < MINUTE) return 'gerade eben';
  if (elapsed < HOUR) return `vor ${Math.floor(elapsed / MINUTE)} Min.`;
  if (elapsed < DAY || dayStart(time) === dayStart(now))
    return `vor ${Math.floor(elapsed / HOUR)} Std.`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayStart(time) === dayStart(yesterday.getTime())) return 'gestern';
  return new Date(time).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** When an open run started or a completed run finished, for a `<time>` element. */
export function runMoment(run: Run, now: number, demo = false) {
  const active = isActive(run);
  const at = active ? run.createdAt : run.updatedAt;
  const relative = relativeTime(at, now);
  const verb = active ? 'Gestartet' : 'Beendet';
  return {
    datetime: at,
    relative,
    title: `${verb}: ${dateTime(at)}${demo ? ' · Demo-Zeit' : ''}`,
    /** For the row's accessible name, e.g. „gestartet vor 3 Min.“. */
    spoken: `${verb.toLowerCase()} ${/^\d/.test(relative) ? 'am ' : ''}${relative}`,
  };
}

/**
 * Run time. A completed run reads `m:ss min`; an open run reads whole minutes
 * („< 1 min“, „3 min“), since the shared clock ticks once a minute and seconds
 * would stand still. A live open run keeps counting up to `now`.
 */
export function runDuration(run: Run, now: number, live: boolean) {
  if (!isActive(run)) return duration(run);
  const updated = Date.parse(run.updatedAt);
  const end = live && now > updated ? now : updated;
  const elapsed = end - Date.parse(run.createdAt);
  const minutes = elapsed > 0 ? Math.floor(elapsed / MINUTE) : 0;
  return minutes < 1 ? '< 1 min' : `${minutes} min`;
}

export function repoLabel(
  snapshot: Pick<Snapshot, 'repos'> | null | undefined,
  id: string,
) {
  const repo = snapshot?.repos.find((item) => item.id === id);
  return repo ? fullRepo(repo) : 'Repository nicht verfügbar';
}

/** Native shows login and sign-in source; the demo shows the bare login. */
export function accountLabel(
  snapshot: Pick<Snapshot, 'accounts'> | null | undefined,
  id: string,
  native: boolean,
) {
  const account = snapshot?.accounts.find((item) => item.id === id);
  return account
    ? native
      ? accountTitle(account)
      : account.login
    : 'Kein aktives Konto';
}

/** First letter of a login for avatar badges; an empty or missing login gets the fallback. */
export function avatarLetter(
  login: string | null | undefined,
  fallback: string,
) {
  return login?.charAt(0).toUpperCase() || fallback;
}
