# UX checks and reproduction

The panel is designed for quick tray access at 360–480px widths. Its shared title/status header stays compact, repository identities wrap instead of being discarded, and active runs appear before historical activity.

## Interaction coverage

Browser tests cover account and repository changes, search/filter combinations, typed launch forms, saved-template copying and editing, explicit quick-start opt-in, pending/double-click protection, and stale responses. Offline state preserves cached activity and allows template editing while preventing dispatch.

An uncertain dispatch remains quarantined across dialog reopening and app restart. Its visible warning has hover, focus and touch details; Escape and outside interaction dismiss the help without enabling another start. Saving a template during dispatch and pressing Enter in a template name cannot start another run.

Keyboard focus is trapped in dialogs, sign-in state changes receive focus, and return restores the account selector. Narrow-layout checks preserve readable labels, reachable controls and bounded tooltips. Native IPC mocks exercise token input clearing, errors, disconnect, release notes and explicit manual EXE download; they do not perform real authorization or installation.

## Optional screenshots

```sh
pnpm dev
# In another terminal:
pnpm exec playwright install chromium
node scripts/capture-review.mjs
node scripts/capture-card-review.mjs
```

Capture scripts assert demo mode and exercise only synthetic local fixtures. Output under `docs/review/` is ignored. Review captures before sharing; screenshots and browser profiles are not part of the source distribution. No existing private review material is included in the repository.

## Native acceptance

Browser checks cannot establish Windows tray placement, multi-monitor/DPI behavior, sleep/resume, OS notifications, credential-manager behavior or an installed application's lifecycle. Those need a native Windows acceptance session. Platform support beyond Windows requires equivalent testing.
