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

`pnpm verify` runs Svelte/TypeScript diagnostics, frontend unit tests, release-helper tests, formatting and the production frontend build. Browser tests use synthetic local fixtures and a labelled native IPC mock. Rust tests exercise transport policy, input parsing, account/cache isolation, credential-adapter failure handling, uncertain dispatch persistence and release discovery.

The Windows CI job additionally compiles the actual desktop shell. Normal checks skip installer packaging; Release or an explicit manual installer request performs the NSIS build. CI results apply to the exact tested commit, not to later changes. See [release process](RELEASES.md).

## Test boundaries

Mocks do not establish live account permissions, device-flow authorization, OS credential-store behavior or native tray/DPI acceptance. Test those on an owner-controlled Windows system with locally entered credentials. Never put credentials in fixtures, screenshots, logs or reports.

Native browser device-flow code, explicit local gh/GCM credential import and Settings-based account selection are implemented. Actual browser login still depends on publisher GitHub App configuration and owner-controlled authorization; see [browser authentication](BROWSER_AUTH.md), [local authentication](LOCAL_AUTH.md) and [account selection](ACCOUNT_SELECTION.md). Windows popup behavior has separate [native validation boundaries](WINDOWS_POPUP_VALIDATION.md). Releases are unsigned, and update installation is manual.
