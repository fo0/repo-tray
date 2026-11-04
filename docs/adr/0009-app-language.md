# ADR-0009: App language follows the system, with a German and an English catalog

- **Status:** Accepted
- **Date:** 2026-11-04
- **Decider(s):** owner
- **Tags:** ui, i18n, settings, ipc
- **Supersedes:** —

## Context

RepoWatch was German-only: every label lived as a literal in the panel and every native error, run notification and tray label as a literal in Rust. The owner asked for a language choice in the settings that, by default, follows the system language (#34).

## Decision

We will ship German and English. Settings → App „Sprache“ offers **System** (default), **Deutsch** and **English**; like the theme, a choice previews at once, applies with „Speichern“ and is kept in `localStorage` (`repowatch.language.v1`); main.ts applies it before the panel mounts. „System“ reads `navigator.languages` — WebView2 takes it from the Windows display language — and picks the first supported language, English otherwise; a `languagechange` event re-resolves it while the app runs.

The panel owns the decision. Its texts live in typed catalogs, one module per area under `src/lib/i18n/{de,en}/`; German is the reference shape, English is typed against it, so a missing key fails `pnpm check`. Components read texts through `m()` at render time, never from module-level constants, so a switch re-renders everything; dates and numbers use `intlLocale()`. The panel reports the resolved language with the IPC command `set_locale { locale }`; Rust keeps it in a process-wide atomic and picks each native text where it is produced (`i18n::tr`, `trf!`), and relabels the tray menu. Until the panel reports, native texts are German.

## Consequences

### Positive

- One setting for the whole app: panel, native errors, notifications and tray speak the same language.
- No runtime dependency; type-checked catalog parity.

### Negative / Trade-offs

- Every new text needs both wordings; review checks it.
- Text produced before a switch (an error already on screen, a notice in the current snapshot) keeps its language until it is produced again.
- Native texts are German for the moment between app start and the panel's first `set_locale`.

### Neutral

- The preference is per device (`localStorage`), like the theme; the native side stores nothing.
- Unit tests and Playwright run German (`locale: 'de-DE'` in `playwright.config.ts`); `tests/language.spec.ts` covers English.

## Alternatives Considered

- **An i18n library (svelte-i18n, typesafe-i18n)** — rejected: a new runtime dependency for two languages and a few hundred keys; plain typed modules give the same safety.
- **String keys with a lookup function** — rejected: typos only fail at runtime; property access is checked by the compiler.
- **Native language detection in Rust (Windows API) as the source of truth** — rejected: the browser demo has no native side, and two detectors could disagree; the panel resolves once and tells Rust.
- **Translating Rust errors in the panel by matching German text** — rejected: brittle with formatted messages.

## References

- Issue #34
- `src/lib/i18n/`, `src/lib/LanguageSetting.svelte`, `src-tauri/src/i18n.rs`
