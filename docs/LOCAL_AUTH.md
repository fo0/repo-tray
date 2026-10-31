# Bestehende lokale Anmeldung

Unter **Einstellungen → Konten → Einrichten** kannst du eine bestehende Anmeldung der **GitHub CLI (`gh`)** ausdrücklich in RepoTray übernehmen. Die Browser-Anmeldung / GitHub App ist vorübergehend deaktiviert. Ein persönlicher API-Token bleibt als Alternative verfügbar.

## Erkennen, verbinden und aktiv verwenden

1. Öffne **Bestehende Anmeldung auf diesem PC verwenden** und klicke auf **Lokale Anmeldungen prüfen**. Öffnen allein greift nicht auf lokale Anmeldungen zu.
2. Wähle das gewünschte gh-Konto. **In gh erkannt · noch nicht mit RepoTray verbunden** bedeutet, dass bisher nur die lokale Quelle geprüft wurde. Die Markierung **in gh aktiv** ist nicht das aktive RepoTray-Konto.
3. Bestätige **Ich möchte dieses gh-Konto in RepoTray verwenden** und klicke auf **gh-Konto mit RepoTray verbinden**. Erst jetzt liest gh den ausgewählten Token; RepoTray verifiziert die GitHub-Identität und speichert eine eigene Kopie im Betriebssystem-Tresor.

**Bereits in RepoTray verbunden** zeigt in den Einstellungen und im Anmeldedialog Login, Quelle und Status: **Token hinterlegt**, **gh-Anmeldung übernommen** oder ein bereits gespeichertes Browser-Konto. **Aktiv für RepoTray** und **Verbunden, nicht aktiv** sind getrennt sichtbar. **Verwenden** aktiviert eine bestehende Verbindung, ohne erneut Zugangsdaten zu importieren. Eine erneute gh-Übernahme nach Tokenrotation erfordert wieder die ausdrückliche Zustimmung.

Das Token-Eingabefeld bleibt aus Datenschutzgründen leer. **Weiteres Konto per Token verbinden** fügt eine Verbindung hinzu; ein leeres Feld bedeutet nicht, dass vorhandene Tokens fehlen. **Token prüfen und verbinden** ist ohne neue Eingabe deaktiviert.

## Wenn gh nicht gefunden wird

Prüfe im normalen Terminal:

```sh
gh --version
gh auth status --hostname github.com
```

Falls du noch nicht in gh angemeldet bist, führe dort selbst `gh auth login --hostname github.com` aus. Starte RepoTray nach einer neuen gh-Installation neu, damit es den aktualisierten PATH sieht, und prüfe die lokale Anmeldung erneut.

Git, GitHub Desktop und GitHub CLI sind unterschiedliche Programme. Ein funktionierendes `git push`, ein SSH-Key oder eine GitHub-Desktop-Anmeldung ist keine automatisch nutzbare gh-API-Anmeldung. Git Credential Manager wird deshalb als zusätzliche Git-Quelle angezeigt, nicht als auswählbare API-Verbindung. RepoTray führt weder Git-Credential-Helper noch einen eigenen CLI-Login aus.

## Versions- und Installationsunterstützung

RepoTray prüft zunächst die Hilfe der installierten gh-Befehle. Neuere Versionen erhalten `--no-refresh`, wenn sie es unterstützen; ältere Versionen erhalten dieses Flag nicht. Der frühere pauschale Aufruf mit `--no-refresh` hat ältere, ansonsten funktionsfähige Installationen scheitern lassen.

- **gh mit JSON-Status:** `auth status --hostname github.com --json hosts` listet gespeicherte Konten. `--no-refresh` wird nur bei vorhandener Unterstützung ergänzt. Umgebungs-Tokenquellen werden nicht zur Übernahme angeboten.
- **Älteres gh ohne JSON-Status:** `api --hostname github.com user --jq .login` bestätigt ausschließlich die dort aktive Identität. Es werden weder menschliche Statusausgaben geparst noch Credential-Dateien ausgelesen. Für die Auswahl weiterer gespeicherter gh-Konten empfiehlt sich ein gh-Update.
- **Nach Bestätigung:** `auth token --hostname github.com --user <login>` liest exakt das gewählte Konto. Auch hier wird `--no-refresh` nur bei Unterstützung ergänzt. Fehlt `--user`, erfolgt kein Import. RepoTray ruft keinen Login, Kontowechsel oder Credential-Refresh auf. Vor dem Speichern wird `/user` erneut gegen den ausgewählten Login geprüft.

