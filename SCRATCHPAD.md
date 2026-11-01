# Scratchpad — Short-Term

Temporary working context. **Clean up aggressively — delete when resolved.**

## Current Work

**Orca objective** — Best-practice audit across backend, frontend, logic, UX/comfort, texts, system functions (updater, autostart, tray, release/CI) and quality; fix confirmed findings, one PR, CI once at the end, merge without release (2026-11-01, #8)

- Out of scope: releases (`[release]`), new runtime dependencies, re-enabling browser sign-in, signing.
- CI guard: branch pushes do not trigger Checks (push only on `main`); open the PR only at the end.
- Local e2e: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`, `E2E_PORT` per checkout.
- Wave plan and deferrals: `/tmp/orca/plan.md` (session-local; deferred items go to BACKLOG.md at the end).

## Open Questions

_(none)_
