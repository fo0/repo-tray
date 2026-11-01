# Memory — Long-Term

Stable project knowledge. **Read at session start.**

## Architecture Decisions

### Unsigned Windows releases, versions from the run timestamp

- **Date:** 2026-10-31
- **Context:** Releases must work without signing keys or certificates.
- **Decision:** The standard _Release_ Action publishes an unsigned NSIS EXE (`createUpdaterArtifacts: false` in `src-tauri/tauri.release.conf.json`). The version is `YYYY.MMDD.HHmm` (UTC) from the immutable run creation time, stamped only into the build workspace — Git keeps `0.1.0`, no bump commit.
- **Reason:** Retries keep the same version; no secrets beyond `GITHUB_TOKEN`. The Tauri updater stays implemented for separately signed builds only. Detail: `docs/RELEASES.md`.

### Browser / GitHub App sign-in is paused

- **Date:** 2026-10-31
- **Context:** No publisher GitHub App is registered.
- **Decision:** New device-flow sign-ins are disabled in UI and native commands, even in configured builds; the code and its Rust tests stay. PAT and explicit local gh import are the active paths.
- **Reason:** Re-enabling needs owner-side GitHub App setup (`docs/BROWSER_AUTH.md`); do not "fix" the disabled button.

## Gotchas & Pitfalls

- **`[release]` in a `main` commit/merge message publishes a release** once Checks pass; `[publish-existing:vYYYY.MMDD.HHmm]` publishes an existing draft. Never write either unprompted. (2026-11-01)
- **`pnpm lint` is `prettier --check .`** — it covers Markdown and JSON too, so agent docs, `BACKLOG.md` tables and `.claude/settings.json` must be formatted (`pnpm format`) or CI fails. (2026-11-01)
- **`--features desktop` does not build on Linux.** Local/Linux Rust checks use `--no-default-features --features network,native-credentials`; Win32 popup tests (`--features desktop --bin repotray`) run only in the CI Windows job. A Linux Windows-target compile is compilation evidence only. (2026-10-31)
- **`release:test` skips the workflow tests without PowerShell 7** (`# SKIP Install PowerShell 7`); CI runners have it, a cloud container usually does not — a local pass there does not cover `release.yml`. (2026-11-01)
- **`gh release view` has no `databaseId` field** — the release workflow reads releases via the REST tag endpoint instead. (2026-10-31)
- **gh `--no-refresh` only when the installed gh supports it** — passing it unconditionally broke older gh versions during local-account discovery (`src-tauri/src/local_auth.rs` probes the command help first). (2026-10-31)
- **Popup dismissal is generation-guarded**: blur hides after 120 ms, every tray gesture/focus/reopen bumps a generation that cancels stale hides — keep that when touching `src-tauri/src/tray_popup.rs` / `popup.rs`. (2026-10-31)
- **`ci/checks.yml` is an inactive historical copy**; the live workflow is `.github/workflows/checks.yml`. Edit only the latter. (2026-11-01)
- **`docs/review/` and screenshots are gitignored** and never published; capture scripts assert demo mode. (2026-10-31)

## External Dependencies

- **GitHub REST `2026-03-10`** — dispatch responses include the exact run ID; a legacy 204, timeout or malformed response stays _uncertain_ and is quarantined, never re-sent. (2026-10-31)
- **gh CLI / Git Credential Manager** — gh accounts are imported only after explicit consent (`auth token --user <login>`); GCM is metadata-only, never `git credential fill`. Child processes get a minimal env, closed stdin, 64 KiB output and 20 s caps. (2026-10-31)
- **Credential namespaces** — PAT `github-<id>`, imported gh `github-gh-<id>`, device flow `github-device-<id>`; one GitHub user can have several distinct connections. (2026-10-31)
- **OpenQuota** (`fo0/OpenQuota`) informed the desktop/popup architecture; it was only read, never modified or bundled. (2026-10-31)

## User Preferences

- **Chat in German, direct, no filler**; generated files and commits in English (owner, 2026-11-01)
