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
