# Backlog

Review findings not immediately fixed. **Only work on these upon explicit request.**

## Open

| #   | Date       | Category                      | Sev | Location                                          | Finding                                                                                                              | Status   | Source                               |
| --- | ---------- | ----------------------------- | --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------ |
| 1   | 2026-11-01 | Code Smells                   | P2  | src/App.svelte                                    | 2,100 lines (house threshold ~300) — split into tab/feature components                                               | Deferred | Optimizer run: refactoring potential |
| 2   | 2026-11-01 | Code Smells                   | P2  | src/app.css                                       | 2,473 lines — split per component (Svelte scoped styles) or by area                                                  | Deferred | Optimizer run: refactoring potential |
| 3   | 2026-11-01 | Code Smells                   | P2  | src-tauri/src/{local_auth,github,browser_auth}.rs | ~1,000 lines each (Rust threshold ~500, strongly ~1,000) — split transport/parsing/tests                             | Deferred | Optimizer run: refactoring potential |
| 4   | 2026-11-01 | Code Smells                   | P2  | src-tauri/src/{live,auth}.rs                      | ~900 lines each — candidates after #3                                                                                | Deferred | Optimizer run: refactoring potential |
| 5   | 2026-11-01 | Code Smells                   | P2  | ci/checks.yml                                     | Inactive historical duplicate of .github/workflows/checks.yml — remove once the owner confirms nothing references it | Deferred | Optimizer run: repo inventory        |
| 6   | 2026-11-01 | Readability & Maintainability | P2  | tests/panel.spec.ts                               | 779 lines — split by tab/flow                                                                                        | Deferred | Optimizer run: refactoring potential |

## Done

| #   | Date | Done | Category | Location | Finding |
| --- | ---- | ---- | -------- | -------- | ------- |
