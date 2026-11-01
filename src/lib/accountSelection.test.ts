import { describe, expect, it } from 'vitest';
import {
  ACTIVE_ACCOUNT_KEY,
  accountTitle,
  readActiveAccount,
  rememberActiveAccount,
  restoreActiveAccount,
  type AccountPreferenceStorage,
} from './accountSelection';
const token = {
  id: 'github-42',
  login: 'fixture-user',
  label: 'GitHub · Token',
};
const browser = {
  id: 'github-device-42',
  login: 'fixture-user',
  label: 'GitHub · Browser',
};
const accounts = [token, browser];
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
    expect(rememberActiveAccount(browser.id, target)).toBe(true);
    expect(target.getItem(ACTIVE_ACCOUNT_KEY)).toBe('"github-device-42"');
    expect(restoreActiveAccount(accounts, readActiveAccount(target))).toEqual({
      id: browser.id,
      missing: false,
    });
    expect(accountTitle(token)).toBe('fixture-user · Token');
    expect(accountTitle(browser)).toBe('fixture-user · Browser');
  });
  it('never chooses the first remaining account when the saved identity is absent or removed', () => {
    expect(restoreActiveAccount(accounts, null)).toEqual({
      id: '',
      missing: false,
    });
    expect(restoreActiveAccount([token], browser.id)).toEqual({
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
    rememberActiveAccount(token.id, target);
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
    expect(rememberActiveAccount(token.id, denied)).toBe(false);
  });
});
