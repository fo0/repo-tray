# Roadmap

## Connection and platform acceptance

- [ ] Configure the publisher GitHub App for the implemented native browser/device-flow sign-in.
- [ ] Exercise real permissions, expired/revoked access and organization SSO with owner-controlled accounts.
- [ ] Smoke-test the Windows installer, credential manager and tray lifecycle on Windows 11.
- [ ] Test DPI, multiple monitors, sleep/resume, close-to-tray and notification opt-in.
- [ ] Validate macOS/Linux native behavior before claiming platform support.

Native browser device-flow code, explicit local gh/GCM credential import, Settings-based account selection, tray positioning, token access, transport backoff/pagination, workflow/ref/input validation, cached snapshots, persistent uncertain-start protection and manual release downloads are implemented. Automated fixtures and compilation do not replace native runtime acceptance.

## Optional product features

- [ ] Visible autostart and global shortcut preferences.
- [ ] Cancel/re-run actions with explicit target context and operation deduplication.
- [ ] Rich log viewing in addition to GitHub links.
- [ ] Optional signed automatic updates if the project chooses to support them.
