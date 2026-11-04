import { describe, expect, it } from 'vitest';
import * as de from './de';
import * as en from './en';
import {
  detectLocale,
  LANGUAGE_KEY,
  readLanguage,
  rememberLanguage,
  resolveLocale,
} from './locale';

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

/** Every leaf path of a catalog, with its kind: text or function. */
function shape(value: unknown, path = ''): string[] {
  if (typeof value === 'string') return [`${path}:text`];
  if (typeof value === 'function') return [`${path}:fn${value.length}`];
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, item]) =>
      shape(item, path ? `${path}.${key}` : key),
    );
  return [`${path}:${typeof value}`];
}

/** Every plain text of a catalog. */
function texts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object')
    return Object.values(value).flatMap(texts);
  return [];
}

describe('language detection', () => {
  it('takes the first supported system language', () => {
    expect(detectLocale(['de-DE', 'en-US'])).toBe('de');
    expect(detectLocale(['en-GB', 'de'])).toBe('en');
    expect(detectLocale(['fr-FR', 'de-AT'])).toBe('de');
    expect(detectLocale(['DE_ch'])).toBe('de');
  });

  it('falls back to English', () => {
    expect(detectLocale(['fr-FR', 'it'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });

  it('resolves „System“ by detection and keeps an explicit choice', () => {
    expect(resolveLocale('system', ['de-DE'])).toBe('de');
    expect(resolveLocale('en', ['de-DE'])).toBe('en');
    expect(resolveLocale('de', ['en-US'])).toBe('de');
  });
});

describe('language preference storage', () => {
  it('reads „System“ when nothing valid is stored', () => {
    expect(readLanguage(memory())).toBe('system');
    expect(readLanguage(memory({ [LANGUAGE_KEY]: '"fr"' }))).toBe('system');
    expect(readLanguage(memory({ [LANGUAGE_KEY]: '{' }))).toBe('system');
    expect(readLanguage(undefined)).toBe('system');
  });

  it('stores an explicit choice and removes the key for „System“', () => {
    const target = memory();
    expect(rememberLanguage('en', target)).toBe(true);
    expect(readLanguage(target)).toBe('en');
    expect(rememberLanguage('system', target)).toBe(true);
    expect(target.items.has(LANGUAGE_KEY)).toBe(false);
  });

  it('reports a storage that refuses', () => {
    const target = {
      ...memory(),
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(rememberLanguage('de', target)).toBe(false);
    expect(rememberLanguage('de', undefined)).toBe(false);
  });
});

describe('catalogs', () => {
  it('give English the German shape', () => {
    expect(shape(en)).toEqual(shape(de));
  });

  it('hold no empty text', () => {
    for (const text of [...texts(de), ...texts(en)])
      expect(text.trim()).not.toBe('');
  });
});
