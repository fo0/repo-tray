/** German texts: dispatch. Every key needs its English twin in ../en/dispatch.ts. */
export const dispatch = {
  /** Why a start button is off; one reason per cause (`startReasons`). */
  reasons: {
    manual: 'Kein manueller Start',
    readOnly: 'Kein Schreibzugriff auf dieses Repository',
    offline: 'Offline – Starts sind deaktiviert',
    forbidden: 'Zugriff verweigert – Starts sind deaktiviert',
    running: 'Start läuft …',
    uncertain: 'Startstatus ungeklärt – prüfe die Runs auf GitHub',
  },
  dialog: {
    title: 'Workflow starten',
    demoNote: 'Lokale Simulation · kein echter Workflow-Start',
    liveNote: 'Echter GitHub-Workflow-Start · Konto und Ziel prüfen',
    completeFavorite:
      'Ergänze die benötigten Angaben und speichere den Workflow als Favorit.',
    alreadyStarted:
      'Bereits gestartet – öffne den Dialog erneut für einen weiteren Start',
    savingFavorite: 'Favorit wird gespeichert …',
    chooseTarget: 'Wähle Repository und Workflow.',
    offline:
      'Offline. Starts sind deaktiviert; der letzte Stand bleibt sichtbar.',
    forbidden:
      'Zugriff verweigert. Prüfe die Token-Berechtigung „Actions: Lesen und Schreiben“. Starts sind deaktiviert.',
  },
  actions: {
    continues:
      'Der Start läuft weiter, auch wenn du den Dialog schließt. Das Ergebnis erscheint dann im Panel.',
    simulating: 'Simuliert …',
    starting: 'Startet …',
    simulate: 'Start simulieren',
    start: 'Workflow starten',
  },
  target: {
    repository: 'Repository',
    noRepositories: 'Keine Repositories',
    workflow: 'Workflow',
    noWorkflow: 'Kein Workflow verfügbar',
    /** Suffix of a workflow without `workflow_dispatch`. */
    noManualStart: ' · kein manueller Start',
    ref: 'Branch oder Tag',
    /** Suffix of the repository's default branch. */
    defaultBranch: ' · Standardbranch',
  },
  inputs: {
    heading: 'EINGABEN',
    count: (count: number) => (count === 1 ? '1 Eingabe' : `${count} Eingaben`),
    /** Hint for each GitHub input type; raw type names never reach the UI. */
    types: {
      string: 'Text',
      number: 'Zahl',
      choice: 'Auswahl',
      environment: 'Umgebung',
      boolean: 'Ja/Nein',
    },
    unset: 'Nicht gesetzt',
  },
  outcome: {
    accepted: 'GitHub hat den Start angenommen',
    acceptedDemo: 'Simulierter Start angenommen',
    rejected: 'Start abgelehnt',
    viewRun: (runId: number) => `Run #${runId} auf GitHub ansehen`,
    showInHistory: 'Im Verlauf anzeigen',
    /** Banner text of a rejected start the dialog no longer shows. */
    rejectedNotice: (name: string, message: string) =>
      `${name}: Start abgelehnt. ${message}`,
  },
  /**
   * The quarantine of a start with unknown outcome: it is never re-sent, and
   * only the user releases it after checking the runs on GitHub.
   */
  uncertain: {
    title: 'Startstatus ungeklärt',
    locked:
      'GitHub hat den letzten Start für diesen Workflow und Branch nicht bestätigt. Er läuft eventuell bereits. Prüfe die Runs auf GitHub. Ein erneuter Start bleibt gesperrt, bis du die Sperre aufhebst.',
    checkStatus: 'Status prüfen',
    checkFailed:
      'Status konnte nicht geprüft werden. Prüfe deine Verbindung und versuche es erneut. Starts bleiben gesperrt.',
    stillUnconfirmed:
      'Status geprüft. GitHub hat den Start weiterhin nicht bestätigt. Ein erneuter Start bleibt gesperrt.',
    released: 'Sperre aufgehoben. Du kannst den Workflow wieder starten.',
    release: {
      ask: 'Sperre aufheben…',
      title: 'Sperre aufheben?',
      text: 'Hebe die Sperre nur auf, wenn du auf GitHub geprüft hast, dass dieser Start nicht läuft oder ein erneuter Start gewollt ist. RepoWatch startet dabei nichts.',
      confirm: 'Ich habe die Runs auf GitHub geprüft – Sperre aufheben',
      busy: 'Sperre wird aufgehoben …',
    },
    /** The help of a favorite's uncertain marker. */
    help: {
      text: 'GitHub hat den Start nicht bestätigt. Der Workflow läuft eventuell bereits. Ein erneuter Start für diesen Workflow und Branch bleibt gesperrt.',
      next: 'Wähle den Favoriten, dann „Status prüfen“ oder nach der Prüfung auf GitHub „Sperre aufheben…“.',
      demo: 'Die Beispielsperre hebst du im Startdialog oder mit „Demo zurücksetzen“ auf.',
      live: 'Die Startsperre bleibt auch nach einem Neustart erhalten, bis du sie aufhebst.',
    },
  },
};
