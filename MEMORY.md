# Memory — Long-Term

Stable project knowledge. **Read at session start.**

## Architecture Decisions

### Unsigned Windows releases, versions from the run timestamp

- **Date:** 2026-10-31
- **Context:** Releases must work without signing keys or certificates.
- **Decision:** The standard _Release_ Action publishes an unsigned NSIS EXE (`createUpdaterArtifacts: false` in `src-tauri/tauri.release.conf.json`). The version is `YYYY.MMDD.HHmm` (UTC) from the immutable run creation time, stamped only into the build workspace — Git keeps `0.1.0`, no bump commit.
- **Reason:** Retries keep the same version; no secrets beyond `GITHUB_TOKEN`. The Tauri updater stays for separately signed builds; unsigned builds update per ADR-0004. Detail: `docs/RELEASES.md`.

### Unsigned builds update in the app

- **Date:** 2026-11-01
- **Decision:** Owner reversed notify-only („Release-Seite öffnen“): unsigned builds download the release EXE, verify size + SHA-256 against GitHub's asset digest and run the NSIS installer (`/P /R /UPDATE`, no `/ARGS`), which restarts the app without `--autostart`. Trust trade-off and detail: [ADR-0004](docs/adr/0004-in-app-updates-for-unsigned-builds.md).

### Uncertain starts are released only by an explicit confirmation

- **Date:** 2026-11-01
- **Context:** An ambiguous dispatch quarantines its target; the lock used to have no way out.
- **Decision:** Claims persist with `claimed_at`, appear as `Snapshot.uncertainStarts`, and are released only by `release_uncertain_start` after the user confirms „Ich habe die Runs auf GitHub geprüft – Sperre aufheben“; release never dispatches and must match the exact claim. Disconnecting an account deletes its claims (the confirmation warns).
- **Reason:** Keeps "never auto-retry an uncertain dispatch" while giving users a deliberate way out.

### Browser / GitHub App sign-in is paused

- **Date:** 2026-10-31
- **Context:** No publisher GitHub App is registered.
- **Decision:** New device-flow sign-ins are disabled in UI and native commands, even in configured builds; the code and its Rust tests stay. PAT and explicit local gh import are the active paths.
- **Reason:** Re-enabling needs owner-side GitHub App setup (`docs/BROWSER_AUTH.md`); do not "fix" the disabled button.

## Gotchas & Pitfalls

- **Releases are manual only** (owner decision) — _Actions → Release → Run workflow_ on `main` runs `ci.yml` for that commit, then builds and publishes; merges and commit messages never release. Never start one unprompted. (2026-11-01)
- **`pnpm lint` is `prettier --check . && eslint .`** — prettier covers Markdown and JSON too; `pnpm check` runs svelte-check on `tsconfig.app.json` and `tsconfig.node.json`. The husky pre-commit hook (`.husky/pre-commit` → lint-staged → `prettier --write --ignore-unknown`, `rustfmt` for `*.rs`) formats staged files; it is installed by the `prepare` script on `pnpm install`. Never `--no-verify`. (2026-11-01)
- **`--features desktop` is built and tested only on Windows in CI** (Linux/macOS need Tauri system libraries and are unvalidated). Linux Rust checks use `--no-default-features --features network,native-credentials`; Win32 popup tests (`--features desktop --bin repotray`) run only in the CI Windows job. A Linux Windows-target compile is compilation evidence only. With Tauri's Linux libs installed (`libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libxdo-dev`), `cargo clippy --features desktop` runs on Linux too — `cfg(windows)` code stays Windows-CI-only. (2026-11-01)
- **`release:test` skips the workflow tests without PowerShell 7** (`# SKIP Install PowerShell 7`); CI runners have it, a cloud container usually does not — a local pass there does not cover `release.yml`. A portable PowerShell 7 plus `POWERSHELL_EXECUTABLE=<path>/pwsh` runs them for real. (2026-11-01)
- **gh `--no-refresh` only when the installed gh supports it** — passing it unconditionally broke older gh versions during local-account discovery (`src-tauri/src/local_auth/gh.rs` probes the command help first). (2026-10-31)
- **Popup dismissal is generation-guarded**: blur hides after 120 ms, every tray gesture/focus/reopen bumps a generation that cancels stale hides — keep that when touching `src-tauri/src/tray_popup.rs` / `popup.rs`. (2026-10-31)
- **Release git reads run without credentials** — checkouts use `persist-credentials: false`; `git ls-remote`/`fetch` in `release.yml` rely on the repository being public. If it goes private, pass the token explicitly to those steps. (2026-11-01)
- **PR Checks skip `rust-core` / `windows-desktop` when the PR touches none of their paths** — the `changes` job in `ci.yml` decides; extend its patterns when Rust or release code starts reading files elsewhere (Rust tests already embed `fixtures/`). Release runs always run everything. (2026-11-01)
- **Every `run:` line of `release.yml` executes in `scripts/release-workflow.test.mjs`** under PowerShell with mocked `gh`, `pnpm`, `cargo`, `rustup` — a new tool in a release step needs a mock there, or the test runs the real one. (2026-11-01)
- **Local Playwright in the cloud container** needs `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-<rev>/chrome-linux64/chrome` (the project pins a newer Playwright than the preinstalled browser); `E2E_PORT` gives each checkout its own dev server. (2026-11-01)
- **Agent worktrees start from local `main`**, which can be stale — reset a worktree onto the working branch before editing. (2026-11-01)
- **The SQLite cache is versioned (`PRAGMA user_version`)** — a build refuses a newer schema, so downgrading after a migration fails at startup by design. (2026-11-01)
- **`docs/review/` and screenshots are gitignored** and never published; capture scripts assert demo mode. (2026-10-31)
- **Playwright emulates a light OS by default**; `playwright.config.ts` sets `colorScheme: 'dark'` so specs that assert token colors see the dark set. Light and the override live in `tests/theme.spec.ts`; capture scripts run both themes. New colors go into `src/styles/00-tokens.css` (both light blocks) — `tokens.test.ts` rejects literals elsewhere. Its contrast pairs lay one tint on an opaque surface: a tinted element inside another tint needs its own opaque base (`linear-gradient(var(--x-soft), var(--x-soft)), var(--raised)`). (2026-11-01)

## External Dependencies

- **GitHub REST `2026-03-10`** — dispatch responses include the exact run ID; a legacy 204, timeout or malformed response stays _uncertain_ and is quarantined, never re-sent. (2026-10-31)
- **gh CLI / Git Credential Manager** — gh accounts are imported only after explicit consent (`auth token --user <login>`); GCM is metadata-only, never `git credential fill`. Child processes get a minimal env, closed stdin, 64 KiB output and 20 s caps. (2026-10-31)
- **Credential namespaces** — PAT `github-<id>`, imported gh `github-gh-<id>`, device flow `github-device-<id>`; one GitHub user can have several distinct connections. (2026-10-31)
- **OpenQuota** (`fo0/OpenQuota`) informed the desktop/popup architecture; it was only read, never modified or bundled. (2026-10-31)

## User Preferences

- **Chat in German, direct, no filler**; generated files and commits in English (owner, 2026-11-01)
- **Simple subagent work may run at effort `high`** on the session's model instead of inheriting the session effort (owner, 2026-11-01)
- **Never reintroduce manual repository selection** — the owner asked three times before the picker went; repositories are automatic ([ADR-0003](docs/adr/0003-automatic-repositories.md)), UI rules in `agent_docs/ux_rules.md` (owner, 2026-11-01)
