# Asset sources

The current application icons and UI glyphs were constructed for RepoTray from basic lines, circles and rectangles during the source-distribution cleanup. No external icon library, downloaded artwork, font glyph or previous raster image is an input. The existing project license is unchanged; this note does not assert authorship or rights for the superseded assets in older commits or releases.

## Application icons

`scripts/generate-icons.mjs` defines a rounded tile and three connected workflow nodes on a 64-unit canvas. That geometry and its colors are the editable source. The same definitions produce `src-tauri/icons/source.svg`, the 32, 128 and 256px PNGs, and a Windows ICO containing 16, 32, 48, 64, 128 and 256px PNG frames.

```sh
pnpm icons:generate
pnpm icons:check
```

The generator uses only Node.js standard-library file operations and its own geometric sampler/PNG/ICO writer. Four samples per axis provide edge coverage. RGBA PNGs use stored DEFLATE blocks, fixed scan order and no timestamps or text metadata, making output independent of compression-library versions. No network, image package or platform font is required. `icons:check` compares the derived bytes with the tracked files and is part of `pnpm verify`.

## UI and tray glyphs

`src/lib/Icon.svelte` contains the UI glyphs as explicit SVG primitives on a 24-unit canvas. It retains the existing names, dimensions, current-color styling and decorative accessibility behavior. The `github` name now selects a generic code-hosting symbol; service names remain in the surrounding text. No GitHub logo is bundled.

The runtime tray bitmap is separately constructed from rectangles in `src-tauri/src/desktop.rs` (`tray_image`). It has no external image input and is unchanged by this cleanup.

Generated review screenshots are local verification output, not source artwork. Dependency licenses and any future imported assets must be reviewed separately; this inventory is not a license for third-party material.