Windows-Erkennung berücksichtigt Program Files, LocalAppData/Programs, Scoop einschließlich konfigurierter/globaler Wurzeln, WinGet-Links, Chocolatey und absolute PATH-Einträge. Die EXE wird vor dem Start kanonisiert; relative PATH-Einträge, das aktuelle Verzeichnis, Projekt-Binaries und `.cmd`-Wrapper werden ausgeschlossen. Eine explizite absolute `GH_CONFIG_DIR`-Konfiguration wird berücksichtigt. Nicht-Windows-Plattformen bieten derzeit keine lokale Quelle an.

## Credential-Eigentum und Prozessgrenzen

Lokale Übernahmen benutzen die stabile API-Benutzer-ID im eigenen Namespace `github-gh-<id>`; PAT-Verbindungen verwenden `github-<id>`. Ein PAT überschreibt deshalb keine gh-Verbindung desselben GitHub-Nutzers. Trennen entfernt nur die RepoTray-Kopie, weder gh/GCM-Anmeldungen noch deren Berechtigungen. Spätere gh-Rotation synchronisiert eine bereits gespeicherte Kopie nicht automatisch.

Kindprozesse erhalten ein minimales Environment ohne GitHub-Tokenvariablen, alternative Hosts, Debug-/Trace-Konfiguration oder Askpass. Die explizite gh-Konfiguration sowie Proxy- und CA-Vertrauen bleiben erhalten. Stdin ist geschlossen; stdout und stderr sind jeweils auf 64 KiB und die Laufzeit auf 20 Sekunden begrenzt. Rohe Prozessausgaben und Tokenwerte erscheinen nie in UI, IPC, Logs oder Snapshots. Abbruch beendet die Prüfung und verwirft verspätete Ergebnisse.

GCMs `github list --url https://github.com` wird ausschließlich für Account-Namen genutzt (v2: stdout, v3: stderr). Weder `git credential fill` noch andere konfigurierte Git-Helper werden aufgerufen. Git-/Push-Rechte belegen keine Actions-API-Berechtigung. Ein `repo`-Scope ist ein Hinweis auf klassische private API-Rechte, ersetzt aber keine Repository-/Org-/SSO-Freigabe. Kein Test startet einen Workflow zur Rechteprüfung.

## Validierung und Grenzen

Rust-Tests modellieren aktuelle und ältere gh-Versionen, einschließlich echter Fehler für unbekannte Flags, JSON-Status, aktive Legacy-Identität, exakte Kontoauswahl und Tokenquellen. Pfadtests prüfen Scoop, WinGet, PATH und die Ablehnung lokaler Projekt-Binaries. Synthetische Prozesse prüfen Timeout, Abbruch, Ausgabegrenzen und Credential-Isolation. Browser-Tests prüfen sichtbare Verbindungszustände, Auswahl, Zustimmung, bereits gespeicherte Konten und den pausierten Browserweg.

Diese Tests lesen keine realen lokalen Anmeldungen. Die konkrete gh-Installation und der Windows-Credential-Manager müssen weiterhin auf dem betroffenen Windows-PC geprüft werden. Kommandos und Grenzen stehen unter [Validierung](VALIDATION.md).

## Offizielle Quellen

- [gh auth status](https://cli.github.com/manual/gh_auth_status), [gh auth token](https://cli.github.com/manual/gh_auth_token), [gh api](https://cli.github.com/manual/gh_api), [gh Environment](https://cli.github.com/manual/gh_help_environment)
- [GCM CLI](https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/usage.md)
- [Aktive Kontoauswahl](ACCOUNT_SELECTION.md)
