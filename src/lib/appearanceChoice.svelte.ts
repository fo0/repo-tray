import type { Bridge } from './demo';
import { languagePreference, m, setLocale } from './i18n/index.svelte';
import {
  rememberLanguage,
  resolveLocale,
  type LanguagePreference,
} from './i18n/locale';
import {
  appliedTheme,
  applyTheme,
  rememberTheme,
  type ThemePreference,
} from './theme';

type LocalePort = Pick<Bridge, 'setLocale'>;

/**
 * Theme and language while the settings dialog is open. main.ts applied the
 * saved ones; a choice previews at once, „Speichern“ keeps it with
 * `applyTheme` / `applyLanguage`, and `restore` drops an unsaved preview when
 * the dialog closes.
 */
export class AppearanceChoice {
  #savedTheme = $state(appliedTheme());
  #savedLanguage = $state(languagePreference());
  /** Plain copies for the teardown, which reads state as it was before close. */
  #keptTheme = appliedTheme();
  #keptLanguage = languagePreference();
  /** The staged choices the settings bind to. */
  theme = $state(appliedTheme());
  language = $state(languagePreference());
  #port: LocalePort;

  constructor(port: LocalePort) {
    this.#port = port;
  }

  get themePending() {
    return this.theme !== this.#savedTheme;
  }
  get languagePending() {
    return this.language !== this.#savedLanguage;
  }

  /**
   * Keeps the staged theme. It becomes the baseline even if it could not be
   * remembered: it holds for this session, and the rejection says so.
   */
  applyTheme = () => {
    const value: ThemePreference = this.theme;
    const remembered = rememberTheme(value);
    this.#savedTheme = this.#keptTheme = value;
    if (!remembered) throw new Error(m().settings.theme.saveFailed);
  };

  /**
   * Keeps the staged language like the theme. The native side words
   * notifications, tray and errors in it too, best effort as in main.ts.
   */
  applyLanguage = () => {
    const value: LanguagePreference = this.language;
    const remembered = rememberLanguage(value);
    this.#savedLanguage = this.#keptLanguage = value;
    void this.#port.setLocale(resolveLocale(value)).catch(() => {
      /* Native texts stay in their previous language; the panel still switches. */
    });
    if (!remembered) throw new Error(m().settings.language.saveFailed);
  };

  /** Drops an unsaved preview; the dialog calls it on close. */
  restore = () => {
    if (appliedTheme() !== this.#keptTheme) applyTheme(this.#keptTheme);
    if (languagePreference() !== this.#keptLanguage)
      setLocale(resolveLocale(this.#keptLanguage), this.#keptLanguage);
  };
}
