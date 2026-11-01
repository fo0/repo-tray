# ADR-0003: Automatic repositories

- **Status:** Accepted
- **Date:** 2026-11-01
- **Decider(s):** owner
- **Tags:** ui, repositories, catalog
- **Supersedes:** ADR-0002, part „Inline account and repository management“ — its repository half; the account menu stays in force

## Context

ADR-0002 made the tray's repositories a manual choice in the panel: the page „Repositories im Tray“ (opened by „+ Hinzufügen“, the empty state „Repositories auswählen“ and a fresh connection), „Nicht im Tray“ while searching, „Aus Tray entfernen“ in each row's „⋯“ menu, instant toggles with „Rückgängig“, a cap of 50 sent through the `select_repos` command. The owner asked three times to remove that manual step: the app can tell which repositories matter, so asking the user is configuration it can infer (`agent_docs/ux_rules.md`, rule 4).

## Decision

We will derive the tray's repositories automatically, per account: the 10 repositories with the latest push, plus every repository that has a favorite. The set is recomputed with each catalog refresh. The overview shows up to 10 repositories; the maximized Repositories page shows the whole set, and the search filters it. Removed: the `select_repos` command, the picker page „Repositories im Tray“, „+ Hinzufügen“, „Nicht im Tray“, „Aus Tray entfernen“, the 50-repository cap and the empty state „Repositories auswählen“. The account menu, account scoping (natively the active account in the foreground, the other accounts observed in the background) and the remaining „⋯“ actions are unchanged.

## Consequences

### Positive

- No setup step: a fresh connection shows its repositories at once.
- The set follows the user's work without maintenance.
- Polling is bounded by 10 repositories per account plus the favorites' repositories.

### Negative / Trade-offs

- A rarely pushed repository drops out of the tray unless it has a favorite; a favorite is the way to keep it.
- Activity means the latest push, not the latest workflow run, so a busy repository without dispatchable workflows still takes a slot.

### Neutral

- A manual selection stored by an earlier version no longer decides anything.

## Alternatives Considered

- **Keep the picker as an optional override** — rejected: the owner asked for no manual repository selection anywhere.
- **Rank by the latest workflow run** — not chosen: the owner named the latest push, which comes with the repository listing (`pushed_at`); run times need requests per repository before the set is known.

## References

- #18 (owner feedback), `agent_docs/ux_rules.md`
- [ADR-0002](0002-single-overview-with-maximizable-sections.md)
