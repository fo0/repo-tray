# RepoTray

[![Checks](https://github.com/fo0/repo-tray/actions/workflows/checks.yml/badge.svg?branch=main&event=push)](https://github.com/fo0/repo-tray/actions/workflows/checks.yml)
[![Windows release](https://github.com/fo0/repo-tray/actions/workflows/release.yml/badge.svg?branch=main&event=workflow_dispatch)](https://github.com/fo0/repo-tray/actions/workflows/release.yml)

<img src="src-tauri/icons/source.svg" alt="" width="64" height="64" align="right" />

**GitHub Actions within reach.** RepoTray is a compact Windows tray companion for monitoring runs, launching workflows and keeping frequently used launches as pinned templates.

Built with **Tauri 2, Rust, Svelte 5 and TypeScript**. Windows x64 is the primary target; other desktop platforms require their own native validation.

## What it does

- **A panel beside the tray icon.** Windows placement follows the clicked icon, monitor work area and DPI. Clicking outside hides the panel while preserving open forms and ongoing work. Closing the window keeps RepoTray in the tray; **RepoTray beenden** in the tray menu exits it.
- **Optional Windows login startup.** Enable **Einstellungen → App → Mit Windows starten** to launch directly in the tray after user login. It is off by default, reads the Windows registration and respects Windows' startup veto. Manual launches still open the panel. See [setup, updates and validation](docs/WINDOWS_AUTOSTART.md).
- **Repositories first.** Saved favorites appear directly below search, followed by compact repositories ordered by their most recent run activity. Expand a repository to configure or start a workflow, or save its default configuration with the heart button. Favorites also have their own **Favoriten** tab.
- **A separate activity history.** **Aktivität** shows every open run and the latest 50 completed runs across the selected account's repositories. Completed entries stay cached; status polling follows open runs until their final state and discovers newly created runs. Run times read relative (**gerade eben**, **vor 3 Min.**, **gestern**) and tick once a minute; the exact time is in the tooltip. Each run row offers opening the run on GitHub and **Link kopieren** without expanding it.
- **Keyboard first.** **F5** or **Ctrl+R** refreshes the panel instead of reloading it, **Ctrl+1/2/3** switch between **Repositories**, **Aktivität** and **Favoriten**, **/** focuses the search and **Esc** clears or leaves the search or closes a dialog. The search field's **Tastenkürzel** hint lists them.
- **Explicit workflow launches.** Choose a workflow, branch/tag and typed inputs. Save account-bound templates and opt in to quick launch when desired. A disabled start button names its one reason in its tooltip (for example **Kein Schreibzugriff auf dieses Repository** or **Offline – Starts sind deaktiviert**). Removing a favorite offers **Rückgängig** for a few seconds.
- **Deliberate account selection.** On first launch, **GitHub-Konto verbinden** opens the connection dialog and continues with the repository selection; further accounts are added with **Einstellungen → Konten → Konto hinzufügen**. Choose the active credential in the account menu at the top of the panel or under **Einstellungen → Konten → Aktives Konto**. The app remembers its stable nonsecret ID, distinguishes same-login sources and asks for a new selection if it disappears. It never silently falls back to another identity.
- **Cached state and uncertain-start protection.** Offline views keep cached activity. Ambiguous dispatch responses remain quarantined across reopening and restart to avoid blindly starting the same workflow twice; only **Sperre aufheben…** with an explicit confirmation releases the lock, and releasing never starts anything. An accepted dispatch is not a successful build.
- **Calm, accessible notices and styling.** Success notices close on their own after a few seconds, but not while hovered, focused or hidden behind a dialog; warnings and errors stay until closed. Metadata text meets WCAG AA contrast, keyboard focus has visible rings, and Windows High Contrast (forced colors) redraws state with system colors.
- **Release notifications.** Standard releases publish an unsigned Windows EXE without extra signing configuration. These builds check the public GitHub release list at startup and every 6 hours without a token, announce a newer stable release and open its release page; they never download or install anything themselves. In-app download and installation is reserved for separately configured signed builds, which verify signatures and install only after a second confirmation.

The active account controls the foreground view and new launches. Public app updates are independent of that account. Other connected accounts keep their selected-repository background monitoring; saved templates retain their original credential binding. See [account selection](docs/ACCOUNT_SELECTION.md).

## Sign in

The native app starts without demo accounts. Credentials are owned by the Rust service and stored in the operating system's credential vault; browser preferences contain only nonsecret selections.

| Method                            | Current behavior                                                                                                                                                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GitHub browser sign-in**        | Temporarily disabled in this version, including when publisher configuration is present. Use an existing gh CLI account or a personal access token.                                                                                                                               |
| **Personal access token**         | Enter an existing token; RepoTray verifies the identity before storing its own credential entry. Repository access, Actions permissions and organization/SSO restrictions still apply.                                                                                            |
| **Existing local gh CLI account** | On Windows, explicitly discover and select a gh account, then confirm before RepoTray verifies and copies it into its own vault namespace. Older gh versions are supported; discovery alone never connects an account. Disconnect removes the RepoTray copy, not the CLI account. |
| **Git Credential Manager**        | Discovery shows account metadata only. GCM credentials are not imported and Git/SSH access is not treated as GitHub API authentication.                                                                                                                                           |

Saved connections visibly show login, source and whether they are active in RepoTray. Browser, token and imported CLI credentials remain distinct. No automatic credential-source cascade is used. See [connection and permissions](docs/GITHUB_SETUP.md), [browser publisher configuration](docs/BROWSER_AUTH.md) and [local sign-in](docs/LOCAL_AUTH.md).

## Install or build

Published Windows installers, when available, are listed on the [Releases page](https://github.com/fo0/repo-tray/releases). If no release is listed, build the installer from source below.

The standard Windows x64 NSIS installer is **unsigned** and can be built and released without signing keys. Download and run the public EXE to install or update; when a newer release exists, the app announces it and links to its release page. The separately configured signed-updater path keeps its signature verification enabled; the standard Release Action does not create those updater artifacts. See [release and update behavior](docs/RELEASES.md).

### Native development

Prerequisites:

- **Node.js 24**, as pinned in `.node-version` (and `engines` in `package.json`), and **pnpm 11.19.0** (`packageManager` in `package.json`).
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

[Checks](.github/workflows/checks.yml) runs on pull requests and pushes to `main`. It checks the frontend, browser interactions, reproducible icons, Rust formatting/tests/Clippy and Windows desktop compilation, including automated Win32 popup/window-ownership and isolated autostart-registry tests. A failed browser test run uploads the Playwright report and test results as an artifact. Normal checks do not package an installer. An unsigned validation installer can be requested explicitly through the workflow's `build_installer` input.

[Release](.github/workflows/release.yml) handles explicitly requested unsigned Windows EXE releases with generated versions and changelogs. No additional signing key is required; see the release documentation. The release badge above follows manual runs on `main`; the checks badge follows main pushes. See [release documentation](docs/RELEASES.md) for the exact triggers and publishing process.

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
