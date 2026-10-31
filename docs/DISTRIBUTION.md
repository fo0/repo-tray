# Preparing a source distribution

Use the reviewed branch's tracked tree as the source for a fresh repository. Keep `.gitignore` and `.gitattributes`. Do not copy the old `.git` directory, local review packages, browser profiles, caches, databases, credentials, dependency directories or build outputs into a public source tree.

The browser demo and tests use fictional identities. Public project links, the stable app identifier and upstream documentation references remain intentional. Runtime account data belongs in the native OS credential store/cache, never in fixtures or captures.

## Review boundaries

The cleanup covers tracked source, configuration, workflows, documentation and bundled image metadata. Local review images/PDF/archive were inspected separately and excluded from the source tree. Generated dependency/build directories are not publication inputs. A clean tracked-tree export avoids carrying ignored files into a later re-init.

A new commit does not remove earlier names or data from Git history, old branches, release binaries, CI logs or previously shared screenshots. If retaining any of those, review them separately. Reinitializing inside an existing `.git` directory does not create a history-free repository. If an actual credential is ever found, remove it and rotate it through its provider; deleting text alone is insufficient.

Secret scanning and manual review reduce risk but cannot guarantee that every sensitive value is recognized. Scan the final exported tree again before making it public, and review the first commit's author metadata.

## Licenses and assets

The existing project MIT license is retained unchanged. No new rights or license are assigned by this cleanup. OpenQuota remains credited as an architectural reference; its code/assets are not bundled according to the project provenance notes.

Package-manager metadata supplies license expressions for all resolved Rust packages and production npm dependencies checked in this review. Those dependencies retain their own licenses; do not treat the project MIT license as a replacement. Platform-specific/build dependencies include additional terms such as MPL-2.0 and Unicode data licenses. Preserve applicable upstream notices when distributing binaries.

The bundled raster icons and inline SVG glyphs were replaced with RepoTray geometry constructed from basic primitives. Their editable sources, deterministic generator and output sizes are documented in [Asset sources](ASSETS.md). No external artwork or GitHub logo is bundled. This establishes the construction of the current replacements; it makes no rights assertion for the superseded assets in history or existing releases. GitHub names remain intentional service references.

## Repository configuration

Choose the final public repository identity yourself. Check its release endpoints, GitHub App configuration and workflow permissions against that choice. This branch does not change visibility, publish a public release, reinitialize Git, rewrite history or configure credentials. Existing private releases remain separate from the reviewed source tree.
