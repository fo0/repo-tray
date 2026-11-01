# Roadmap

## Connection and platform acceptance

- [ ] Configure the publisher GitHub App for the implemented native browser/device-flow sign-in.
- [ ] Exercise real permissions, expired/revoked access and organization SSO with owner-controlled accounts.
- [ ] Smoke-test the Windows installer, credential manager and tray lifecycle on Windows 11.
- [ ] Test DPI, multiple monitors, sleep/resume, close-to-tray and notification opt-in.
- [ ] Validate macOS/Linux native behavior before claiming platform support.

Native browser device-flow code, explicit gh credential import with metadata-only GCM discovery, Settings-based account selection, tray positioning, token access, transport backoff/pagination, workflow/ref/input validation, cached snapshots, persistent uncertain-start protection and in-app updates for unsigned builds ([ADR-0004](adr/0004-in-app-updates-for-unsigned-builds.md)) are implemented. Automated fixtures and compilation do not replace native runtime acceptance.

## Optional product features

- [x] Optional Windows login startup with direct tray launch; interactive acceptance remains in [Windows startup](WINDOWS_AUTOSTART.md).
- [ ] Global shortcut preferences.
- [ ] Cancel/re-run actions with explicit target context and operation deduplication.
- [ ] Rich log viewing in addition to GitHub links.
- [ ] Optional publisher-signed updates (Tauri updater feed) if the project chooses to sign releases.
