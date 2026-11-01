import { accountTitle } from './accountSelection';
import { fullRepo } from './model';
import type { Snapshot } from './types';

export const FALLBACK_ERROR = 'Die Aktion konnte nicht abgeschlossen werden.';

/** User-facing text for a rejection: an Error's message, an IPC error string, or a fallback. */
export function errorMessage(cause: unknown, fallback = FALLBACK_ERROR) {
  return cause instanceof Error
    ? cause.message
    : typeof cause === 'string'
      ? cause
      : fallback;
}

/** Local wall-clock time as `HH:MM` (de-DE); defaults to now. */
export function clockTime(value: string | number | Date = new Date()) {
  return new Date(value).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
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
