# Bestehende lokale Anmeldung

Im nativen Windows-Anmeldedialog ergänzt „Bestehende Anmeldung auf diesem PC verwenden“ den PAT und die [konfigurationsabhängige Browseranmeldung](BROWSER_AUTH.md). Die lokale Anmeldung ist als eigener Button mit PC-Symbol und Anmeldeoptions-Hinweis erkennbar. Öffnen des Dialogs oder des Abschnitts startet keine Erkennung. Erst „Lokale Anmeldungen prüfen“ ruft lokale Quellen auf. Es werden keine Credentials aus Entwicklungs-/CI-Umgebungen zur Anmeldung verwendet.

## Quelle und Nachweis

- **gh CLI (bevorzugt):** `auth status --hostname github.com --json hosts --no-refresh` prüft gespeicherte Konten. Mehrere geeignete Accounts erfordern eine Auswahl. Erst Auswahl, Speicherzustimmung und „prüfen und übernehmen“ erlauben `auth token --hostname github.com --user <login> --no-refresh`. Anschließend verifiziert RepoTray `/user` und vergleicht den Login vor dem Speichern. Beide Optionen müssen von der installierten gh-Version unterstützt werden; ältere Versionen scheitern geschlossen. Kein Fallback auf Textausgaben, Refresh oder Login.
- **Git Credential Manager:** `github list --url https://github.com` liefert nur Account-Namen. Diese sind als Git-Konten ohne nachgewiesene API-Rechte gekennzeichnet und nicht auswählbar. GCM dokumentiert `get` als Git-Helper-Schnittstelle; diese kann Authentifizierung und Credential-Verwaltung auslösen. RepoTray exportiert deshalb keine GCM-Credentials und ruft weder `git credential fill` noch beliebige konfigurierte Helper auf. Eine spätere GCM-API-Integration braucht einen belastbaren separaten Vertrag für unveränderte, nichtinteraktive API-Nutzung.
- **Git:** Nur Installationserkennung. Ein Binary, Remote, SSH-Key oder Repository-Push-Recht belegt keine GitHub-API-Anmeldung.

Account, Host, Provider und Berechtigungsnachweis werden getrennt angezeigt. Ein vorhandener `repo`-Scope deckt klassische private Actions-API-Zugriffe grundsätzlich ab; Repository-Zugang, Org/SSO-Freigabe und effektive Dispatch-Rechte bleiben ungeprüft. Fehlender `repo`-Scope und nicht auslesbare Scopes werden ausdrücklich unterschieden. Fine-grained PATs haben keine vollständige Scope-Liste. Es gibt keinen API-Test mit schreibender Wirkung.

Für spätere Nutzung gelten die jeweiligen API-Anforderungen: Actions lesen für Runs/Environments, Actions schreiben für Dispatch, Contents lesen für Workflow-YAML/Branches/Tags und Metadata lesen. Kein Admin-, Secrets- oder Contents-Schreibrecht ist für diesen Weg erforderlich. RepoTray unterstützt aktuell ausschließlich GitHub.com; keine Umleitung zu Enterprise-Hosts.

## Credential-Eigentum und Prozessgrenzen

Nach ausdrücklicher Zustimmung entsteht eine **eigene Kopie im RepoTray-Betriebssystem-Tresor**, kein Verweis auf einen dauerhaft ausgelesenen CLI-Account. Lokale Importe benutzen die stabile API-Benutzer-ID im eigenen Namespace `github-gh-<id>`, PATs weiter `github-<id>`. Ein PAT-Login überschreibt keinen gh-Import. Konto-Login und Quelle sind Anzeigemetadaten. Trennen löscht ausschließlich die RepoTray-Kopie und deren Metadaten; gh/GCM werden weder gelöscht, umgeschaltet noch widerrufen. Spätere gh-Rotation synchronisiert die Kopie nicht automatisch; bei Ablauf erneut bewusst übernehmen.

