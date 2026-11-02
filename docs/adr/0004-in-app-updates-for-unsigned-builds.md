# ADR-0004: In-app updates for unsigned builds

- **Status:** Accepted
- **Date:** 2026-11-01
- **Decider(s):** owner
- **Tags:** updates, release, security

## Context

The standard _Release_ Action publishes an unsigned NSIS EXE without updater artifacts (`createUpdaterArtifacts: false`; no updater key, no certificate). The Tauri updater needs a signed feed, so these builds ran in notify-only mode: they announced a newer release and offered „Release-Seite öffnen“; the user downloaded and ran the EXE by hand. The owner wants a real update inside the app (`agent_docs/ux_rules.md`, rule 9). The release workflow stays unchanged.

## Decision

We will install updates in the app for unsigned standard builds. The check reads `https://api.github.com/repos/fo0/repo-tray/releases/latest` unauthenticated, accepts only a canonical stable `vX.Y.Z` newer than the running version, and requires the asset `RepoTray_<version>_x64-setup.exe` with GitHub's `sha256` digest and its size. A banner „Update <v> verfügbar“ (with „Ansehen“ and „Hinweis schließen“) leads to the Updates tab, which shows „Version <v> verfügbar“ with at most 5 changelog bullets. „Installieren“ calls one native command, `install_update`, which downloads the asset unauthenticated over HTTPS (redirects only to GitHub hosts) with progress, verifies size and SHA-256, writes the EXE to `%TEMP%\RepoTray-update-<version>\`, runs the NSIS installer passively (`/P /R /UPDATE`, current-user install, no `/ARGS`) and exits; the installer restarts the app without launch arguments. There is no release-page link. Builds compiled with an updater public key keep the signed Tauri updater path behind the same command.

## Consequences

### Positive

- One click on „Installieren“ from the offer to the restarted new version; no browser, no manual download.
- A truncated or corrupted download, or one that differs from the published asset, is rejected before anything runs.
- No signing key, certificate or workflow change is needed.

### Negative / Trade-offs

- **Trust is GitHub's TLS plus the release asset digest of `fo0/repo-tray` — the same trust as a manual download from the Releases page, and no more.** There is no publisher signature: whoever can publish a release in that repository (a compromised account or token included) can ship an installer the app will run after „Installieren“. The digest proves that the bytes are the ones GitHub stores for that asset, not who built them.
- The EXE carries no Authenticode signature, so Windows shows no verified publisher for the installer.
- The relaunch carries no `--autostart`: after an update the panel opens even when the app had started from login.
- Older `%TEMP%\RepoTray-update-<version>\` folders are not removed (BACKLOG #30); release notes still say to install the EXE manually (BACKLOG #31).

### Neutral

- The update check needs no account or token and is independent of the active account.
- A fork changes the repository-bound constants: `LATEST_RELEASE_API`, `validate_download_url` and `ENDPOINT` in `updates.rs`, `file_name` in `updates/installer.rs` (`docs/DISTRIBUTION.md`).

## Alternatives Considered

- **Keep notify-only („Release-Seite öffnen“)** — rejected by the owner: never send the user to a web page to update.
- **Sign releases and use the Tauri updater feed** — not chosen now: needs a signing key in the release workflow, which stays unchanged.

## References

- #18 (owner feedback), `agent_docs/ux_rules.md`, `docs/RELEASES.md`
- `src-tauri/src/updates.rs`, `src-tauri/src/updates/installer.rs`, `src-tauri/src/desktop_updates.rs`, `src-tauri/tauri.release.conf.json`
- `src/lib/updater.svelte.ts`, `src/lib/UpdatePanel.svelte`, `src/lib/StatusBanners.svelte`, `tests/update-install.spec.ts`
