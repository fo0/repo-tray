# Architecture

RepoTray uses a Svelte 5/TypeScript panel and a Tauri 2/Rust desktop service. There is no application server or webhook service.

```text
Svelte panel ── typed commands and snapshots ── Rust live service
                                                ├── GitHub REST API
                                                ├── OS credential store
                                                ├── SQLite metadata/cache
                                                ├── Tray and notifications
                                                └── Release discovery / browser download
```

## Runtime boundaries

`live.rs` owns authenticated GitHub access, accounts, repository discovery, workflow definitions, refs, dispatch and polling. `desktop.rs` moves blocking network/credential work onto worker threads, emits snapshots and manages the tray. Frontend state never owns a persisted token. Tokens remain in the native OS credential store; SQLite and browser preferences contain only nonsecret data.

`src/lib/types.ts` and Rust models define the snapshot/command contract with camelCase JSON. The browser demo uses the same shapes with `fixtures/demo.json`. Its fictional identities and repositories are local examples, not discovered accounts. The sign-in preview is explicitly simulated. A real token entered into the native connection form is verified before native storage; unavailable secure storage has no plaintext fallback.

## Native sign-in, account selection and popup

`browser_auth.rs` implements the server-free GitHub App device flow and vault refresh rotation, gated by public publisher build configuration. `local_auth.rs` discovers gh CLI/GCM accounts and imports only an explicitly selected compatible gh credential; GCM discovery remains metadata-only. Native commands do not expose credential values to the frontend. See [browser authentication](BROWSER_AUTH.md) and [local authentication](LOCAL_AUTH.md).

`accountSelection.ts` persists the selected stable nonsecret credential ID. Selection lives in Settings; same-login credential sources remain distinct and missing selections require a conscious choice. See [account selection](ACCOUNT_SELECTION.md).

The Windows popup tracks the actual tray rectangle and physical monitor work area, with its geometry isolated in `popup.rs` and native tray integration in `tray_popup.rs`. See [Windows popup validation](WINDOWS_POPUP_VALIDATION.md).

## Launch and cache safety

Only workflows exposing `workflow_dispatch` on their default branch are eligible. YAML is parsed as data, refs are checked, inputs are typed and validated, and read-only/deselected repositories cannot launch. Pins retain account, owner/repository, workflow, ref and validated nonsecret inputs.

The UI locks pending dispatches and rejects stale responses after target/account changes. The native service persists a target claim before dispatch and quarantines ambiguous responses rather than blindly resending a POST. Closing a dialog does not dispatch. A successful acknowledgement identifies the exact run; it does not establish build success.

The GitHub transport serializes requests, constrains pagination to the GitHub API origin, handles ETags/304 and rate-limit backoff, and never automatically retries an uncertain dispatch. Polling focuses on selected repositories and slows when idle, offline or limited. Notification baselines avoid replaying historical failures at startup.

Use REST version `2026-03-10`. Dispatch responses include the exact run ID; legacy/malformed responses stay uncertain. See [GitHub connection](GITHUB_SETUP.md) and the [official dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

## Desktop and updates

The stable app ID is `io.github.fo0.repotray`. The webview loads local assets under a restrictive CSP, with no general shell capability. Closing the panel keeps it in the tray; Quit exits the process. Optional autostart and hotkeys are follow-up work.

`updates.rs` authenticates private release discovery and accepts only a newer stable RepoTray release with the exact expected EXE. It validates repository-bound API/browser links. The native command opens the download URL in the standard browser; it never executes an unsigned installer or restarts the app. See [release process](RELEASES.md).
