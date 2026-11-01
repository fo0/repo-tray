# Preparing a source distribution

Use a reviewed commit's tracked tree as the source for a fresh repository. Keep `.gitignore` and `.gitattributes`. Do not copy the old `.git` directory, local review packages, browser profiles, caches, databases, credentials, dependency directories or build outputs into a public source tree.

The browser demo and tests use fictional identities. Public project links, the stable app identifier and upstream documentation references are intentional. Runtime account data belongs in the native OS credential store/cache, never in fixtures or captures.

## Review boundaries

A source review covers tracked source, configuration, workflows, documentation and bundled image metadata. Local review images, PDFs and archives are not part of the tracked tree and need their own review before sharing. Generated dependency/build directories are not publication inputs. A clean tracked-tree export avoids carrying ignored files into a later re-init.

A new commit does not remove earlier names or data from Git history, old branches, release binaries, CI logs or previously shared screenshots. If retaining any of those, review them separately. Reinitializing inside an existing `.git` directory does not create a history-free repository. If an actual credential is ever found, remove it and rotate it through its provider; deleting text alone is insufficient.

Secret scanning and manual review reduce risk but cannot guarantee that every sensitive value is recognized. Scan the final exported tree again before making it public, and review the first commit's author metadata.

## Licenses and assets

The project is MIT licensed. Preparing a distribution assigns no additional rights or license. OpenQuota is credited as an architectural reference; its code and assets are not bundled.

Package-manager metadata supplies license expressions for the resolved Rust packages and production npm dependencies. Those dependencies retain their own licenses; the project MIT license does not replace them. Platform-specific/build dependencies include additional terms such as MPL-2.0 and Unicode data licenses. Preserve applicable upstream notices when distributing binaries.

The bundled raster icons and inline SVG glyphs are RepoTray geometry constructed from basic primitives. Their editable sources, deterministic generator and output sizes are documented in [Asset sources](ASSETS.md). No external artwork or GitHub logo is bundled. This describes the construction of the current assets; it makes no rights assertion for superseded assets in history or existing releases. GitHub names are intentional service references.

## Repository configuration

Choose the final public repository identity yourself and check its release endpoints, GitHub App configuration and workflow permissions against that choice. The app's update check and release links point at `fo0/repo-tray` (`src-tauri/src/updates.rs`); a different identity needs those constants changed. Preparing a source tree does not change repository visibility, publish a release, reinitialize Git, rewrite history or configure credentials.
