# ADR-0002: Single overview with maximizable sections

- **Status:** Accepted; partly superseded — the repository part of „Inline account and repository management“ and the 6-repository cap by [ADR-0003](0003-automatic-repositories.md), the header with **Zurück zur Übersicht** by [ADR-0005](0005-maximize-toggles-in-place.md)
- **Date:** 2026-11-01
- **Decider(s):** both (owner approved the „Ein Blick“ variant and the maximize buttons; agent implements)
- **Tags:** ui, navigation, accessibility

## Context

The tray panel had three view tabs: **Repositories** (favorites plus repositories), **Aktivität** (run history) and **Favoriten** (favorite cards plus a workflow list). A quick look at the tray icon needed a tab switch to see what runs right now, the favorites appeared in two tabs, and the workflow list repeated what the repository disclosures already offered. Account switching and repository selection lived only in the settings dialog. The UI revamp (#14) compared three variants; the owner chose „Ein Blick“ (no tabs, everything important on one page) and asked for a maximize button on every section header for a deeper look.

The panel is a 360–480 px popup with a 560 px minimum height, works with the keyboard first (Ctrl+1/2/3, `/`, Esc) and must keep the dispatch-quarantine and start-gate behaviour unchanged.

## Decision

We will show one overview instead of tabs: **Läuft gerade** (open runs), **Favoriten** and **Repositories**, each a region named by its heading, with a count and an icon-only maximize button. A maximized page (**Verlauf**, **Favoriten**, **Repositories**) fills the panel body under a header with **Zurück zur Übersicht** _(superseded by ADR-0005)_; the overview caps its sections at 3 runs, 4 favorites and 6 repositories _(repositories: 10, ADR-0003)_, offers **+N weitere** when capped and lifts the caps while a search is active. One search field filters every section and page. `PanelView` (`src/lib/view.svelte.ts`) owns the page, the search, the Verlauf filter and the way back; Ctrl+1/2/3 keep their former content per key and toggle the page; Esc clears the search first, then lets an open menu or dialog close, then returns to the overview. Opening a page focuses its title, going back focuses the opener (found again by `data-focus-key` when the overview was rebuilt) or the section's maximize button. Every „show run“ path opens the Verlauf with that run expanded.

The same revamp also decides:

- **Inline account and repository management (step 4).** _(Repository part superseded by ADR-0003.)_ The account menu in the app bar switches accounts directly (step 1); repositories are added and removed in the panel: the page **Repositories im Tray** (opened by „+ Hinzufügen“, the empty state and a fresh connection), **Nicht im Tray** while searching and a „⋯“ menu per repository row. Every change applies at once with **Rückgängig**; the settings dialog no longer has a Repositories tab or an unsaved-selection question.
- **Theme preference is frontend-only (step 5).** System, light or dark is stored in `localStorage` (`repotray.theme.v1`) like the active account and applied before mount (`src/lib/theme.ts`); „System“ is pure CSS (`prefers-color-scheme`), an explicit choice sets `data-theme` on `<html>`. It needs no IPC and no Rust change.
- **No repository page link yet.** Opening a repository on GitHub needs an `open_repo` command, because `open_run` accepts run URLs only; recorded as BACKLOG #24.

## Consequences

### Positive

- One glance shows running work, favorites and repositories; no tab switch for the common case.
- Favorites and the workflow list are no longer duplicated; the repository disclosures are the one place to start any workflow, and **Workflow starten …** stays on the Favoriten page.
- The maximize button, Ctrl+1/2/3 and Esc give the same deeper look by pointer and keyboard, with predictable focus.

### Negative / Trade-offs

- A page switch rebuilds the overview, so focus return needs `data-focus-key` on openers that live in it.
- The overview shows only capped lists; seeing everything takes one click (**+N weitere**) or a search.
- Without an account or selected repositories _(repositories: superseded by ADR-0003)_ the overview shows only that next step, so the maximize buttons appear once there is data; the shortcuts still reach every page.

### Neutral

- The `ViewTabs`, `LaunchView`, `WorkflowList` and `RepositoriesView` components are gone; `PanelBody`, `Overview`, `SectionHeader`, `SectionPage`, `LiveRuns`, `FavoritesPage` and `ReposPage` replace them. `AppHeader` and `Toolbar` merged into `AppBar` with `AccountMenu`, `PinnedFavorites` gave way to `FavoriteTiles`, and `ReposTab` to `RepoPicker`, `NotInTray` and `RepoMenu` on `RepoSelection` (`src/lib/repoSelection.svelte.ts`) _(`RepoPicker`, `NotInTray` and `RepoSelection` superseded by ADR-0003; `RepoMenu` stays)_.

## Alternatives Considered

- **Keep the three tabs with a new skin (V1)** — rejected: it keeps the tab switch for the most common look and the duplicated favorites.
- **Two tabs, Übersicht and Verlauf (V2)** — rejected: still a switch to see history, and no answer for favorites and repositories at full size.
- **Collapsible sections instead of maximized pages** — rejected: a long section pushes the others out of the 560 px window; a page with its own header and back button _(back button superseded by ADR-0005)_ keeps the overview stable.

## References

- Issue #14 (UI revamp), plan `docs/review/ui-revamp/plan.md` (local, ignored)
- `src/lib/view.svelte.ts`, `src/lib/PanelBody.svelte`, `src/lib/Overview.svelte`, `src/lib/shortcuts.ts`, `src/lib/focus.ts`, `src/lib/repoSelection.svelte.ts` _(superseded by ADR-0003)_, `src/lib/RepoPicker.svelte` _(superseded by ADR-0003)_, `src/lib/theme.ts`, `src/styles/00-tokens.css`
- `tests/overview.spec.ts`, `tests/repo-picker.spec.ts` _(superseded by ADR-0003)_, `tests/repo-picker-native.spec.ts` _(superseded by ADR-0003)_, `tests/repo-menu.spec.ts`, `tests/theme.spec.ts`, `src/lib/view.test.ts`, `src/lib/repoSelection.test.ts` _(superseded by ADR-0003)_, `src/lib/theme.test.ts`, `src/lib/tokens.test.ts`
- BACKLOG #24 (`open_repo`)
