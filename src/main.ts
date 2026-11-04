import { mount } from 'svelte';
import App from './App.svelte';
import { bridge } from './lib/bridge';
import { languagePreference, setLocale } from './lib/i18n/index.svelte';
import { readLanguage, resolveLocale } from './lib/i18n/locale';
import { applyTheme, readTheme } from './lib/theme';
import './styles/index.css';

// Before mounting: the CSP forbids an inline script in index.html, and the
// native window starts hidden, so the panel never shows the other theme.
applyTheme(readTheme());

/** Applies a language preference here and on the native side. */
function applyLanguage(preference = languagePreference()) {
  const locale = resolveLocale(preference);
  setLocale(locale, preference);
  void bridge.setLocale(locale).catch(() => {
    /* Native texts stay in their previous language; the panel still switches. */
  });
}
applyLanguage(readLanguage());
// „System“ follows a change of the system language while the app runs.
globalThis.addEventListener?.('languagechange', () => {
  if (languagePreference() === 'system') applyLanguage();
});

const app = mount(App, { target: document.getElementById('app')! });
export default app;
