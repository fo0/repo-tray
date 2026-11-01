# UX checks and reproduction

Binding rules: [owner UX rules](../agent_docs/ux_rules.md). This page lists the panel's target behaviour as short facts, the automated coverage and the screenshot scripts.

## Panel

**Frame**

- 360–480 px wide. App bar: brand (icon only below 400 px), account menu, refresh, settings. Footer: connection status and data time.
- One overview, no tabs ([ADR-0002](adr/0002-single-overview-with-maximizable-sections.md)): **Läuft gerade**, **Favoriten**, **Repositories** — each a region named by its heading, with a count and a maximize toggle (**Strg+1/2/3** in its tooltip).
- Overview caps: 3 runs, 4 favorites, 10 repositories. **+N weitere** opens the maximized page; a search lifts the caps and filters every section.
- Maximized: the maximize button turns into minimize at the same spot ([ADR-0005](adr/0005-maximize-toggles-in-place.md)); **Esc** and the section's Ctrl key also return. Opening focuses the page title; returning focuses the opener, else the section's toggle. Disclosures stay open.
- Empty overview: only the next step — **GitHub-Konto verbinden** or **Konto wählen** (opens the account menu).

**Läuft gerade** — running, queued and waiting runs as single-line rows (status icon, workflow, repository, branch, elapsed time); **Gerade läuft nichts.** when idle. A click opens the run in the **Verlauf**. No live region: the demo refreshes every second.

**Favoriten** — compact single-line rows: repository name first, the favorite's workflow name small beside it, branch, start button, heart. Long names shorten, the full name in the tooltip. The name opens the stored configuration; the heart removes, and **Rückgängig** restores label, inputs and quick-start mode; favorites persist per account.

**Repositories** — automatic ([ADR-0003](adr/0003-automatic-repositories.md)): per account the 10 latest pushed plus the favorites' repositories, refreshed with each catalog refresh; no picker, no add or remove. Natively the active account's repositories are shown.

- One row each, sorted by latest activity: `owner/` dimmed, workflow count, status icon and text (**2 aktiv** while several runs are open), **Nur Lesen** or **Kein Zugriff** where starts are not allowed, a strip of the last 8 runs (newest right, empty cells when fewer, a running cell pulses unless reduced motion). The strip is an image with a summarizing accessible name.
- A disclosure lists the workflows: configure, start, heart.
- **⋯** (also right click or the context-menu key): **Letzten Run auf GitHub öffnen** (only with a valid run link), **Link kopieren** (repository page; disabled in the demo). Same keys as the account menu; stays inside the panel.

**Verlauf**

- Groups **Jetzt** and **Abgeschlossen** with counts; info button **Hinweis zum Verlauf** in the first head. Chips **Alle**, **Aktiv**, **Fehlgeschlagen**, **Abgeschlossen**.
- A row is one toggle: status tile (spinner unless reduced motion), workflow with run number, repository without owner (owner in the tooltip), branch chip, status text and time. One line at 360 px.
- Open runs count up (**seit 3 min**); completed runs read relative (**gerade eben**, **vor 3 Min.**, **vor 2 Std.**, **gestern**, then the date) with their duration; one shared minute clock; exact time in the tooltip.
- Expanded: account, update time, status, **Auf GitHub öffnen**, **Link kopieren** (both disabled in the demo).
- Every „show run“ path opens the Verlauf unfiltered with that run expanded and focused; a focused run that completes keeps focus as it moves to **Abgeschlossen**.

**Account menu** — switches the active account on click, **Enter** or **Space**; arrows, **Home**, **End** move; **Esc** closes and returns focus. Also **Konto verbinden …** and **Konten verwalten …**.

