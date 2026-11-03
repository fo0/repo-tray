# ADR-0008: Hidden repositories

- **Status:** Accepted
- **Date:** 2026-11-03
- **Decider(s):** owner
- **Tags:** ui, repositories, catalog, settings
- **Supersedes:** ADR-0003, part „nothing to add or remove“, and ADR-0006, part „no remove“ — the user may now remove a repository from the automatic set; adding stays automatic

## Context

ADR-0003 derives the repositories from the 10 newest pushes per account plus the repositories of favorites, with no way to add or remove one. Some repositories push every minute (bots, mirrors, generated content) and always sit at the top, taking a place and filling the run lists with activity the user does not follow (#30). The owner asked for a way to hide („ausblenden“) such a repository from the dashboard and to bring it back („einblenden“) from the settings.

## Decision

We will let the user hide a repository from its row's „⋯“ menu („Ausblenden“, at once, with an 8 s „Rückgängig“). A hidden repository is stored natively in the app settings row (`AppSettings.hiddenRepos`: account ID, repository ID, owner and name, so Settings can name it after it left the catalog) and reaches the panel as `Snapshot.hiddenRepos`. The automatic rule skips it for the 10 newest places, so the next repository moves up, and does not select it — unless a favorite of that account needs it: then it stays selected and polled, its favorite keeps working, but the panel still keeps it out of the lists. The new command `set_repo_hidden { accountId, repoId, hidden }` saves the change and re-applies the selection to the cached catalog at once; the next refresh loads what moved up. Hidden repositories and their runs leave the Repositories section and page, „Läuft gerade“, the Verlauf and their counts; favorites stay visible and startable. The search still finds a hidden repository (ADR-0006), whose menu then offers „Einblenden“. Settings → App lists every hidden repository under „Ausgeblendete Repositories“ with an „Einblenden“ toggle, staged until „Speichern“ (`agent_docs/ux_rules.md`, rule 5). Disconnecting an account removes its hidden entries. Adding stays automatic: there is still no picker.

## Consequences

### Positive

- A noisy repository no longer takes a place or floods the run lists, without any picker.
- One explicit action per repository; „Rückgängig“ and the settings undo it.

### Negative / Trade-offs

- A hidden repository with a favorite is still polled, so hiding does not always reduce requests.
- The native tray icon and completion notifications still count the runs of a selected hidden repository (one kept by a favorite).

### Neutral

- The browser demo keeps its list in `localStorage` (`repowatch.demo.hidden.v1`); „Demo zurücksetzen“ clears it.
- No SQLite migration: the settings row is JSON, and a row without the field hides nothing.

## Alternatives Considered

- **A per-repository mute that keeps it in the list** — rejected: the owner wants it gone from the dashboard.
- **A picker of shown repositories** — rejected: ADR-0003 and rule 4 stand for adding; only removal is a user choice.
- **Hide by owner/name** — rejected: account and repository IDs survive a rename and keep two connections of the same user apart.

## References

- #30 (owner request), `agent_docs/ux_rules.md`
- [ADR-0003](0003-automatic-repositories.md), [ADR-0006](0006-search-reaches-every-repository.md)
- `src-tauri/src/auto_repos.rs`, `src-tauri/src/live/hidden.rs`, `src-tauri/src/cache.rs` (`AppSettings`), `src/lib/hiddenRepos.ts`, `src/lib/actions.svelte.ts`, `src/lib/RepoMenu.svelte`, `src/lib/HiddenReposSetting.svelte`
- `src-tauri/src/live/tests/hidden.rs`, `src/lib/hiddenRepos.test.ts`, `tests/hidden-repos.spec.ts`
