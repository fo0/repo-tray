import { describe, expect, it } from 'vitest';
import {
  ACTIVE_ACCOUNT_KEY,
  accountTitle,
  readActiveAccount,
  rememberActiveAccount,
  restoreActiveAccount,
  type AccountPreferenceStorage,
} from './accountSelection';
const accounts = [
  { id: 'github-42', login: 'fixture-user', label: 'GitHub · Token' },
  { id: 'github-device-42', login: 'fixture-user', label: 'GitHub · Browser' },
];
function memory(): AccountPreferenceStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
describe('explicit active account preference', () => {
  it('restores only the exact stable credential identity and keeps same-login sources separate', () => {
    const target = memory();
    expect(rememberActiveAccount(accounts[1].id, target)).toBe(true);
    expect(target.getItem(ACTIVE_ACCOUNT_KEY)).toBe('"github-device-42"');
    expect(restoreActiveAccount(accounts, readActiveAccount(target))).toEqual({
      id: accounts[1].id,
      missing: false,
    });
    expect(accountTitle(accounts[0])).toBe('fixture-user · Token');
    expect(accountTitle(accounts[1])).toBe('fixture-user · Browser');
  });
  it('never chooses the first remaining account when the saved identity is absent or removed', () => {
    expect(restoreActiveAccount(accounts, null)).toEqual({
      id: '',
      missing: false,
    });
    expect(restoreActiveAccount([accounts[0]], accounts[1].id)).toEqual({
      id: '',
      missing: true,
    });
  });
  it('stores no token, login, label or invalid preference and removes explicit cleared selection', () => {
    const target = memory();
    for (const invalid of [
      'ghp_synthetic',
      'github_pat_synthetic',
      'fixture-user',
      '{"access_token":"synthetic"}',
      'https://example.test',
    ]) {
      expect(rememberActiveAccount(invalid, target)).toBe(false);
    }
    rememberActiveAccount(accounts[0].id, target);
    expect(target.getItem(ACTIVE_ACCOUNT_KEY)).not.toContain('fixture-user');
    rememberActiveAccount('', target);
    expect(readActiveAccount(target)).toBeNull();
  });
  it('fails safely when preferences are malformed or storage is unavailable', () => {
    const target = memory();
    target.setItem(ACTIVE_ACCOUNT_KEY, '{');
    expect(readActiveAccount(target)).toBeNull();
    const denied: AccountPreferenceStorage = {
      getItem() {
        throw Error('unavailable');
      },
      setItem() {
        throw Error('unavailable');
      },
      removeItem() {
        throw Error('unavailable');
      },
    };
    expect(readActiveAccount(denied)).toBeNull();
    expect(rememberActiveAccount(accounts[0].id, denied)).toBe(false);
  });
});
