# GitHub connection

The **native desktop app** now uses real GitHub REST requests through a Rust-owned request queue. It starts with no demo accounts. In Settings → Einrichten, enter an existing GitHub token in the masked field. The field clears immediately, the native service verifies `/user`, then stores the token under the stable numeric account ID in Windows Credential Manager, macOS Keychain or Linux Secret Service. Missing/locked credential storage fails closed; there is no plaintext fallback. Disconnect removes that account's credential and cached account metadata. No credential has been configured or used for testing in this task.

The **browser preview** continues to use local fixtures and explicitly labelled simulated browser/token sign-in. Its only accepted example is `demo-token`. It does not connect to GitHub. Browser tests of the native UI use an explicit IPC mock, not real credentials or OS-store operations.

## Token permissions

Use a fine-grained token restricted to intended repositories and an appropriate expiration. RepoTray does not create or broaden it.

| Permission          | Use                                                          |
| ------------------- | ------------------------------------------------------------ |
| Metadata: read      | Identify accessible repositories                             |
| Actions: read/write | Observe runs and dispatch eligible workflows                 |
| Contents: read      | Read workflow YAML, branches/tags and private release assets |

For private in-app updates include `fo0/repo-tray` with Contents: read. A token restricted to another organization will not automatically gain access to the personal RepoTray repository. Select an account with the needed access for update checks. Organization approval/SSO may be necessary; denied reads/writes remain denied and are shown as errors. Repository write access alone does not prove a token has Actions write; GitHub's dispatch response is authoritative.

GitHub API version `2026-03-10` dispatch acknowledgements include the exact run ID. A legacy 204, timeout or unverifiable response remains uncertain and is not automatically retried. Before sending, the native service persists a target claim so restart cannot clear uncertainty. Monitoring a run or receiving a dispatch acknowledgement never means the build succeeded.

## Browser sign-in

The native GitHub App device-flow implementation is available, including automatic recognition, code copy, cancellation, expiry, safe refresh rotation and installation-scoped repository discovery. A real login still depends on separately maintained publisher configuration: no GitHub App, Client ID, grant or installation was created in this task. Without the public build configuration the button remains disabled with a clear explanation. PAT and local-account alternatives remain available.

See [browser authentication and publisher settings](BROWSER_AUTH.md) for the exact compile-time configuration, proposed publisher registration, permission model, credential ownership, fixture validation and remaining Windows/runtime acceptance. The browser preview stays an explicitly simulated demo; native UI tests mock IPC and do not prove a real GitHub login.
