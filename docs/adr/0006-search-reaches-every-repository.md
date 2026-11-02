# ADR-0006: Search reaches every repository

- **Status:** Accepted
- **Date:** 2026-11-02
- **Decider(s):** owner
- **Tags:** ui, repositories, search, catalog
- **Supersedes:** ADR-0003, part „the search filters it“ — the search now also lists repositories outside the automatic set

## Context

ADR-0003 limits the tray to the 10 most recently pushed repositories per account plus the repositories of favorites, and the search filters only that set. A repository outside it could not be found at all, so none of its workflows could be saved as a favorite — the one way ADR-0003 names to keep a rarely pushed repository (#23). The account's full repository listing is already in the snapshot; only workflows and runs are missing for the repositories outside the set.

## Decision

We will let a non-blank search also list the account's repositories outside the automatic set whose `owner/name` matches, after the matching ones of the set, newest push first. Such a card shows only its last push. Expanding it calls the native command `open_repository`, which keeps the repository in a session-only list of at most 5 opened repositories, selects it and loads its workflows and runs at once; from then on it is a normal card (start, favorite, run strip) until the app restarts or it drops out of the 5. A favorite keeps it for good, as before. Still no picker, no add and no remove (rule 4 stands): the search finds, expanding loads.

## Consequences

### Positive

- Every repository the account can reach is one search away; a favorite in it keeps it in the tray.
- No new setting and no stored selection.

### Negative / Trade-offs

- Polling grows by up to 5 opened repositories per session.
- An opened repository disappears after a restart unless it got a favorite.

### Neutral

- The browser demo applies the same rule in `src/lib/demo.ts` (`openRepository`): `demo-extra` and `demo-work-legacy` are outside `demo-work`'s 10.

## Alternatives Considered

- **Search GitHub (`/search/repositories`) instead of the listing** — not chosen: the listing is already local and limited to repositories the account can reach; a remote search adds latency and rate-limit cost per keystroke.
- **Keep opened repositories across restarts** — not chosen: that is a stored manual selection, which ADR-0003 removed.

## References

- #23, `agent_docs/ux_rules.md` (rules 4 and 11), [ADR-0003](0003-automatic-repositories.md)
- `src/lib/runs.ts` (`repositoryActivity`), `src/lib/RepositoryList.svelte`, `src/lib/actions.svelte.ts`, `src-tauri/src/live/` (`open_repository`)
