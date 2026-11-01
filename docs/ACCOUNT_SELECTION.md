# Active account and sign-in options

The native app lets the user keep several connected credential entries and consciously select **one active account**. Select the account in the **account menu** at the top of the panel or under **Einstellungen → Konten → Aktives Konto**; both list the connected entries with login and source, for example `octocat · Browser`, `octocat · Token` or `octocat · gh CLI (Kopie)`. Two entries with the same GitHub login stay distinguishable and keep separate vault entries. Settings and the connection dialog also show each saved login/source with “Token hinterlegt” or “gh-Anmeldung übernommen” and “Aktiv für RepoTray” versus “Verbunden, nicht aktiv”. “Verwenden” activates a saved connection without reimporting credentials. Empty token fields never imply that existing tokens are missing. The selector in settings has a clear unselected state; it does not call an aggregated account view an active identity. The browser-only demo retains its labelled All Accounts overview.

## Account menu

The menu button in the app bar shows the active entry (avatar, login and source) with a dot for the connection state, and stays inside the status named **Aktives Konto**. Opening it lists the connected entries as a single choice, then **Konto verbinden …** (the connection dialog) and **Konten verwalten …** (**Einstellungen → Konten**).

- Only an explicit activation switches: a click, or **Enter**/**Space** on an entry. Opening the menu and moving through it with the arrow keys, **Home** or **End** changes nothing; **Esc** closes it and returns focus to the button. It is a menu, not a `<select>`, because arrow keys on a closed Windows select would switch accounts by accident.
- Natively the menu never offers an aggregate: there is no **Alle Konten** entry. Without a deliberate choice the button reads **Kein aktives Konto** and no entry is checked. Only the browser demo lists **Alle Konten**.
- The menu uses the same switch as the settings selector, so the rules below (persistence, restore, removal) apply to both. It is disabled while the first snapshot loads and while a settings change runs.

## Meaning of active

- The chosen account controls the foreground repository/activity view, and the repositories offered for new manual starts.
- Other accounts stay connected. The native background service continues observing their automatic repositories and existing notification behavior is preserved. Selecting a foreground account is not revoking other authorizations or pausing their monitoring.
- Repositories, workflow runs and saved pins retain their own `accountId`. A pin never switches to the active account's token. A different account's pins become visible when that account is selected; they are not reassigned.
- Failed/expired/forbidden credentials produce an error. RepoTray does not try the same login through another source or silently retry through a different account.
- No primary/secondary ranking or method cascade exists. Browser, PAT and imported gh credentials are user-selected ways to connect, not fallback tiers. GCM discovery still provides metadata only where API import is unsupported. The gh CLI's active-account marker is informative and is not the RepoTray active account.

## First connection

Without any connected account, **GitHub-Konto verbinden** in the panel's empty state opens the connection dialog directly (the labelled demo panel in the browser preview). **Einstellungen → Konten** then shows a single empty state, **Noch kein Konto verbunden**, with the same one action. With an account connected, **Konto hinzufügen** (or **Konto verbinden …** in the account menu) opens the dialog. A successful connection closes the dialog by itself; its repositories appear automatically ([ADR-0003](adr/0003-automatic-repositories.md)), with no selection step.

## Persistence and removal

The account menu switches at once on an explicit activation; in **Einstellungen → Konten** the choice is staged and applies with **Speichern** (**Abbrechen** discards it). A successful explicit connection selects that credential entry. Subsequent account selections are remembered under `repotray.activeAccount.v1`; the preference contains only its nonsecret stable account ID. Native credentials stay in the OS vault and pins stay in the existing native metadata cache.

On restart, RepoTray restores only an exact still-connected ID. A first run without a selection, a missing saved entry, or removal of the active account leaves **Aktives Konto auswählen** and asks for a new conscious choice. It never picks the first remaining account. The main view provides a direct action: the connection dialog while no account exists, otherwise **Konto wählen**, which opens the account menu with no entry checked. Removing a different account preserves the active selection. If UI preference storage is unavailable, the selection remains usable for the current session and the app explains that it could not remember it.

## Disconnecting an account

**Trennen** sits in each entry under **Bereits in RepoTray verbunden** and asks inline first (**… trennen?**, **Trennen** / **Abbrechen**). Confirming deletes the stored RepoTray credential copy and that connection's cached activity, repositories, favorites and uncertain-start locks. If the account still has uncertain starts, the confirmation warns that they are no longer locked afterwards and asks to check the runs on GitHub first. For an imported gh account it states that the gh CLI sign-in itself stays untouched. Focus moves to the account picker, or to **GitHub-Konto verbinden** after the last account; a failed disconnect keeps the entry.

## Repositories in the tray

Repositories are automatic, never chosen ([ADR-0003](adr/0003-automatic-repositories.md)): per account the 10 with the latest push plus every repository with a favorite, refreshed with each catalog refresh. The overview and the Repositories page show only the shown account's scope: natively the active account, in the demo the chosen account or all of them. The other accounts' repositories stay observed, as described under _Meaning of active_. An account switch drops pending **Rückgängig** offers of removed favorites.

Public app update checks do not require an active account or token. Changing or removing a workflow account does not invalidate an available or downloaded app update. Settings separates Konten, App and Updates into independently reachable tabs.

## Local sign-in option

**Bestehende Anmeldung auf diesem PC verwenden** is a keyboard-accessible disclosure button. Opening it only reveals **Lokale Anmeldungen prüfen**; discovery needs that separate click. Results appear as a compact list with one consent line and **Übernehmen** as the primary action; nothing is imported without that consent ([local sign-in](LOCAL_AUTH.md)). Closing a running local check cancels it. Browser/PAT work keeps this component mounted, preserving the PAT cancellation regression fix.

Account selection involves no GitHub App, consent, grant, secret, hosting, release, credential export or GitHub account switch. The publisher-dependent browser setup remains described in [browser authentication](BROWSER_AUTH.md).
