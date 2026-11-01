# Architecture

RepoTray uses a Svelte 5/TypeScript panel and a Tauri 2/Rust desktop service. There is no application server or webhook service.

```text
Svelte panel ── typed commands and snapshots ── Rust live service
                                                ├── GitHub REST API
                                                ├── OS credential store
                                                ├── SQLite metadata/cache
                                                ├── Tray and notifications
                                                └── Update check (notify-only or signed install)
```

The module-level diagram is [ARCHITECTURE.mmd](ARCHITECTURE.mmd) (Mermaid).

## Module structure

**Panel (`src/`).** `App.svelte` is the orchestrator: it wires views, dialogs, keyboard shortcuts and the update timer. Data and mutations live in controllers under `src/lib/`, so dialogs keep only form state and closing one never drops a running operation's result or busy state:

| Controller               | Responsibility                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `panel.svelte.ts`        | Snapshot, active account, refresh, repository selection, templates and account disconnect; owns `Starts`, `Notices` and `Favorites`        |
| `starts.svelte.ts`       | Workflow starts per target, independent of any dialog; uncertain outcomes stay locked until an explicit release                            |
| `notices.svelte.ts`      | Banner notices, one per key; success notices close on their own (held while hovered, focused or behind a dialog), warnings and errors stay |
| `favorites.svelte.ts`    | Heart toggles, removal with **Rückgängig**, quick starts and the focus moves they need                                                     |
| `modals.svelte.ts`       | Which dialog is open, its initial settings tab and seed, and where focus returns                                                           |
| `dispatchForm.svelte.ts` | Start-dialog form state: target, typed inputs and favorite fields                                                                          |
| `updater.svelte.ts`      | Update check, signed-build download and install flow; state read-only from outside                                                         |

`src/lib/ipc.ts` is the only module that invokes native commands: `call()` is typed by a `Commands` map of every command registered in `generate_handler!` (`src-tauri/src/desktop.rs`) with its camelCase arguments and result, and `channel()` wraps streamed messages such as download progress. The contract test `src/lib/ipc.contract.test.ts` pins that map to `generate_handler!` in both directions and fails if any other file under `src/` imports or calls Tauri's `invoke`. `bridge.ts` selects native IPC (through `ipc.ts`, plus the `repotray:snapshot` event subscription) or the browser demo (`demo.ts`). `clock.ts` provides one shared minute clock (`minuteClock`) for relative run times and running durations, so rows own no timers; `shortcuts.ts` maps key presses to panel shortcuts (refresh, view tabs, search, Escape) and suppresses webview reloads. `safeGitHubUrl.ts` accepts exactly the run links the shell will open. Views and dialogs are components under `src/lib/` (for example `RepositoriesView`, `ActivityView`, `LaunchView`, `SettingsDialog` and `DispatchDialog`); dialogs share the `Modal` shell, which uses `focus.ts` for focus trapping and restoration. Styles live in ordered files under `src/styles/`, imported through `src/styles/index.css`.

**Rust core (`src-tauri/src/`, crate `repotray_core`).**

| Module                               | Responsibility                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `live.rs` + `live/`                  | Native engine `LiveStore`: `transport` (HTTPS with a vault-backed bearer token), `connect` (add/remove accounts), `refresh` (catalog, metadata and run orchestration), `schedule` (per-scope timers, holds on unauthorized accounts), `catalog` (repository and ref listings), `dispatch` (claimed, exactly-once starts) |
| `github.rs` + `github/`              | HTTP policy and protocol contracts; `client` (serialized queue, ETag pagination, rate-limit backoff, dispatch call), `wire` (dispatch confirmation and run conversion)                                                                                                                                                   |
| `run_history.rs`                     | Per-repository run discovery and follow-up                                                                                                                                                                                                                                                                               |
| `cache.rs` + `cache/`                | Account-scoped SQLite; `migrations` (ordered schema migrations), `payload` (scoping, credential rejection, bounded JSON)                                                                                                                                                                                                 |
| `auth.rs` + `auth/native.rs`         | Credential adapters; `native` is the OS keyring adapter                                                                                                                                                                                                                                                                  |
| `local_auth.rs` + `local_auth/gh.rs` | Explicit local discovery; `gh` parses gh CLI status and probes supported flags                                                                                                                                                                                                                                           |
| `browser_auth.rs`                    | Dormant GitHub App device flow                                                                                                                                                                                                                                                                                           |
| `workflow.rs`, `models.rs`           | Bounded workflow YAML metadata parsing; the IPC data model                                                                                                                                                                                                                                                               |
| `startup.rs`                         | Platform-independent Windows login-startup rules                                                                                                                                                                                                                                                                         |
| `updates.rs`                         | Update policy: notify-only release check and signed-update validation                                                                                                                                                                                                                                                    |
| `run_link.rs`                        | Canonical GitHub Actions run URLs (`https://github.com/<owner>/<repo>/actions/runs/<id>`); shared test vectors with the panel in `fixtures/run-links.json`                                                                                                                                                               |
| `popup.rs`                           | Physical-pixel popup geometry                                                                                                                                                                                                                                                                                            |
| `demo.rs`                            | Local simulation on `fixtures/demo.json`, used by Rust tests                                                                                                                                                                                                                                                             |

