# UX checks and reproduction

The panel is designed for quick tray access at 360–480px widths. Its shared title/status header stays compact, repository identities wrap instead of being discarded, and active runs appear before historical activity.

## Panel behavior

The initial **Repositories** tab sorts by latest activity and uses keyboard-accessible disclosures that stay open across view switches. Action rows and start buttons open configuration; heart favorites persist across reloads and remain account-bound. Favorites also appear immediately below search; removing one updates both views and offers **Rückgängig** for a few seconds, which restores label, inputs and quick-start mode. **Aktivität** defaults to all runs, with open work followed by the latest completed history. Run times read relative (**gerade eben**, **vor 3 Min.**, **vor 2 Std.**, **gestern**, then the date) from one shared minute clock, with the exact time in the tooltip; each row offers opening the run on GitHub and **Link kopieren** without expanding.

Keyboard shortcuts: **F5** or **Ctrl+R** refresh the panel (a webview reload is always suppressed), **Ctrl+1/2/3** switch between **Repositories**, **Aktivität** and **Favoriten**, **/** focuses the search and **Esc** clears the search, then leaves it. Refresh and view shortcuts also work from the search field; while a dialog is open, the dialog owns the keyboard. The search field's **Tastenkürzel** hint lists them.

A disabled start button names its one reason as tooltip and accessible description, the most basic cause first: **Kein manueller Start**, **Kein Schreibzugriff auf dieses Repository**, **Offline – Starts sind deaktiviert**, **Zugriff verweigert – Starts sind deaktiviert**, **Start läuft …** or **Startstatus ungeklärt – prüfe die Runs auf GitHub**. A running start locks only its own target in every list.

An uncertain dispatch stays locked across dialog reopening and app restart. Its warning has hover, focus and touch details; Escape and outside interaction dismiss the help without enabling another start. Only **Sperre aufheben…** releases the lock, after the confirmation **Ich habe die Runs auf GitHub geprüft – Sperre aufheben**; it releases exactly the lock shown when the confirmation opened and never starts anything. Saving a template during dispatch and pressing Enter in a template name cannot start another run.

Success notices close on their own after a few seconds, but not while hovered or focused; a notice that arrives behind a dialog waits until the dialog closes. Warnings and errors stay until closed. Dialogs trap Tab and Shift+Tab and close with Escape; closing returns focus to the control that opened them, and a chained dialog returns focus to the opener of the first dialog. A start result receives focus when it appears.

Muted metadata text meets WCAG AA (at least 4.5:1, documented per token in `src/styles/00-base.css`), buttons, links and fields show a 2px focus ring that rows inside clipped containers draw inset, and Windows High Contrast (forced colors) redraws switches, the current view, tab and filter, filled favorite hearts and tinted focus rings with system colors (`src/styles/14-forced-colors.css`).

## Automated coverage

Playwright specs (`tests/<name>.spec.ts`) run against the browser demo and, where noted, a labelled native IPC mock (`tests/support/tauriMock.ts`). The mocks perform no real authorization, download or installation.

| Area                    | Specs                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout at 360/480px     | `panel`, `repositories`, `run-actions`, `uncertain-help`, `demo-connection`, `templates` (readable labels, reachable controls, row heights) |
| Repositories, favorites | `repositories`, `templates`, `favorite-undo`, `launch-names`                                                                                |
| Activity                | `activity` (relative times, shared minute clock, history note), `run-actions` (open and copy links, refused clipboard, demo hints)          |
| Starts and locks        | `launch`, `start-result`, `start-locks`, `start-reasons`, `uncertain-help`, `uncertain-release`                                             |
| Keyboard and focus      | `shortcuts`, `settings` (tab keyboard navigation, focus trap and return), `favorite-undo` (focus after removal)                             |
| Notices and refresh     | `notices`, `panel-actions`, `refresh-recovery`                                                                                              |
| Accounts (native mock)  | `onboarding`, `account-selection`, `account-disconnect`, `native`, `token-permissions`, `repository-access`                                 |
| Sign-in                 | `local-auth`, `local-auth-guidance`, `browser-auth`, `demo-connection`                                                                      |
| Settings                | `settings`, `settings-unsaved` (**Änderungen verwerfen?**), `startup` (Windows autostart switch)                                            |
| Updates (native mock)   | `update-notify` (notify mode, **Release-Seite öffnen**), `native` (signed-mode download, retry, separate install confirmation)              |
| Forced colors           | `forced-colors` (emulated forced colors for the unsaved tab marker only; the full High Contrast theme is a native check)                    |

Unit tests (`src/lib/*.test.ts`) cover the model, run lists, formatting, account selection, the panel controller, starts and start reasons, favorites, notices, shortcut mapping, the demo, the run-link parser against `fixtures/run-links.json` and the IPC contract. Standard unsigned builds run a notify-only update check: the panel announces a newer stable release and opens only its release page, without downloading or installing anything. Separately configured signed builds download inside the app and install only after a second confirmation.

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

Browser checks cannot establish Windows tray placement, multi-monitor/DPI behavior, sleep/resume, OS notifications, credential-manager behavior or an installed application's lifecycle. Those need a native Windows acceptance session; see the [native Windows smoke checklist](VALIDATION.md#native-windows-smoke-checklist). Platform support beyond Windows requires equivalent testing.
