/**
 * Language preference. „System“ follows the operating system language as the
 * WebView reports it (`navigator.languages`, which WebView2 takes from the
 * Windows display language): German for German, English for everything else.
 * Stored in localStorage like the theme and applied in main.ts before the
 * panel mounts, so the panel never shows the other language first.
 */
import type { PreferenceStorage } from '../bridgeTypes';

export type Locale = 'de' | 'en';
export type LanguagePreference = 'system' | Locale;

export const LANGUAGE_KEY = 'repowatch.language.v1';
export const LOCALES: readonly Locale[] = ['de', 'en'];

function storage(): PreferenceStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isLocale(value: unknown): value is Locale {
  return value === 'de' || value === 'en';
}

export function isLanguage(value: unknown): value is LanguagePreference {
  return value === 'system' || isLocale(value);
}

/** The first supported language in the system's preference list; English otherwise. */
export function detectLocale(
  languages: readonly string[] = globalThis.navigator?.languages ?? [],
): Locale {
  for (const tag of languages) {
    const base = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

/** The language a preference shows. */
export function resolveLocale(
  preference: LanguagePreference,
  languages?: readonly string[],
): Locale {
  return preference === 'system' ? detectLocale(languages) : preference;
}

/** The saved preference; anything missing, unreadable or unknown is „System“. */
export function readLanguage(target = storage()): LanguagePreference {
  try {
    const value: unknown = JSON.parse(target?.getItem(LANGUAGE_KEY) ?? 'null');
    return isLanguage(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Saves a preference („System“ removes the key); false if it could not. */
export function rememberLanguage(
  preference: LanguagePreference,
  target = storage(),
): boolean {
  if (!target || !isLanguage(preference)) return false;
  try {
    if (preference === 'system') target.removeItem(LANGUAGE_KEY);
    else target.setItem(LANGUAGE_KEY, JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
}

/** Each language by its own name, so it is found whatever language is shown. */
export const LANGUAGE_NAMES: Record<Locale, string> = {
  de: 'Deutsch',
  en: 'English',
};