**Desktop shell (`src-tauri/src/`, binary `repotray`, feature `desktop`).** `main.rs` starts `desktop.rs`, which registers IPC commands, runs blocking work on worker threads, emits snapshots and manages the tray. Its `open_run` command opens only the canonical string returned by `run_link::canonical_run_url`, never the raw IPC argument, and rejects anything else. `desktop_auth.rs` holds the account commands (token, gh import, browser sign-in, cancel, disconnect), `desktop_startup.rs` the Windows Run-value adapter for autostart, `desktop_updates.rs` the update commands, and `tray_popup.rs` / `tray_popup/windows.rs` the window lifecycle and Win32 integration.

## Runtime boundaries

`live.rs` and its submodules own authenticated GitHub access, accounts, repository discovery, workflow definitions, refs, dispatch and polling. Frontend state never owns a persisted token. Tokens remain in the native OS credential store; SQLite and browser preferences contain only nonsecret data.

`src/lib/types.ts` and Rust models define the snapshot/command contract with camelCase JSON. The browser demo uses the same shapes with `fixtures/demo.json`. Its fictional identities and repositories are local examples, not discovered accounts. The sign-in preview is explicitly simulated. A real token entered into the native connection form is verified before native storage; unavailable secure storage has no plaintext fallback.

## Native sign-in, account selection and popup

`browser_auth.rs` implements the server-free GitHub App device flow and vault refresh rotation, gated by public publisher build configuration. `local_auth.rs` discovers gh CLI/GCM accounts and imports only an explicitly selected compatible gh credential; GCM discovery remains metadata-only. Native commands do not expose credential values to the frontend. See [browser authentication](BROWSER_AUTH.md) and [local authentication](LOCAL_AUTH.md).

`accountSelection.ts` persists the selected stable nonsecret credential ID. Selection lives in Settings; same-login credential sources remain distinct and missing selections require a conscious choice. See [account selection](ACCOUNT_SELECTION.md).

The Windows popup tracks the actual tray rectangle and physical monitor work area, with its geometry isolated in `popup.rs` and native tray integration in `tray_popup.rs`. See [Windows popup validation](WINDOWS_POPUP_VALIDATION.md).

## Launch and cache safety

The panel starts on **Repositories**, ordered by the latest run update. Repository disclosures expose workflow configuration, start buttons and heart favorites. **Aktivität** is a flat history with open runs first and up to 50 completed runs; **Favoriten** reuses account-bound launch templates. A heart saves default-branch/default-input configurations without enabling quick start. Missing required inputs open the template form; customized variants remain separate.

Only workflows exposing `workflow_dispatch` on their default branch are eligible. YAML is parsed as data, refs are checked, inputs are typed and validated, and read-only/deselected repositories cannot launch. Pins retain account, owner/repository, workflow, ref and validated nonsecret inputs.

The UI locks pending dispatches and rejects stale responses after target/account changes. The native service persists a target claim before dispatch and quarantines ambiguous responses rather than blindly resending a POST. An uncertain target stays locked until the user explicitly releases it with the `release_uncertain_start` command; no code path releases it automatically. Claims persist across restart, are listed in the snapshot as `uncertainStarts` and are removed when their account is deleted. Closing a dialog does not dispatch. A successful acknowledgement identifies the exact run; it does not establish build success.

The GitHub transport serializes requests, constrains pagination to the GitHub API origin, handles ETags/304 and rate-limit backoff, and never automatically retries an uncertain dispatch. Polling focuses on selected repositories and slows when idle, offline or limited. Notification baselines avoid replaying historical failures at startup.

`run_history.rs` seeds the latest 50 runs per selected repository once per process. Later polls discover active runs and runs created since the last successful discovery, including short runs that already finished. A known open run missing from the active lists is resolved by its exact ID; absence and network errors never imply completion. Completed metadata remains unchanged, and completed IDs receive no further individual status requests. Active reruns can reopen a known ID. The cache retains all open runs and at most 50 completed runs per repository; the UI applies its 50-entry completed limit across repositories. Moving discovery-window pages are not retained in the ETag cache.

Use REST version `2026-03-10`. Dispatch responses include the exact run ID; legacy/malformed responses stay uncertain. See [GitHub connection](GITHUB_SETUP.md) and the [official dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

## Desktop and updates

The stable app ID is `io.github.fo0.repotray`. The webview loads local assets under a restrictive CSP, with no general shell capability; `src-tauri/capabilities/default.json` grants the panel window only snapshot event listening and header dragging (the double-click maximize toggle is granted but inert, because the window is not maximizable). Closing the panel keeps it in the tray; **RepoTray beenden** in the tray menu exits the process. Optional Windows login startup uses a guarded per-user Run value as its source of truth. The `--autostart` launch path keeps the already-hidden window hidden; a duplicate login launch leaves the existing instance alone. See [Windows startup](WINDOWS_AUTOSTART.md). Global hotkeys remain follow-up work.

Updates are independent of account selection and run in one of two modes (`updates.rs`, `desktop_updates.rs`, `src/lib/UpdatePanel.svelte`). Standard unsigned builds use **notify mode**: at startup and every 6 hours they read the public `releases/latest` API on `api.github.com` without a token, announce a newer stable release in the panel and open only its validated tag page; they never download or install anything. Builds compiled with an updater public key use the official Tauri updater: `updates.rs` enforces stable versions, newer-than-current ordering and the exact repository/version-bound EXE URL; the service retains the update handle and verified bytes, streams download progress over an IPC channel and installs only after a second explicit UI action, using passive NSIS update/restart. See [release process](RELEASES.md).
