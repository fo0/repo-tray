# GitHub connection

The **native desktop app** uses real GitHub REST requests through a Rust-owned request queue. It starts with no demo accounts. In **Einstellungen → Konten → Einrichten**, enter an existing GitHub token in the masked field. The field clears immediately, the native service verifies `/user`, then stores the token under the stable numeric account ID in Windows Credential Manager, macOS Keychain or Linux Secret Service. Missing/locked credential storage fails closed; there is no plaintext fallback. Disconnect removes that account's credential, cached account metadata and its uncertain-start locks. Automated tests use synthetic tokens only.

The **browser preview** uses local fixtures and an explicitly labelled token sign-in simulation; browser sign-in is temporarily disabled. Its only accepted example is `demo-token`. It does not connect to GitHub. Browser tests of the native UI use an explicit IPC mock, not real credentials or OS-store operations.

## Token permissions

Use a fine-grained token restricted to intended repositories and an appropriate expiration. RepoTray does not create or broaden it.

| Permission          | Use                                          |
| ------------------- | -------------------------------------------- |
| Metadata: read      | Identify accessible repositories             |
| Actions: read/write | Observe runs and dispatch eligible workflows |
| Contents: read      | Read workflow YAML and list branches/tags    |

The update check needs no token or account: it reads public release metadata of `fo0/repo-tray` unauthenticated (see [release process](RELEASES.md)). Repository workflow permissions remain account-specific. Organization approval/SSO may be necessary. Repository write access alone does not prove a token has Actions write; GitHub's dispatch response is authoritative.

## Access errors and stale data

Every account and repository refreshes on its own, so one failing scope does not block the others:

- **No Actions access.** A repository whose Actions endpoints answer 403, 404 or 410 is marked **Actions · Kein Zugriff** in the repository settings and cannot be started. The panel names it in a warning notice (**Kein Zugriff auf Actions: owner/name – prüfe Token-Rechte oder SSO-Freigabe.**, with **(+n weitere)** for further repositories). Its open runs are hidden until access returns; completed runs stay in the history. The next repository listing re-reads its permission.
- **Account access ended.** A 401 response, a credential that is missing from the vault, or a browser credential that cannot be renewed safely pauses the whole account and asks to reconnect it (for example **Zugang von login abgelaufen oder widerrufen – verbinde das Konto neu.** or **Zugang von login fehlt im Tresor – verbinde das Konto neu oder trenne es.**). An unavailable OS vault also pauses the account without sending anything (**Betriebssystem-Tresor nicht verfügbar – …**). **Repository-Liste aktualisieren** retries immediately.
- **Other failures** (network, rate limit, server or malformed responses) keep the last known data of the affected account or repository while the others update. The view is marked stale with a German reason (**Letzter Stand · …**) and the next refresh retries.

## Dispatch acknowledgements

GitHub API version `2026-03-10` dispatch acknowledgements include the exact run ID. A legacy 204, timeout or unverifiable response remains uncertain and is not automatically retried. Before sending, the native service persists a target claim so a restart cannot clear uncertainty; the target stays locked until the user explicitly releases it. Monitoring a run or receiving a dispatch acknowledgement never means the build succeeded.

## Browser sign-in

New GitHub App/browser sign-ins are temporarily disabled in both UI and native commands, even in configured builds. Use a PAT or a [local gh account](LOCAL_AUTH.md). Existing browser account entries are preserved. Publisher configuration and the dormant device-flow implementation are described in [browser authentication](BROWSER_AUTH.md).
