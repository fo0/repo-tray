import { accountTitle } from './accountSelection';
import { intlLocale, m } from './i18n/index.svelte';
import { fullRepo } from './model';
import type { LastRun } from './repoActivity';
import { duration, isActive } from './runs';
import type { Run, Snapshot } from './types';

/** The generic failure text, in the language in effect. */
export const fallbackError = () => m().common.fallbackError;

/** User-facing text for a rejection: an Error's message, an IPC error string, or a fallback. */
export function errorMessage(cause: unknown, fallback = fallbackError()) {
  return cause instanceof Error
    ? cause.message
    : typeof cause === 'string'
      ? cause
      : fallback;
}

/**
 * User-facing text for a rejected native command. Tauri rejects with the Rust
 * error string (written for the user); an `Error` can only come from
 * JavaScript internals and would surface internals, so it and any other value
 * get the fallback. The demo bridge throws user-facing `Error`s and keeps
 * `errorMessage`.
 */
export function ipcErrorMessage(cause: unknown, fallback = fallbackError()) {
  return typeof cause === 'string' && cause.trim() ? cause : fallback;
}

/**
 * A count with the noun form the caller passes, e.g. `1 Repository` or
 * `3 Repositories`. Callers pass catalog texts; `m().common.count` covers
 * runs, favorites and repositories.
 */
export function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Local wall-clock time, e.g. `09:42` (de-DE); defaults to now. */
export function clockTime(value: string | number | Date = new Date()) {
  return new Date(value).toLocaleTimeString(intlLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Local date and time, e.g. `01.11.2026, 09:42` (de-DE). */
export function dateTime(value: string | number | Date) {
  return new Date(value).toLocaleString(intlLocale(), {
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
 * Relative time and whether it fell back to a date. German reads „gerade
 * eben“, „vor 3 Min.“, „vor 2 Std.“ (under a day, or earlier the same
 * calendar day: a 25-hour DST day reaches „vor 24 Std.“), „gestern“ (the
 * previous calendar day), „vor 2 Tagen“ up to „vor 6 Tagen“ (calendar days),
 * then the date. A time ahead of `now` (clock skew, a stale tick) reads
 * „gerade eben“.
 */
function relative(value: string | number | Date, now: number) {
  const time = new Date(value).getTime();
  const text = m().common.relative;
  const words = (word: string) => ({ text: word, date: false });
  if (Number.isNaN(time)) return words('');
  const elapsed = now - time;
  if (elapsed < MINUTE) return words(text.justNow);
  if (elapsed < HOUR) return words(text.minutes(Math.floor(elapsed / MINUTE)));
  if (elapsed < DAY || dayStart(time) === dayStart(now))
    return words(text.hours(Math.floor(elapsed / HOUR)));
  // Calendar days between both midnights; rounding absorbs a DST hour.
  const days = Math.round((dayStart(now) - dayStart(time)) / DAY);
  if (days <= 1) return words(text.yesterday);
  if (days <= 6) return words(text.days(days));
  return {
    text: new Date(time).toLocaleDateString(intlLocale(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }),
    date: true,
  };
}

/** Relative time in the language in effect; see `relative`. */
export function relativeTime(
  value: string | number | Date,
  now: number = Date.now(),
) {
  return relative(value, now).text;
}

/** When an open run started or a completed run finished, for a `<time>` element. */
export function runMoment(run: Run, now: number, demo = false) {
  const active = isActive(run);
  const at = active ? run.createdAt : run.updatedAt;
  const when = relative(at, now);
  const text = m().common;
  const verb = active ? text.moment.started : text.moment.finished;
  return {
    datetime: at,
    relative: when.text,
    title: `${verb}: ${dateTime(at)}${demo ? text.demoTime : ''}`,
    /** For the row's accessible name, e.g. „gestartet vor 3 Min.“. */
    spoken: text.moment.spoken(verb, when.text, when.date),
  };
}

/**
 * When a repository, workflow or favorite last ran, for a `<time>` element:
 * the start of its latest run. `summary` ends a row's tooltip, which is also
 * its accessible description, e.g. „Läuft gerade · Letzter Run: …“.
 */
export function lastRunMoment(last: LastRun, now: number, demo = false) {
  const text = m().common;
  const title = text.moment.lastRun(
    `${dateTime(last.at)}${demo ? text.demoTime : ''}`,
  );
  return {
    datetime: last.at,
    relative: relativeTime(last.at, now),
    title,
    summary: last.active ? text.moment.runningNow(title) : title,
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
  return repo ? fullRepo(repo) : m().common.repoUnavailable;
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
    : m().common.noActiveAccount;
}

/** First letter of a login for avatar badges; an empty or missing login gets the fallback. */
export function avatarLetter(
  login: string | null | undefined,
  fallback: string,
) {
  return login?.charAt(0).toUpperCase() || fallback;
}
