# GitHub browser sign-in

> **Temporarily paused:** New browser / GitHub App sign-ins are disabled in the UI and native start/open/poll commands, regardless of publisher configuration. Use a personal token or explicitly import a local gh account. Existing stored browser credentials retain their normal lifecycle. The implementation and Rust tests below are retained for later re-enabling; they do not mean new sign-in is currently available.

RepoTray implements the GitHub App **device flow** in native Rust. It uses the system browser, a short code on `https://github.com/login/device`, automatic polling and the OS credential vault. There is no server, callback listener, embedded browser, client secret or private key. The browser preview remains its existing labelled demo. Native UI tests use an IPC fixture and never open GitHub.

**Code implementation and fixture checks are available. Real sign-in remains configuration-dependent.** No publisher GitHub App has been registered or configured, no account has authorized/installed it, and no real end-to-end login or workflow dispatch was performed. Without publisher configuration, the native button explains that setup is missing and stays disabled. PAT and existing local gh CLI/GCM UI remain available.

## Publisher configuration (documentation only)

The project owner would need to create and maintain the following GitHub App separately. The repository performs no registration, consent, grants, secret generation, hosting or release configuration.

| Setting                                | Intended value                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| Owner                                  | `fo0` (owner of `fo0/repo-tray`; any different publisher is an explicit owner decision) |
| App name                               | `RepoTray Desktop` (proposed; global name availability has not been checked)            |
| Homepage                               | `https://github.com/fo0/repo-tray` (use owner profile if the repository is private)     |
| Device flow                            | Enable Device Flow                                                                      |
| Expire user authorization tokens       | Enabled; code additionally requests `offline_access`                                    |
| Repository permissions                 | Metadata: read; Actions: read & write; Contents: read                                   |
| Organization/account permissions       | None                                                                                    |
| Webhooks                               | Inactive; no webhook URL or secret                                                      |
| User authorization during installation | Off; authorization is performed separately through device flow                          |
| Callback / Setup URL                   | Unset; device flow does not use a redirect callback                                     |
| Installation availability              | Any account if distributing RepoTray beyond the owner's account                         |
| Client secret / private key            | Neither is needed by RepoTray; never embed one                                          |

After the owner independently registers the intended publisher app, build the native app with its actual **public Client ID** and actual app slug:

```sh
REPOTRAY_GITHUB_CLIENT_ID='<publisher GitHub App Client ID>' \
REPOTRAY_GITHUB_APP_SLUG='<publisher-app-slug>' \
pnpm desktop:build
```

These are compile-time Rust environment variables, not `VITE_` variables. Client ID differs from the numeric App ID. Both values must belong to the same intended publisher app; the code validates syntax and HTTPS paths but cannot verify publisher ownership without real setup. No borrowed app Client ID or working credential is included. The release pipeline is unchanged; the owner must supply correct public configuration for a future coordinated build.

## What the user does

1. Click **Mit GitHub anmelden**. RepoTray obtains a device code in Rust, shows the short confirmation code and opens the exact GitHub device page in the system browser.
2. Check the account shown by GitHub, enter the code and authorize the publisher app. RepoTray recognizes the result automatically, verifies `/user`, and stores its own browser credential.
3. Separately install the app on the personal or organization account and select individual or all repositories. The connection dialog and the panel's **Repositories im Tray** page contain a button to the configured app's installation page. Organization administrator approval and an active SAML SSO session may be required.
4. Click **Repository-Liste aktualisieren** in **Repositories im Tray** after changing installation access. This bypasses the ordinary catalog refresh interval, follows paginated installations and their paginated repositories, and preserves still-accessible selections.

An authorization can succeed with no installed repositories. That is an authenticated account, not permission to access every repository. RepoTray explains the separate installation requirement. It checks installation Actions rights separately from the user's `permissions.push`; push alone never grants browser-account Actions write. Contents read is also required before browser-account dispatch is offered. GitHub's actual API response remains authoritative. Workflows needing environment lists can remain unavailable when their additional API access is absent; RepoTray requests no broader permissions.

## Ownership and failure handling

Browser accounts use `github-device-<numeric-user-id>` in the existing RepoTray vault namespace. PAT accounts and imported gh accounts keep their distinct keys. Disconnect deletes only RepoTray's own selected account entry/cache. It does not revoke GitHub authorization, uninstall the App, delete gh/GCM credentials or switch gh accounts.

Only the public code, canonical verification URL, expiry, next poll time, generation and safe status cross IPC. Device, access and refresh tokens never enter frontend state, snapshots, SQLite, logs, browser URLs or repository files. OAuth POSTs are restricted to the two fixed `github.com/login/...` endpoints; ordinary REST requests remain restricted to `api.github.com`. Redirects are disabled and bodies are bounded. There is no arbitrary-URL opener.

The existing native state machine prevents overlapping polls, enforces the server interval, adds five seconds on `slow_down`, backs off after transport failures, and clears the device secret on cancel, denial, expiry or completion. UI generations and the native shared auth generation discard late start/poll results after cancellation, another browser attempt, PAT sign-in or local-account work. An expired response cannot commit tokens. Identity is verified before initial credential storage.

Access and refresh tokens, expiry and a rotation marker are stored as **one vault value**. Refresh, sign-in credential commits and disconnects share one native transaction lock. A sign-in cancelled during a blocking vault write restores the previous entry (or removes the new entry) before it can commit account metadata. A refresh cannot resurrect a disconnected credential or overwrite a newer sign-in. Before sending the single-use refresh request, RepoTray persists a pending marker. It verifies the new token's numeric user identity and stores the replacement pair together before using it. A lost response, process crash, identity mismatch or vault-write failure leaves reauthentication required; it does not automatically retry an already consumed refresh token. This deliberately prefers a fresh login over uncertain token reuse. Expired/revoked authorization stays a visible error; no foreign credential is removed.

## Validation and remaining acceptance work

Fixture tests cover pending, slowdown, denial, expiry, network errors, cancellation, stale start/poll responses, token shapes, untrusted verification URLs, distinct ownership, effective permissions, refresh identity mismatch and ambiguous refresh recovery. Existing PAT cancellation and gh/GCM tests remain unchanged. `tests/browser-auth.spec.ts` checks the paused state against an IPC mock, both with and without publisher configuration: **Mit GitHub anmelden** stays disabled with its pause notice, the token and local-account alternatives stay usable, no browser-auth, token-connect or local-discovery IPC command is called and no extra window opens.

Fixture tests cannot establish Windows Credential Manager/WebView2 behavior or system-browser focus. CI checks native Windows compilation; Windows runtime acceptance and a real publisher-configured end-to-end login require a separate native session.

## Official protocol sources

Verified 2026-10-31:

- [GitHub App user-token/device flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [User-token refresh](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens) (device-origin refresh does not require a client secret)
- [App installation/user repository endpoints](https://docs.github.com/en/rest/apps/installations)
- [Publisher registration settings](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
