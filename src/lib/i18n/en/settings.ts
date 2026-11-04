import type { settings as German } from '../de/settings';

/** English texts: settings. Same shape as the German catalog. */
export const settings: typeof German = {
  language: {
    heading: 'Language',
    system: 'System',
    systemDetected: (language: string) => `System language: ${language}`,
    saveFailed:
      'The language could not be saved and applies until the next start.',
  },
};
