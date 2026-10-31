# Unsigned Windows releases and manual updates

RepoTray publishes an unsigned Windows x64 NSIS EXE. The owner explicitly requested releases without signing keys. No Tauri updater key, Authenticode certificate, new credential or paid service is required or created. Repository visibility stays private.

## Update behavior

The native app reads the latest private release using a connected account's token from the OS credential store. That account needs Contents: read for `fo0/repo-tray`. Tokens never enter browser URLs, UI state, release metadata or logs.

The app accepts only a newer stable release with one exact `RepoTray_VERSION_x64-setup.exe` asset. It validates the API asset URL and the matching GitHub browser-download URL against this repository and version. Drafts, prereleases, foreign URLs, duplicate/missing installers and older versions are rejected. Account changes invalidate pending update results.

Update checks run after connection, at startup for restored accounts, every six hours and on request in Settings. The user sees the changelog and chooses **EXE im Browser herunterladen**. The standard browser opens the exact EXE URL; it must be signed in with a GitHub account that can read the private repository. The user runs the downloaded EXE manually. The app neither executes an unsigned update nor restarts itself.

The Tauri updater plugin and installation IPC command are removed. Tauri requires signatures for its automatic updater; this implementation does not disable or bypass that verification. There are no `.sig` files or `latest.json` updater feed. SHA-256 checksums detect transfer mismatches; they are not publisher signatures. Windows may show its usual unknown-publisher/SmartScreen prompt for the unsigned EXE.

References: [Tauri updater signature requirement](https://v2.tauri.app/plugin/updater/#signing-updates), [GitHub private release assets](https://docs.github.com/en/rest/releases/assets?apiVersion=2026-03-10#get-a-release-asset). OpenQuota inspired the desktop architecture; its signing configuration and keys are not used.

## Checks and release triggers

Ordinary pushes and pull requests run frontend/browser checks, Rust tests/lints, native Windows compilation and Windows core tests. They skip installer creation. To obtain a validation EXE without publishing, manually run **Actions → Checks → Run workflow** on `main` with **Build an unsigned Windows validation installer** enabled (`build_installer: true`, default off).

For a published release, either run **Actions → Release → Run workflow** on `main`, or explicitly include `[release]` in a main commit/merge message. The latter runs only after that exact source commit's Checks workflow succeeds. The workflow-run gate requires a push on `main` in this same repository; pull-request runs and failed checks cannot publish. Ordinary main commits create no release build. No new token or account grant is needed: the job uses its existing repository GITHUB_TOKEN.

Rust caches are separated for Linux core, Windows checks and installers. Release can restore the main installer cache. Manual runs on `main` may save it; the workflow-run path only restores caches. A first full optimized installer build can still take longer without a warm installer cache. No extra build is scheduled just to warm it.

## Automatic version and changelog

1. The workflow uses its immutable GitHub run creation time, preserving the version on retries. Numeric versions use UTC `YYYY.MMDD.HHmm`, with no leading zeroes in numeric components. For example, `2026-10-31T15:33Z` becomes `2026.1031.1533`; the release title displays `2026-10-31 16:33 (Berlin, GMT+1)`. This is semver/Windows compatible and stays chronological over midnight, year rollover and Berlin clock changes.
2. The same version is stamped into package.json, Tauri config, Cargo.toml and the root Cargo.lock entry in the build workspace. Development versions in Git stay unchanged; there is no bump commit or extra CI run. The generated `v…` tag targets the exact checked-out main source SHA.
3. GitHub generates the changelog from merged changes. Release notes include timestamp, version and source SHA; no manual version-specific changelog entry or pre-created tag is required. The build workspace records its timestamp, version and source SHA for reproduction.
4. The workflow rejects existing tags/releases, stale versions, source mismatches or altered metadata. Two runs created in the same minute collide safely; inspect the first outcome and start a later run only if another release is needed. Existing assets/drafts are never overwritten by a blind retry.
5. After checks it builds with `createUpdaterArtifacts: false`. It runs the standard `gh release create TAG INSTALLER --target SOURCE_SHA --title TITLE --notes-file NOTES --latest` command. The CLI handles the upload and publication; no custom draft URL or installer-metadata gate is used. The workflow confirms that the result is published, downloads the EXE and compares its hash with the local build. A successful build is also retained as a CI artifact if publication fails.

If a previous run already uploaded its EXE but stopped before publication, run Release on main with `existing_tag` set to that version. It downloads that exact EXE, checks its GitHub SHA-256 digest and source commit, publishes the existing release and confirms it is no longer a draft. No installer rebuild or asset replacement occurs. The same operation can be explicitly requested in a main merge message as `[publish-existing:vYYYY.MMDD.HHmm]`; it runs only after successful Checks in this repository.

The installer is a direct `.exe` release asset. GitHub's optional CI artifact transport may wrap files in ZIPs; the user-facing release download is the EXE itself. Generated files live in ignored `release-work/`; no screenshot, key or token is published.

## Runtime acceptance

Automated fixtures and Windows compilation do not prove a live account, native credential manager, Windows tray/DPI behavior or an actual installation. Those remain owner-controlled Windows checks. Browser OAuth still needs a separately approved GitHub App registration; the existing token alternative is implemented. Installations and account setup are user-controlled and are not performed by CI.
