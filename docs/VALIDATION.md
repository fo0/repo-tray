# Verification

## Local checks

```sh
pnpm verify
pnpm exec playwright install chromium
pnpm test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --features network,native-credentials
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --no-default-features --features network,native-credentials --all-targets -- -D warnings
```

`pnpm verify` runs Svelte/TypeScript diagnostics, frontend unit tests, release-helper tests, formatting and the production frontend build. Browser tests use synthetic local fixtures and a labelled native IPC mock. New browser/GitHub App sign-in is currently paused; its native guards and disabled UI are tested while the dormant OAuth implementation keeps its Rust regression tests. Local gh tests cover legacy CLI versions, explicit consent, stored connection feedback and account activation. Rust tests exercise transport policy, input parsing, account/cache isolation, credential-adapter failure handling, uncertain dispatch persistence and release discovery.

The Windows CI job additionally compiles the actual desktop shell and tests the autostart registry adapter in an isolated test subkey (never the real login Run key). Browser IPC mocks and core tests cover startup settings and launch decisions. See [Windows autostart behavior and acceptance](WINDOWS_AUTOSTART.md). Normal checks skip installer packaging; Release or an explicit manual installer request performs the NSIS build. CI results apply to the exact tested commit, not to later changes. See [release process](RELEASES.md).

## Test boundaries

Mocks do not establish live account permissions, device-flow authorization, OS credential-store behavior or native tray/DPI acceptance. Test those on an owner-controlled Windows system with locally entered credentials. Never put credentials in fixtures, screenshots, logs or reports.

Native browser device-flow code, explicit gh credential import with metadata-only GCM discovery, and Settings-based account selection are implemented. New browser login is temporarily disabled; future re-enabling depends on publisher GitHub App configuration and owner-controlled authorization; see [browser authentication](BROWSER_AUTH.md), [local authentication](LOCAL_AUTH.md) and [account selection](ACCOUNT_SELECTION.md). Windows popup behavior has separate [native validation boundaries](WINDOWS_POPUP_VALIDATION.md). Windows EXEs have no Authenticode certificate. Standard unsigned builds only announce a newer stable release and open its release page; in-app installation requires separately configured, publisher-signed builds and a second explicit confirmation. Browser IPC tests exercise the notify-only announcement and release-page opening as well as signed-mode progress, failed verification, retry and delayed installation, but do not prove an actual Windows upgrade. Verify old-to-new installation, automatic restart and preservation of accounts/preferences in a Windows session using releases signed with the same updater key.

## Native Windows smoke checklist

CI compiles the desktop shell and runs Win32 and registry tests, but it cannot prove the following. Check them on an authorized Windows test desktop with the branch build and locally entered credentials; record the build and Windows version, never credentials or screenshots with tokens.

1. **Snapshot events with the narrowed capabilities.** `src-tauri/capabilities/default.json` grants only event listen/unlisten, header dragging and the inert maximize toggle. Connect an account and start a workflow: the panel updates from `repotray:snapshot` events without a manual refresh, and no capability error appears.
2. **Header drag.** Dragging the header (`data-tauri-drag-region`), including over its title and status text, moves the panel; reopening it from the tray places it beside the icon again.
3. **No maximize.** Double-clicking the header does not maximize or resize the window (`maximizable: false`).
4. **Update notify mode (unsigned build).** With an older build installed and a newer stable release published, the banner **RepoTray `<version>` verfügbar** appears; **Update ansehen** opens the **Updates** tab, and **Release-Seite öffnen** opens exactly `https://github.com/fo0/repo-tray/releases/tag/v<version>` in the default browser. Nothing is downloaded or installed.
5. **Download progress (signed builds only).** **Update herunterladen** streams progress over the IPC `Channel` (**Wird heruntergeladen · …**, then **Download abgeschlossen · Signatur wird geprüft …**); **Installieren und neu starten** stays a separate step.
6. **Clipboard in WebView2.** **Link kopieren** on a run row places the canonical run URL on the Windows clipboard and shows **Link kopiert.**; the open-on-GitHub button opens the same URL in the default browser.
7. **Real High Contrast theme.** Turn on a Windows contrast theme (Settings → Accessibility → Contrast themes): switches, the current view tab, selected settings tab, filled favorite hearts, focus rings and the unsaved-selection marker stay visible. The Playwright `forced-colors` spec only emulates forced colors for the unsaved marker.
8. **Autostart after uninstall.** Enable **Mit Windows starten**, uninstall RepoTray, then inspect `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. **Known gap:** the `io.github.fo0.repotray` value is left behind because the installer has no uninstall hook (tracked as item 11 in the [backlog](../BACKLOG.md)); see [Windows startup](WINDOWS_AUTOSTART.md).

Tray placement, DPI and focus-loss behavior are covered by the [Windows popup acceptance](WINDOWS_POPUP_VALIDATION.md#interactive-windows-acceptance).
