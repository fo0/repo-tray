import { m } from './i18n/index.svelte';

/** The settings dialog's tabs, in order. */
export const SETTINGS_TABS = ['accounts', 'app', 'updates'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** A tab's label in the language in effect; read at render time. */
export function settingsTabLabel(tab: SettingsTab): string {
  return m().settings.tabs[tab];
}
