# UX checks and reproduction

The panel is designed for quick tray access at 360–480px widths. Its shared title/status header stays compact, repository identities wrap instead of being discarded, and active runs appear before historical activity.

## Interaction coverage

Browser tests cover account and repository changes, search/filter combinations, typed launch forms, saved-template copying and editing, explicit quick-start opt-in, pending/double-click protection, and stale responses. Offline state preserves cached activity and allows template editing while preventing dispatch.

The initial **Repositories** tab sorts by latest activity and uses keyboard-accessible disclosures. Action rows and start buttons open configuration; heart favorites persist across reloads and remain account-bound. **Aktivität** defaults to all runs, with open work followed by the latest completed history. New interaction tests cover these flows at 360px and 480px.

Favorites also appear immediately below search in the repository view. Their compact rows reuse stored parameters and explicit quick-start settings; removing a favorite updates both views. At ordinary label lengths, repository headers are 48px high and Action rows 36px; long labels can wrap. Narrow-layout tests check these heights and keep controls reachable.

An uncertain dispatch remains quarantined across dialog reopening and app restart. Its visible warning has hover, focus and touch details; Escape and outside interaction dismiss the help without enabling another start. Saving a template during dispatch and pressing Enter in a template name cannot start another run.

Dialogs trap Tab and Shift+Tab and close with Escape; closing returns focus to the control that opened them, and a chained dialog returns focus to the opener of the first dialog (`tests/settings.spec.ts`). A start result receives focus when it appears. Narrow-layout checks preserve readable labels, reachable controls and bounded tooltips.

Native IPC mocks exercise token input clearing, errors, disconnect and both update modes. Standard unsigned builds run a notify-only check: the panel announces a newer stable release and opens only its release page, without downloading or installing anything. Separately configured signed builds download inside the app and install only after a second confirmation. The mocks perform no real authorization, download or installation.

## Optional screenshots

```sh
pnpm dev
# In another terminal:
pnpm exec playwright install chromium
node scripts/capture-review.mjs
node scripts/capture-card-review.mjs
node scripts/capture-navigation-review.mjs
```

Capture scripts assert demo mode and exercise only synthetic local fixtures. Output under `docs/review/` is ignored. Review captures before sharing; screenshots and browser profiles are not part of the source distribution. No existing private review material is included in the repository.

The navigation capture writes `docs/review/navigation/repositories.png`, `activity.png`, `favorites.png` and a capture manifest. It shows the running browser demo, including an Action saved through its heart button.

## Native acceptance

Browser checks cannot establish Windows tray placement, multi-monitor/DPI behavior, sleep/resume, OS notifications, credential-manager behavior or an installed application's lifecycle. Those need a native Windows acceptance session. Platform support beyond Windows requires equivalent testing.
