# RepoTray

GitHub Actions within reach: a compact tray panel for seeing what is running and launching the workflows you use most.

**Independent project: [fo0/repo-tray](https://github.com/fo0/repo-tray).** Built from scratch with Tauri 2, Rust, Svelte 5 and TypeScript. OpenQuota inspired the desktop architecture; no OpenQuota source code, signing keys, updater configuration or Git history is copied.

> **Native app and browser preview differ.** The desktop app supports existing tokens, local gh CLI imports and a native GitHub App device-code browser flow. Browser login requires the publisher's actual public App configuration, which is not included; its button stays disabled until configured. All credentials stay in the OS vault. The browser preview uses labelled local fixtures only. See [browser sign-in](docs/BROWSER_AUTH.md).

## Try the panel

Requires Node.js 24 and pnpm 11.19.0 (or Corepack).

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:1420`. The same Svelte panel runs in the browser with a local demo bridge, without Rust or a GitHub account. Only demo repository selections and validated nonsecret pins are stored in browser storage.

## Desktop development

Install a current stable Rust toolchain and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS. On Windows this includes Visual Studio C++ Build Tools and WebView2. On Linux install WebKitGTK 4.1, GTK 3 and AppIndicator development packages.

```sh
pnpm desktop:dev
```

The native app runs the authenticated Rust service, initially without connected accounts. Left-click the tray icon to toggle the panel on Windows/macOS; the tray context menu also provides Show/Hide and Quit. Closing the panel keeps the app in the tray. Linux tray click events vary by desktop: use the menu when click events are unavailable. Quit from the tray menu to exit completely.

```sh
# On Windows; creates an unsigned NSIS installer
pnpm build:installer
```

Releases publish an unsigned Windows EXE without signing keys or certificates. The app checks private GitHub releases and shows the changelog plus an explicit browser-download button. Install the downloaded EXE manually; RepoTray does not download/execute an unsigned updater or restart the app. See [release documentation](docs/RELEASES.md).

## Interaction checks

The browser preview uses synthetic accounts and repositories. Browser tests cover account isolation, workflow launch forms, saved templates, uncertain starts, offline states, keyboard/touch access and narrow layouts. Optional local screenshots are generated into ignored output folders; they are not source assets. See [UX checks and reproduction](docs/UX_REVIEW.md).

## What is implemented

- Activity grouped by selected repositories, active runs first, status filters, expandable run details and search.
- Account context and full owner/repository identity throughout.
- Workflow launch forms with branch/tag, typed inputs, defaults and validation.
- Pinned launch templates; quick launch requires a deliberate opt-in.
- Demo cases for offline operation, missing permissions and an uncertain dispatch outcome.
- Native tray integration, account-scoped SQLite metadata cache and Rust-owned GitHub state.
- Compact shared title/status header, approximately 12% tighter spacing and preserved text/hit-target sizes.
- Native token/local sign-in and publisher-configured browser device flow with OS credential storage, safe refresh rotation, cancellation protection and disconnect; a separate browser-only simulated sign-in preview.
- Authenticated GitHub transport with ETag pagination/backoff, typed YAML/ref checks and persistent uncertain-start claims.
- Private release discovery, changelog and manual EXE download; no automatic unsigned installation.

A dispatch acknowledgement means the request was accepted, not that a build succeeded. An uncertain result is locked against automatic retry, since the server might already have started the run.

The native toolbar shows a compact status for the active account including its credential source; selection lives under Settings → Aktives Konto. That selection is remembered by nonsecret ID; missing accounts require reselection and no identity fallback occurs. Local sign-in is a distinct button. See [active-account semantics](docs/ACCOUNT_SELECTION.md).

## CI and releases

Normal CI is active in [Checks](.github/workflows/checks.yml). It verifies the frontend, browser interactions, Rust and native Windows compilation/tests. Automatic checks skip the full optimized installer build. To request an unsigned validation installer, manually run Checks with **Build an unsigned Windows validation installer** enabled (`build_installer: true`). Rust dependencies are cached separately for Linux, Windows checks and Windows installers.

[Release](.github/workflows/release.yml) generates a date/time version, tag and changelog automatically from `main`; no version bump or pre-created tag is needed. Start it manually, or explicitly include `[release]` in a main commit to publish only after that commit's Checks pass. Ordinary commits skip the release build. It publishes the unsigned EXE with the standard GitHub CLI release command and then verifies the downloaded file. A built draft can be published using `existing_tag` without rebuilding. Release titles show Berlin time; numeric versions use sortable UTC `YYYY.MMDD.HHmm` (without leading zeroes in components). No signing key, certificate, new credential, paid service or repository visibility change is required.

## Verification

```sh
pnpm verify
pnpm test:e2e
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features network,native-credentials
cargo clippy --manifest-path src-tauri/Cargo.toml --no-default-features --features network,native-credentials --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
# With native prerequisites installed:
cargo check --manifest-path src-tauri/Cargo.toml --features desktop
```

Browser tests use Playwright Chromium (`pnpm exec playwright install chromium` on a development machine). They never contact GitHub. See [architecture](docs/ARCHITECTURE.md), [GitHub setup boundary](docs/GITHUB_SETUP.md), [remaining work](docs/ROADMAP.md) and [validation record](docs/VALIDATION.md).

## License

MIT. RepoTray is an independent project and is not affiliated with GitHub.
