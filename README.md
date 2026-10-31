# RepoTray

[![Checks](https://github.com/fo0/repo-tray/actions/workflows/checks.yml/badge.svg?branch=main&event=push)](https://github.com/fo0/repo-tray/actions/workflows/checks.yml)
[![Windows release](https://github.com/fo0/repo-tray/actions/workflows/release.yml/badge.svg?branch=main&event=workflow_dispatch)](https://github.com/fo0/repo-tray/actions/workflows/release.yml)

<img src="src-tauri/icons/source.svg" alt="" width="64" height="64" align="right" />

**GitHub Actions within reach.** RepoTray is a compact Windows tray companion for monitoring runs, launching workflows and keeping frequently used launches as pinned templates.

Built with **Tauri 2, Rust, Svelte 5 and TypeScript**. Windows x64 is the primary target; other desktop platforms require their own native validation.

## What it does

- **A panel beside the tray icon.** Windows placement follows the clicked icon, monitor work area and DPI. Clicking outside hides the panel while preserving open forms and ongoing work. Closing the window keeps RepoTray in the tray; **Quit** exits it.
- **Repositories first.** Saved favorites appear directly below search, followed by compact repositories ordered by their most recent run activity. Expand a repository to configure or start an Action, or save its default configuration with the heart button. Favorites also have their own **Favoriten** tab.
- **A separate activity history.** **Aktivität** shows every open run and the latest 50 completed runs across the selected account's repositories. Completed entries stay cached; status polling follows open runs until their final state and discovers newly created runs.
- **Explicit workflow launches.** Choose a workflow, branch/tag and typed inputs. Save account-bound templates and opt in to quick launch when desired.
- **Deliberate account selection.** Choose the active credential under **Einstellungen → Aktives Konto**. The app remembers its stable nonsecret ID, distinguishes same-login sources and asks for a new selection if it disappears. It never silently falls back to another identity.
- **Cached state and uncertain-start protection.** Offline views keep cached activity. Ambiguous dispatch responses remain quarantined across reopening and restart to avoid blindly starting the same workflow twice. An accepted dispatch is not a successful build.
- **Manual updates.** Check for a newer release, read its changelog and explicitly open the EXE download in the standard browser.

The active account controls the foreground view, new launches and update checks. Other connected accounts keep their selected-repository background monitoring; saved templates retain their original credential binding. See [account selection](docs/ACCOUNT_SELECTION.md).

## Sign in

The native app starts without demo accounts. Credentials are owned by the Rust service and stored in the operating system's credential vault; browser preferences contain only nonsecret selections.

| Method                            | Current behavior                                                                                                                                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GitHub browser sign-in**        | Native GitHub App device-flow code is implemented. A real login requires the publisher's public Client ID/app configuration and the user's authorization and installation. The button explains missing configuration and stays disabled until configured. |
| **Personal access token**         | Enter an existing token; RepoTray verifies the identity before storing its own credential entry. Repository access, Actions permissions and organization/SSO restrictions still apply.                                                                    |
| **Existing local gh CLI account** | On Windows, explicitly request discovery, select a supported stored account and consent before RepoTray verifies and copies that credential into its own vault namespace. Disconnect removes the RepoTray copy, not the CLI account.                      |
| **Git Credential Manager**        | Discovery shows account metadata only. GCM credentials are not imported and Git/SSH access is not treated as GitHub API authentication.                                                                                                                   |

Browser, token and imported CLI credentials remain distinct. No automatic credential-source cascade is used. See [connection and permissions](docs/GITHUB_SETUP.md), [browser publisher configuration](docs/BROWSER_AUTH.md) and [local sign-in](docs/LOCAL_AUTH.md).

## Install or build

Published Windows installers, when available, are listed on the [Releases page](https://github.com/fo0/repo-tray/releases). If no release is listed, build the installer from source below.

The Windows x64 NSIS installer is **unsigned**. Download and run the EXE yourself; RepoTray does not automatically install updates or execute the downloaded installer. Access to private release downloads requires an authorized GitHub browser session. See [release and update behavior](docs/RELEASES.md).

### Native development

Prerequisites:

- **Node.js 24** and **pnpm 11.19.0**, as specified in `package.json`.
- A current stable **Rust** toolchain.
- The [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/). On Windows, install Microsoft C++ Build Tools with **Desktop development with C++**, use the MSVC Rust toolchain and provide the WebView2 runtime. Linux/macOS need their corresponding native development dependencies.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
```

To build the unsigned installer **on Windows**:

```sh
pnpm build:installer
```

Output is written under `src-tauri/target/release/bundle/nsis/`. Browser sign-in configuration is a separate publisher responsibility; building the app does not register a GitHub App or create authorization grants.

### Browser demo

The browser preview needs Node/pnpm only, without Rust or a GitHub account:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://127.0.0.1:1420**. This preview uses labelled synthetic accounts and local simulations. It does not authenticate with GitHub or start real workflows.

## Checks and builds

[Checks](.github/workflows/checks.yml) runs on pull requests and pushes to `main`. It checks the frontend, browser interactions, reproducible icons, Rust formatting/tests/Clippy and Windows desktop compilation, including automated Win32 popup/window-ownership tests. Normal checks do not package an installer. An unsigned validation installer can be requested explicitly through the workflow's `build_installer` input.

[Release](.github/workflows/release.yml) handles explicitly requested unsigned Windows releases with generated versions and changelogs. The release badge above follows manual runs on `main`; the checks badge follows main pushes. See [release documentation](docs/RELEASES.md) for the exact triggers and publishing process.

Local verification:

```sh
pnpm verify
pnpm exec playwright install chromium
pnpm test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --features network,native-credentials
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --no-default-features --features network,native-credentials --all-targets -- -D warnings
```

With Windows native prerequisites installed:

```sh
cargo check --locked --manifest-path src-tauri/Cargo.toml --features desktop
cargo test --locked --manifest-path src-tauri/Cargo.toml --features desktop --bin repotray
```

`pnpm verify` includes type checks, unit tests, release-helper tests, formatting, icon byte reproduction and the frontend production build. Fixture/browser tests and compilation do not establish real GitHub permissions, OS credential-store behavior, WebView2 login or interactive tray/DPI acceptance. Those require an owner-controlled native Windows session; see [verification boundaries](docs/VALIDATION.md) and [Windows popup checks](docs/WINDOWS_POPUP_VALIDATION.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md) and [roadmap](docs/ROADMAP.md)
- [Account selection](docs/ACCOUNT_SELECTION.md), [browser authentication](docs/BROWSER_AUTH.md) and [local authentication](docs/LOCAL_AUTH.md)
- [UX checks and local screenshots](docs/UX_REVIEW.md)
- [Asset sources and reproduction](docs/ASSETS.md)
- [Source-distribution review boundaries](docs/DISTRIBUTION.md)

## License and provenance

[MIT](LICENSE). Dependencies retain their own licenses. Application icons and UI glyphs are defined from repository-native geometry; their editable sources and deterministic generator are documented in [Asset sources](docs/ASSETS.md).

RepoTray is an independent project and is not affiliated with GitHub. OpenQuota informed the desktop architecture.