Nur bekannte Windows-Installationspfade unter Program Files sowie gh unter LocalAppData/Programs werden berücksichtigt. Keine PATH-/CWD-Suche, Shell-Aliasse, `.cmd`-Wrapper oder im Repository hinterlegte Programme. Nicht standardmäßig installierte Programme werden ehrlich als nicht gefunden gemeldet. Nicht-Windows-Plattformen bieten in dieser Version keine lokale Quelle an.

Die Prozesse erhalten ein minimales Environment ohne GitHub-Tokenvariablen, alternative gh-Konfiguration, Debug-/Trace-Konfiguration oder Askpass. Stdin ist geschlossen; stdout und stderr sind jeweils auf 64 KiB und die Laufzeit auf 20 Sekunden begrenzt. Rohe Ausgaben gelangen nie in UI oder Logs. Bei GCM werden aus erfolgreichen List-Aufrufen ausschließlich gültige GitHub-Account-Namen gefiltert (v2: stdout, v3: stderr). Für GCMs eigene Git-Suche wird ausschließlich der geprüfte Git-Installationspfad vorgegeben. Abbruch beendet den Prozess und verwirft verspätete Ergebnisse. Tokenbytes verlassen den Rust-Adapter nicht über IPC, Logs, Snapshot oder Cache; Fehler sind fest vorgegeben. Der Import erhält ein redigiertes, nicht serialisierbares SecretToken und prüft die Identität erneut.

## Validierung und Grenzen

Rust-Tests nutzen `fixtures/local-auth.json`, injizierte Runner und synthetische Python-Mockprozesse. Sie prüfen mehrere Accounts, ungültige/abgelaufene Accounts, fehlende und unbekannte Scopes, ausgeschlossene Environment-Credentials, kaputte/alte Quellen, Auswahlmanipulation, exakte Prozessargumente, Timeout, Abbruch, Größenlimit, Stderr-Unterdrückung und getrennte Credential-Namespaces. Playwright nutzt ausschließlich IPC-Mocks für Auswahl, Einwilligung, fehlende Quellen und verspätete Ergebnisse. Kein Test liest reale gh-/Git-/GCM-Credentials, erzeugt Auth-Grants oder startet echte Workflows über die RepoTray-App.

Windows-native CLI-Discovery, Credential Manager und Tauri-WebView bleiben auf einem Windows-PC zu validieren. Linux-Mocks und ein Compilercheck können diese Integrationsgrenze nicht ersetzen.

Die ausführbaren Prüfkommandos und ihre Grenzen stehen unter [Validierung](VALIDATION.md). Die reguläre CI prüft Frontend, Rust und den Windows-Desktop; Installer-Builds und Releases gehören nicht zu diesen Checks.

## Offizielle Quellen

- [gh auth status](https://cli.github.com/manual/gh_auth_status), [gh auth token](https://cli.github.com/manual/gh_auth_token), [gh Environment](https://cli.github.com/manual/gh_help_environment)
- [GCM CLI](https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/usage.md), [GCM Konfiguration](https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/configuration.md)
- GCM-Implementierungsnachweis: [Account-Liste v2](https://github.com/git-ecosystem/git-credential-manager/blob/v2.6.1/src/shared/GitHub/GitHubHostProvider.Commands.cs), [Account-Liste aktuell](https://github.com/git-ecosystem/git-credential-manager/blob/main/src/GitHub/GitHubHostProvider.Commands.cs), [Console-Ausgaben](https://github.com/git-ecosystem/git-credential-manager/blob/main/src/Core/ConsoleService.cs), [Git-Helper-Verhalten](https://github.com/git-ecosystem/git-credential-manager/blob/main/src/GitHub/GitHubHostProvider.cs)
- [GitHub Actions Workflows/Dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event), [Environments](https://docs.github.com/en/rest/deployments/environments#list-environments)

Die explizite aktive Kontoauswahl mit Quellenbeschriftung und ID-Persistenz ist in [Kontoauswahl](ACCOUNT_SELECTION.md) beschrieben. Sie wechselt weder gh-Konten noch Credential-Quellen automatisch.
