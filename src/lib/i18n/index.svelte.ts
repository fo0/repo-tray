/**
 * The panel's language in effect. Every visible text reads its catalog through
 * `m()` at render time, so a change re-renders the panel at once; module-level
 * constants must not capture a text. German is the default until main.ts
 * applies the saved or detected language (unit tests keep German).
 */
import type { LanguagePreference, Locale } from './locale';
import { CATALOGS, type Messages } from './messages';

let current = $state<Locale>('de');
let preference = $state<LanguagePreference>('system');

/** The language every text is shown in. */
export function locale(): Locale {
  return current;
}

/** The preference in effect („System“ or an explicit language). */
export function languagePreference(): LanguagePreference {
  return preference;
}

/** Switches every text; `lang` on <html> follows for screen readers and hyphenation. */
export function setLocale(
  next: Locale,
  chosen: LanguagePreference = preference,
  root: HTMLElement | undefined = globalThis.document?.documentElement,
): void {
  current = next;
  preference = chosen;
  root?.setAttribute('lang', next);
}

/** The catalog of the language in effect. */
export function m(): Messages {
  return CATALOGS[current];
}

/** The `Intl` locale for dates, times and numbers. */
export function intlLocale(): string {
  return current === 'de' ? 'de-DE' : 'en-US';
}
