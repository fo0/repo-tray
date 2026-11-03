/** The settings dialog's tabs, in order. */
export const SETTINGS_TABS = [
  { id: 'accounts', label: 'Konten' },
  { id: 'app', label: 'App' },
  { id: 'updates', label: 'Updates' },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];
