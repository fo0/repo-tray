# Windows releases and in-app updates

RepoTray uses the official Tauri 2 updater for its public Windows x64 releases. Users download updates inside **Einstellungen → Updates**, then explicitly choose **Installieren und neu starten**. The passive NSIS updater closes RepoTray, updates the existing installation and restarts it; there is no browser download or manual uninstall in this path. The application data directory and credential-vault namespace stay unchanged.

## Update behavior

Update discovery is public and independent of the selected GitHub account. No PAT, OAuth login or browser session is needed. The fixed endpoint is `https://github.com/fo0/repo-tray/releases/latest/download/latest.json`. Checks run at startup, every six hours and on request. **Update ansehen** opens the Updates tab directly.

The native service retains the update handle. It accepts only a newer stable version and the exact repository/version-bound Windows x64 EXE URL. Download progress is streamed to the UI; the Tauri updater verifies the complete installer's minisign signature before the app enables installation. `requireSignedVersion: true` binds the signed installer to the advertised version, and downgrades are disabled. Missing/invalid signatures, failed downloads or installation startup failures never claim success. Downloads can be retried; closing Settings or switching accounts preserves the pending update within the current process. Downloaded bytes are kept in memory and do not survive quitting the app.

The user confirms download and installation separately. Merely checking for an update or downloading it cannot install it. The installer uses Tauri's recommended `passive` mode and `/UPDATE` path; Windows may still show an OS security prompt. An updater signature verifies update authenticity; it is **not** an Authenticode certificate and does not remove SmartScreen warnings for an otherwise unsigned EXE.

### One-time publisher setup

Before releasing, create and securely back up one stable Tauri updater key pair locally:

```sh
pnpm tauri signer generate -w /secure/path/repotray-updater.key
```

Never commit the private key or paste it into chat. Configure these under the GitHub repository's Actions settings:

- Secret `TAURI_SIGNING_PRIVATE_KEY`: the private key file contents.
- Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password, if one was used.
- Variable `REPOTRAY_UPDATER_PUBLIC_KEY`: the matching `.pub` file contents, not a path.

The workflow checks that signing configuration is present before building. It embeds the public key in the app, builds the EXE and `.exe.sig`, generates `latest.json` with the changelog and version-bound signature, and uploads all three as one release. A missing signature or signed-version mismatch stops publication. The private key is supplied only to the build step. Keep the same key pair for subsequent releases; losing or changing it breaks updates for already installed builds.

The older browser-download builds cannot acquire this behavior retroactively. Install the first updater-enabled release once using the EXE; subsequent releases use the in-app flow. Previously published EXE-only releases do not provide an updater feed. This change does not create production signing keys, configure GitHub secrets or publish a release.

References: [Tauri updater and signing](https://v2.tauri.app/plugin/updater/), [Windows installer](https://v2.tauri.app/distribute/windows-installer/).

## Checks and release triggers

Ordinary pushes and pull requests run frontend/browser checks, Rust tests/lints, native Windows compilation and Windows core tests. They skip installer creation. To obtain a validation EXE without publishing, manually run **Actions → Checks → Run workflow** on `main` with **Build an unsigned Windows validation installer** enabled (`build_installer: true`, default off).

For a published release, either run **Actions → Release → Run workflow** on `main`, or explicitly include `[release]` in a main commit/merge message. The latter runs only after that exact source commit's Checks workflow succeeds. The workflow-run gate requires a push on `main` in this same repository; pull-request runs and failed checks cannot publish. Ordinary main commits create no release build. Release publication uses the existing repository GITHUB_TOKEN; update signing uses the separate publisher key described above.

Rust caches are separated for Linux core, Windows checks and installers. Release can restore the main installer cache. Manual runs on `main` may save it; the workflow-run path only restores caches. A first full optimized installer build can still take longer without a warm installer cache. No extra build is scheduled just to warm it.

## Automatic version and changelog

1. The workflow uses its immutable GitHub run creation time, preserving the version on retries. Numeric versions use UTC `YYYY.MMDD.HHmm`, with no leading zeroes in numeric components. For example, `2026-10-31T15:33Z` becomes `2026.1031.1533`; the release title displays `2026-10-31 16:33 (Berlin, GMT+1)`. This is semver/Windows compatible and stays chronological over midnight, year rollover and Berlin clock changes.
2. The same version is stamped into package.json, Tauri config, Cargo.toml and the root Cargo.lock entry in the build workspace. Development versions in Git stay unchanged; there is no bump commit or extra CI run. The generated `v…` tag targets the exact checked-out main source SHA.
3. GitHub generates the changelog from merged changes. Release notes include timestamp, version and source SHA; no manual version-specific changelog entry or pre-created tag is required. The build workspace records its timestamp, version and source SHA for reproduction.
4. The workflow rejects existing tags/releases, stale versions, source mismatches or altered metadata. Two runs created in the same minute collide safely; inspect the first outcome and start a later run only if another release is needed. Existing assets/drafts are never overwritten by a blind retry.
5. After checks it builds with `createUpdaterArtifacts: true` and the matching public key in generated `release-work/updater.config.json`. It runs `gh release create TAG INSTALLER SIGNATURE latest.json --target SOURCE_SHA --title TITLE --notes-file NOTES --latest`. The CLI handles the upload and publication; no custom draft URL or installer-metadata gate is used. The workflow confirms that the result is published, downloads the EXE and compares its hash with the local build. A successful build is also retained as a CI artifact if publication fails.

If a previous run already uploaded its EXE but stopped before publication, run Release on main with `existing_tag` set to that version. It requires the exact EXE, its signature and `latest.json`, checks every GitHub SHA-256 digest, source commit and feed/asset consistency, publishes the existing release and confirms it is no longer a draft. No installer rebuild or asset replacement occurs. The same operation can be explicitly requested in a main merge message as `[publish-existing:vYYYY.MMDD.HHmm]`; it runs only after successful Checks in this repository.

The installer is a direct `.exe` release asset alongside its `.sig` and `latest.json`. GitHub's optional CI artifact transport may wrap files in ZIPs; the user-facing release download is the EXE itself. Generated files live in ignored `release-work/`; no screenshot, private key or token is published.

## Runtime acceptance

Automated fixtures and Windows compilation do not prove a live account, native credential manager, Windows tray/DPI behavior or an actual installation. Those remain owner-controlled Windows checks. Browser OAuth still needs a separately approved GitHub App registration; the existing token alternative is implemented. Installations and account setup are user-controlled and are not performed by CI.
