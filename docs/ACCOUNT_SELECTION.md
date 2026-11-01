# Active account and sign-in options

The native app lets the user keep several connected credential entries and consciously select **one active account**. Select the account under **Einstellungen → Konten → Aktives Konto**, where connected entries show login and source. The main view contains only a compact read-only account status, for example `octocat · Browser`, `octocat · Token` or `octocat · gh CLI (Kopie)`. Two entries with the same GitHub login stay distinguishable and keep separate vault entries. Settings and the connection dialog also show each saved login/source as a card with “Token hinterlegt” or “gh-Anmeldung übernommen” and “Aktiv für RepoTray” versus “Verbunden, nicht aktiv”. “Verwenden” activates a saved connection without reimporting credentials. Empty token fields never imply that existing tokens are missing. The selector in settings has a clear unselected state; it does not call an aggregated account view an active identity. The browser-only demo retains its labelled All Accounts overview.

## Meaning of active

- The chosen account controls the foreground repository/activity view, and the repositories offered for new manual starts.
- Other accounts stay connected. The native background service continues observing their selected repositories and existing notification behavior is preserved. Selecting a foreground account is not revoking other authorizations or pausing their monitoring.
- Repositories, workflow runs and saved pins retain their own `accountId`. A pin never switches to the active account's token. A different account's pins become visible when that account is selected; they are not reassigned.
- Failed/expired/forbidden credentials produce an error. RepoTray does not try the same login through another source or silently retry through a different account.
- No primary/secondary ranking or method cascade exists. Browser, PAT and imported gh credentials are user-selected ways to connect, not fallback tiers. GCM discovery still provides metadata only where API import is unsupported. The gh CLI's active-account marker is informative and is not the RepoTray active account.

## First connection

Without any connected account, **GitHub-Konto verbinden** in the panel's empty state opens the connection dialog directly (the labelled demo panel in the browser preview). **Einstellungen → Konten** then shows a single empty state, **Noch kein Konto verbunden**, with the same one action. With an account connected, **Konto hinzufügen** opens the dialog. After a successful connection whose account has no selected repositories yet, which is always true for a first connection, settings open on the **Repositories** tab and name the next step; nothing is selected silently.

## Persistence and removal

Changes to the active-account selector apply immediately, independently of the repository-selection save button. A successful explicit connection selects that credential entry. Subsequent account selections are remembered under `repotray.activeAccount.v1`; the preference contains only its nonsecret stable account ID. Native credentials stay in the OS vault and repository selections/pins stay in the existing native metadata cache.

On restart, RepoTray restores only an exact still-connected ID. A first run without a selection, a missing saved entry, or removal of the active account leaves **Aktives Konto auswählen** and asks for a new conscious choice. It never picks the first remaining account. The main view provides a direct action: the connection dialog while no account exists, otherwise the accounts settings when a choice is needed. Removing a different account preserves the active selection. If UI preference storage is unavailable, the selection remains usable for the current session and the app explains that it could not remember it.

## Disconnecting an account

**Trennen** sits in each card under **Bereits in RepoTray verbunden** and asks inside that card first (**… trennen?**, **Trennen** / **Abbrechen**). Confirming deletes the stored RepoTray credential copy and that connection's cached activity, repository selection, favorites and uncertain-start locks. If the account still has uncertain starts, the confirmation warns that they are no longer locked afterwards and asks to check the runs on GitHub first. For an imported gh account it states that the gh CLI sign-in itself stays untouched. Focus moves to the account picker, or to **GitHub-Konto verbinden** after the last account; a failed disconnect keeps the card.

## Unsaved repository selection

Repository-selection changes apply only with **Auswahl speichern**. Leaving settings with unsaved changes (**Schließen**, Escape or **Konto hinzufügen**) asks **Änderungen verwerfen?** with **Verwerfen** and **Weiter bearbeiten**; the **Repositories** tab marks the unsaved state while you switch tabs.

Public app update checks do not require an active account or token. Changing or removing a workflow account does not invalidate an available or downloaded app update. Settings separates Konten, Repositories and Updates into independently reachable tabs.

## Local sign-in option

**Bestehende Anmeldung auf diesem PC verwenden** is an actual keyboard-accessible button with a computer icon, an explicit sign-in-option subtitle and an expanded/collapsed state. Opening it only reveals the explanation and **Lokale Anmeldungen prüfen** button. Discovery still requires that separate click; importing a selected gh credential still requires its existing explicit consent. Closing a running local check cancels it. Browser/PAT work keeps this component mounted, preserving the PAT cancellation regression fix.

Account selection involves no GitHub App, consent, grant, secret, hosting, release, credential export or GitHub account switch. The publisher-dependent browser setup remains described in [browser authentication](BROWSER_AUTH.md).
