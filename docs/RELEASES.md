# Windows releases without signing requirements

The standard **Release** Action builds and publishes the unsigned Windows x64 NSIS EXE. It requires only the repository-provided `GITHUB_TOKEN` for publication. No Tauri signing key, updater public key, certificate, `.sig`, or `latest.json` is required. `src-tauri/tauri.release.conf.json` explicitly sets `createUpdaterArtifacts: false`; the Action has no signing preflight or signing-secret bindings.

## App updates

Standard unsigned builds run in **notify mode**. At startup and every 6 hours they read the public GitHub `releases/latest` API for `fo0/repo-tray`, unauthenticated and only on `api.github.com` (no redirects, bounded response). If a newer stable release exists, the panel announces it and **Release-Seite öffnen** opens exactly that release's tag page. The app never downloads or installs anything itself; the user downloads and runs the new EXE. Drafts and prereleases are ignored. Account selection does not affect this check (`src-tauri/src/updates.rs`, `src-tauri/src/desktop_updates.rs`, `src/lib/UpdatePanel.svelte`).

Builds compiled with an updater public key (`REPOTRAY_UPDATER_PUBLIC_KEY`, separately configured) use the Tauri updater instead: they download inside the app, verify the signature and install only after a second explicit confirmation. The standard Release Action generates no signed updater artifacts and publishes no `latest.json`, so the built-in signed feed (`releases/latest/download/latest.json`) currently resolves to nothing. Once signing is introduced, signed builds need a dedicated feed URL that serves only signed manifests.

A Tauri updater signature and a Windows Authenticode certificate are different mechanisms; neither is needed to publish the standard EXE.

## Checks and release triggers

Pushes to `main` run every job: frontend/browser checks, Rust tests/lints, native Windows clippy and Windows tests. Pull requests always run the frontend job; the Rust job runs only when they touch `src-tauri/`, `fixtures/` or the Checks workflow, the Windows job only when they touch those, `scripts/`, any workflow, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` or `.node-version`; renamed files count with their old and new path. A manual **Actions → Checks → Run workflow** checks everything on the chosen branch. Checks never builds an installer: for a validation EXE without publishing, run **Actions → Installer → Run workflow** on any branch; it uploads the unsigned NSIS EXE as a 14-day artifact.

For a published release, run **Actions → Release → Run workflow** on `main`; it is the only release path. It first waits (up to 30 minutes, on a Linux runner) for the push Checks run of the `main` commit it builds and stops if that run failed, was cancelled or does not exist, so it can be started right after a merge. It never repeats those checks; the Windows job only builds and publishes. Commits and merges never start a release. Release publication uses the existing repository GITHUB_TOKEN; no additional signing secret is required.

Rust caches are separated for Linux core, Windows checks and installers; only runs on `main` save them. Release restores and refreshes the installer cache; an Installer run on `main` shares it. A first full optimized installer build can still take longer without a warm installer cache. No extra build is scheduled just to warm it.

## Automatic version and changelog

1. The workflow uses its immutable GitHub run creation time, preserving the version on retries. Numeric versions use UTC `YYYY.MMDD.HHmm`, with no leading zeroes in numeric components. For example, `2026-10-31T15:33Z` becomes `2026.1031.1533`; the release title displays `2026-10-31 16:33 (Berlin, GMT+1)`. This is semver/Windows compatible and stays chronological over midnight, year rollover and Berlin clock changes.
2. The same version is stamped into package.json, Tauri config, Cargo.toml and the root Cargo.lock entry in the build workspace. Development versions in Git stay unchanged; there is no bump commit or extra CI run. The generated `v…` tag targets the exact checked-out main source SHA.
3. GitHub generates the changelog from merged changes. An empty generated changelog uses a short default note and does not block an otherwise valid release. Release notes include timestamp, version and source SHA; no manual version-specific changelog entry or pre-created tag is required. The build workspace records its timestamp, version and source SHA for reproduction.
4. New builds reject existing tags/releases, stale versions, source mismatches or altered build plans. Two runs created in the same minute collide safely; inspect the first outcome and start a later run only if another release is needed. Existing assets/drafts are never overwritten by a blind retry.
5. It builds with `createUpdaterArtifacts: false` from `src-tauri/tauri.release.conf.json`. It runs `gh release create TAG INSTALLER --target SOURCE_SHA --title TITLE --notes-file NOTES --latest`. The CLI handles the upload and publication; no custom draft URL or installer-metadata gate is used. The workflow confirms that the result is published, downloads the EXE and compares its hash with the local build. A successful build is also retained as a CI artifact if publication fails.

If publication fails after the upload, `gh release create` can leave a draft with the EXE. Delete that draft, then re-run the failed release job (same run, same version) or start a new release; the workflow never overwrites or republishes an existing draft or asset.

The installer is a direct `.exe` release asset; no signature or updater-manifest sidecar is required. GitHub's optional CI artifact transport may wrap files in ZIPs; the user-facing release download is the EXE itself. Generated files live in ignored `release-work/`; no screenshot, private key or token is published.

## Runtime acceptance

Automated fixtures and Windows compilation do not prove a live account, native credential manager, Windows tray/DPI behavior or an actual installation. Those remain owner-controlled Windows checks. Browser OAuth still needs a separately approved GitHub App registration; the existing token alternative is implemented. Installations and account setup are user-controlled and are not performed by CI.

## Regression tests

`pnpm release:test` includes tests that execute the actual PowerShell run blocks from the Action against a temporary local Git repository and simulated GitHub/build commands. They cover the manual run's Checks gate (green, failed, missing), a complete keyless EXE release, and a failed or altered download of the published EXE. Nothing is published or installed. PowerShell 7 is required for these workflow tests on CI (provided by both GitHub runner images); local runs without PowerShell report them as skipped.
