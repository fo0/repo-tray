/** German texts: settings. Every key needs its English twin in ../en/settings.ts. */
export const settings = {
  language: {
    heading: 'Sprache',
    system: 'System',
    /** Tooltip of „System“: which language the system setting gives. */
    systemDetected: (language: string) => `Systemsprache: ${language}`,
    saveFailed:
      'Sprache ließ sich nicht speichern und gilt bis zum nächsten Start.',
  },
};
