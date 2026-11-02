# ADR-0005: Maximize toggles in place

- **Status:** Accepted
- **Date:** 2026-11-01
- **Decider(s):** owner
- **Tags:** ui, navigation
- **Supersedes:** ADR-0002, the maximized page's header with „Zurück zur Übersicht“

## Context

ADR-0002 put a maximized section under a header with **Zurück zur Übersicht**. The owner found no visible way back on a maximized section (#18). Rule 8 of `agent_docs/ux_rules.md`: toggles stay in place.

## Decision

We will keep the section header where it is when a section is maximized: the maximized page shows the section's own header (`SectionHeader` with `onMinimize`, the only thing `SectionPage` renders), whose minimize button („<Titel> verkleinern“, tooltip „Verkleinern · Esc“) sits exactly where the maximize button is; minimizing returns to the overview. The separate **Zurück zur Übersicht** header goes; there is no back button at all. **Esc** and the section's **Ctrl+1/2/3** key still return; everything else in ADR-0002 (one overview, caps lifted by search, focus rules, Verlauf with the run expanded) stays.

## Consequences

### Positive

- The way back is where the user's pointer already is.
- One control per section for both directions; no extra header text.

### Negative / Trade-offs

- The toggle's accessible name and icon must change with the state, so tests assert both states.

### Neutral

- The keyboard paths are unchanged.

## Alternatives Considered

- **Keep „Zurück zur Übersicht“** — rejected by the owner (#18).

## References

- #18, `agent_docs/ux_rules.md`, [ADR-0002](0002-single-overview-with-maximizable-sections.md)
- `src/lib/SectionHeader.svelte`, `src/lib/SectionPage.svelte`, `tests/overview.spec.ts`, `tests/support/demo.ts` (`minimizeButton`)
