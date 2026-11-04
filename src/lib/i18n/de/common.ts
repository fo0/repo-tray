/** German texts used across areas. Every key needs its English twin in ../en/common.ts. */
export const common = {
  cancel: 'Abbrechen',
  save: 'Speichern',
  saving: 'Wird gespeichert …',
  close: 'Schließen',
  retry: 'Erneut versuchen',
  undo: 'Rückgängig',
  back: 'Zurück',
  next: 'Weiter',
  /** A rejection without a message of its own. */
  fallbackError:
    'Der Vorgang konnte nicht abgeschlossen werden. Versuche es erneut.',
  linkCopied: 'Link kopiert.',
  repoUnavailable: 'Repository nicht verfügbar',
  noActiveAccount: 'Kein aktives Konto',
  showInHistory: 'Im Verlauf anzeigen',
  clearSearch: 'Suche leeren',
  tryOtherSearch: 'Versuche einen anderen Suchbegriff.',
  /** Appended to a time the demo simulates, e.g. „09:42 · Demo-Zeit“. */
  demoTime: ' · Demo-Zeit',
  /** Spoken and shown counts. */
  count: {
    runs: (n: number) => (n === 1 ? '1 Run' : `${n} Runs`),
    favorites: (n: number) => (n === 1 ? '1 Favorit' : `${n} Favoriten`),
    repos: (n: number) => (n === 1 ? '1 Repository' : `${n} Repositories`),
  },
  /** Relative times: „gerade eben“, „vor 3 Min.“, „gestern“ … */
  relative: {
    justNow: 'gerade eben',
    minutes: (n: number) => `vor ${n} Min.`,
    hours: (n: number) => `vor ${n} Std.`,
    yesterday: 'gestern',
    days: (n: number) => `vor ${n} Tagen`,
  },
  /** When a run started or finished, for its tooltip and accessible name. */
  moment: {
    started: 'Gestartet',
    finished: 'Beendet',
    /** „gestartet vor 3 Min.“ or „beendet am 01.11.2026“. */
    spoken: (verb: string, relative: string, isDate: boolean) =>
      `${verb.toLowerCase()} ${isDate ? 'am ' : ''}${relative}`,
    lastRun: (at: string) => `Letzter Run: ${at}`,
    runningNow: (title: string) => `Läuft gerade · ${title}`,
  },
  /** Why a start or favorite is not valid (shared by dialog, favorites and demo). */
  validation: {
    accountMismatch: 'Konto und Repository passen nicht zusammen.',
    repoNotInTray: 'Repository nicht im Tray.',
    noWriteAccess: 'Für dieses Repository fehlt der Schreibzugriff.',
    noDispatch:
      'Dieser Workflow bietet keinen manuellen Start auf dem Standardbranch an.',
    noDefaultBranchDispatch:
      'Auf dem Standardbranch ist kein manueller Start verfügbar.',
    refUnavailable: 'Dieser Branch oder Tag ist nicht verfügbar.',
    requestId: 'Die Anfrage benötigt eine eindeutige ID.',
    unknownInput: 'Unbekannte Workflow-Eingabe.',
    required: (label: string) => `${label} ist erforderlich.`,
    boolean: (label: string) => `${label} muss Ja oder Nein sein.`,
    number: (label: string) => `${label} muss eine Zahl sein.`,
    text: (label: string) => `${label} muss Text sein.`,
    option: (label: string) => `${label}: Wähle einen verfügbaren Wert.`,
    favoriteName: 'Gib dem Favoriten einen Namen.',
    secretInputs: 'Geheime Eingaben werden nicht in Favoriten gespeichert.',
  },
};