**Keyboard** — **F5** / **Ctrl+R** refresh (never a webview reload), **Ctrl+1/2/3** toggle **Repositories**, **Verlauf**, **Favoriten**, **/** focuses the search; refresh and section keys also work from the search field, whose **Tastenkürzel** hint lists them. **Esc** order: open menu or dialog, then the search (clear, then leave), then a maximized page. Dialogs trap Tab and own the keyboard; closing returns focus to the opener (a chained dialog to the first opener). A start result takes focus when it appears.

**Starts** — a disabled start button names its one reason in the tooltip and accessible description: **Kein manueller Start**, **Kein Schreibzugriff auf dieses Repository**, **Offline – Starts sind deaktiviert**, **Zugriff verweigert – Starts sind deaktiviert**, **Start läuft …**, **Startstatus ungeklärt – prüfe die Runs auf GitHub**. A running start locks only its own target. An uncertain start stays locked across reopen and restart; its help opens on hover, focus or touch and closes with Escape or an outside click without enabling a start. Only **Sperre aufheben…** with the confirmation **Ich habe die Runs auf GitHub geprüft – Sperre aufheben** releases exactly the lock shown, and releasing never starts anything. Saving a template during a dispatch, or Enter in a template name, never starts another run.

**Notices** — success notices close after 3 s; only warnings and errors stay until closed.

**Settings** — tabs Konten, App, Updates. Changes are staged: one primary **Speichern** bottom right plus **Abbrechen**; immediate actions such as connecting, **Trennen**, **Nach Updates suchen** and **Installieren** are explicit buttons. A completed flow closes or returns by itself.

**Updates** — **Nach Updates suchen** → **Update verfügbar** with at most 5 changelog bullets → **Installieren** → progress bar → the app installs and restarts itself ([ADR-0004](adr/0004-in-app-updates-for-unsigned-builds.md)). No release-page link.

**Styling**

- Body text 14 px, metadata at least 12 px.
- Colors only from the tokens in `src/styles/00-tokens.css`: a dark and a light set. **Einstellungen → App → Darstellung**: **System** (follows the OS live), **Hell**, **Dunkel**; stored per device in `localStorage`, applied before the panel mounts.
- WCAG AA (≥ 4.5:1) for text, metadata, accent and status colors on panel, card and hover surfaces in both themes; `src/lib/tokens.test.ts` checks the pairs and rejects color literals elsewhere.
- 2 px focus ring, drawn inset inside clipped containers. Forced colors redraw state with system colors (`src/styles/14-forced-colors.css`).

## Automated coverage

Playwright specs (`tests/<name>.spec.ts`) run against the browser demo and, where noted, a labelled native IPC mock (`tests/support/tauriMock.ts`). The mocks perform no real authorization, download or installation.

| Area                   | Specs                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| Layout at 360/480 px   | `panel`, `repositories`, `run-actions`, `uncertain-help`, `demo-connection`, `templates`               |
| Overview, maximize     | `overview`, `overview-caps`, `overview-visuals`                                                        |
| Repositories           | `repositories`, `repo-menu`, `repository-access`                                                       |
| Favorites              | `templates`, `favorite-undo`, `launch-names`                                                           |
| Verlauf                | `activity`, `run-actions`, `forced-colors`                                                             |
| Starts and locks       | `launch`, `start-result`, `start-locks`, `start-reasons`, `uncertain-help`, `uncertain-release`        |
| Keyboard and focus     | `shortcuts`, `settings`, `favorite-undo`, `account-menu`                                               |
| Notices and refresh    | `notices`, `panel-actions`, `refresh-recovery`                                                         |
| Accounts (native mock) | `account-menu`, `onboarding`, `account-selection`, `account-disconnect`, `native`, `token-permissions` |
| Sign-in                | `local-auth*`, `browser-auth`, `demo-connection`                                                       |
| Settings               | `settings`, `startup`, `theme`                                                                         |
| Updates (native mock)  | `update-install`, `native`                                                                             |

Unit tests (`src/lib/*.test.ts`) cover the model, run lists, formatting, account selection, the panel controller, the page state (`view`), starts and start reasons, favorites, notices, shortcut and menu keys, the demo, the run-link parser (`fixtures/run-links.json`) and repository link check, the IPC contract, the theme preference and the design tokens.

## Screenshots

```sh
pnpm dev
# In another terminal:
pnpm exec playwright install chromium
node scripts/capture-review.mjs
node scripts/capture-card-review.mjs
node scripts/capture-navigation-review.mjs
```

- Screenshots shown to the owner come from the exact commit being delivered; never present a mock-up as the result.
- The scripts assert demo mode, fail on any request leaving the dev server, use only synthetic fixtures and capture each view in dark and light (`-dark` / `-light`). `REVIEW_BASE_URL` targets another port; `NAVIGATION_REVIEW_DIR` and `NAVIGATION_REVIEW_PREFIX` redirect the navigation capture.
- Output: `docs/review/` (gitignored, never published) — `screenshots/` with `manifest.json`, `card-revision/` with layout metrics, `navigation/` (480×760, overview also 360×560). Review captures before sharing.

## Native acceptance

Browser checks cannot establish Windows tray placement, multi-monitor/DPI behavior, sleep/resume, OS notifications, credential-manager behavior or an installed application's lifecycle. Those need a native Windows session: [native Windows smoke checklist](VALIDATION.md#native-windows-smoke-checklist). Platform support beyond Windows requires equivalent testing.
