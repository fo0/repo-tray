import type { Account } from './types';

export const ACTIVE_ACCOUNT_KEY = 'repotray.activeAccount.v1';
export interface AccountPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
function storage(): AccountPreferenceStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
function safeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 128 &&
    /^(?:github-(?:(?:gh|device)-)?[1-9][0-9]*|demo-[a-zA-Z0-9_-]+)$/.test(
      value,
    ) &&
    !/^(?:gh[pousr]_|github_pat_)/i.test(value)
  );
}
export function readActiveAccount(target = storage()): string | null {
  try {
    const value: unknown = JSON.parse(
      target?.getItem(ACTIVE_ACCOUNT_KEY) ?? 'null',
    );
    return safeId(value) ? value : null;
  } catch {
    return null;
  }
}
export function rememberActiveAccount(id: string, target = storage()): boolean {
  if (!target || (id && !safeId(id))) return false;
  try {
    if (id) target.setItem(ACTIVE_ACCOUNT_KEY, JSON.stringify(id));
    else target.removeItem(ACTIVE_ACCOUNT_KEY);
    return true;
  } catch {
    return false;
  }
}
export function restoreActiveAccount(
  accounts: Account[],
  saved: string | null,
): { id: string; missing: boolean } {
  return saved && accounts.some((account) => account.id === saved)
    ? { id: saved, missing: false }
    : { id: '', missing: saved !== null };
}
export function accountTitle(account: Account): string {
  return `${account.login} · ${account.label.replace(/^GitHub · /, '')}`;
}
