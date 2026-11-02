# ADR-0007: Back arrow and home brand

- **Status:** Accepted
- **Date:** 2026-11-02
- **Decider(s):** owner
- **Tags:** ui, navigation
- **Supersedes:** ADR-0005, part „minimize button („<Titel> verkleinern“, tooltip „Verkleinern · Esc“)“

## Context

ADR-0005 turned a maximized section's maximize button into a minimize button at the same spot. The owner found the inverse maximize symbol unclear as a way back and asked for a back arrow; the brand at the top left should also lead to the overview, as users expect (#23).

## Decision

We will keep the toggle in place (rule 8), but a maximized section shows a back arrow there: accessible name **Zurück zur Übersicht**, tooltip **Zurück · Esc**. The brand (icon and **RepoWatch**) at the top left is a button with the tooltip **Zur Übersicht**: from a maximized page it returns like the back arrow, and on the overview it clears the search and scrolls to the top. The heading keeps its name **RepoWatch**. Esc and Ctrl+1/2/3 are unchanged.

## Consequences

### Positive

- The way back reads as „back“, still where the pointer already is.
- Home is one click from anywhere outside a dialog.

### Negative / Trade-offs

- Natively a press on the brand no longer drags the window; the bar's free space still does.

### Neutral

- Tests find the back arrow by its name inside the page header (`tests/support/demo.ts`, `backButton`).

## Alternatives Considered

- **Back arrow left of the title** — not chosen: rule 8 and ADR-0005 keep the way back where the maximize button was.

## References

- #23, `agent_docs/ux_rules.md` (rule 8), [ADR-0005](0005-maximize-toggles-in-place.md)
- `src/lib/SectionHeader.svelte`, `src/lib/AppBar.svelte`, `src/App.svelte`, `tests/overview.spec.ts`
