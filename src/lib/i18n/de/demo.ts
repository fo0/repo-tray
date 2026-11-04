/** German texts: demo. Every key needs its English twin in ../en/demo.ts. */
export const demo = {
  /** The browser demo's banner and error texts; they mirror the native ones. */
  offline:
    'Offline: Letzter Demo-Stand bleibt sichtbar. Es wurde nichts gestartet.',
  forbidden: 'Zugriff verweigert: Demo simuliert fehlende Berechtigungen.',
  requestReused:
    'Diese Anfrage-ID wurde bereits mit anderen Eingaben verwendet.',
  stillUncertain:
    'Demo: Der letzte Start für diesen Workflow und Branch ist unbestätigt und wurde nicht erneut gesendet. Setze die Demo zurück, um erneut zu testen.',
  pending: 'Ein Start für diesen Workflow und Branch wird bereits verarbeitet.',
  wasReset: 'Die Demo wurde zurückgesetzt.',
  offlineStart: 'Offline: Kein simulierter Start möglich.',
  forbiddenStart:
    'Zugriff verweigert: Die Token-Berechtigung „Actions: Lesen und Schreiben“ fehlt.',
  uncertain:
    'Demo: Antwort unterbrochen. Der Start ist unbestätigt und läuft eventuell bereits. Ein erneuter Start für diesen Workflow und Branch bleibt gesperrt.',
  accepted: (runId: number) =>
    `Simulierter Start angenommen · Demo-Run #${runId}. Dies ist keine Build-Erfolgsmeldung.`,
  runNotFound: 'Run nicht gefunden.',
  runFinished: 'Run ist bereits beendet.',
  noWriteAccess: 'Für dieses Repository fehlt der Schreibzugriff.',
  offlineCancel: 'Offline: Kein simulierter Abbruch möglich.',
  forbiddenCancel:
    'Abbrechen nicht erlaubt – der Zugang braucht „Actions: Lesen und Schreiben“.',
  repoNotFound: 'Repository nicht gefunden.',
  newerLock:
    'Für diesen Workflow auf diesem Branch oder Tag gibt es eine neuere Startsperre. Prüfe die Runs erneut.',
};
