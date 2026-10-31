# GitHub connection

The **native desktop app** now uses real GitHub REST requests through a Rust-owned request queue. It starts with no demo accounts. In Settings → Einrichten, enter an existing GitHub token in the masked field. The field clears immediately, the native service verifies `/user`, then stores the token under the stable numeric account ID in Windows Credential Manager, macOS Keychain or Linux Secret Service. Missing/locked credential storage fails closed; there is no plaintext fallback. Disconnect removes that account's credential and cached account metadata. No credential has been configured or used for testing in this task.

The **browser preview** continues to use local fixtures and explicitly labelled token sign-in simulation; browser sign-in is temporarily disabled. Its only accepted example is `demo-token`. It does not connect to GitHub. Browser tests of the native UI use an explicit IPC mock, not real credentials or OS-store operations.

## Token permissions

Use a fine-grained token restricted to intended repositories and an appropriate expiration. RepoTray does not create or broaden it.

| Permission          | Use                                                          |
| ------------------- | ------------------------------------------------------------ |
| Metadata: read      | Identify accessible repositories                             |
| Actions: read/write | Observe runs and dispatch eligible workflows                 |
| Contents: read      | Read workflow YAML, branches/tags and private release assets |

App updates use public, signed release artifacts from `fo0/repo-tray` and require no token or account selection. Repository workflow permissions remain account-specific. Organization approval/SSO may be necessary; denied reads/writes remain denied and are shown as errors. Repository write access alone does not prove a token has Actions write; GitHub's dispatch response is authoritative.

GitHub API version `2026-03-10` dispatch acknowledgements include the exact run ID. A legacy 204, timeout or unverifiable response remains uncertain and is not automatically retried. Before sending, the native service persists a target claim so restart cannot clear uncertainty. Monitoring a run or receiving a dispatch acknowledgement never means the build succeeded.

## Browser sign-in

New GitHub App/browser sign-ins are temporarily disabled in both UI and native commands, even in configured builds. Use a PAT or a [local gh account](LOCAL_AUTH.md). Existing browser account entries are preserved. Publisher configuration and the dormant device-flow implementation are described in [browser authentication](BROWSER_AUTH.md).
