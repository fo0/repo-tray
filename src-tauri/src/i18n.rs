//! Language of user-facing native text: errors, notifications and tray labels.
//!
//! The panel resolves the user's choice (or the system language) and reports it with the
//! `set_locale` command; until then the native side speaks German. Text is picked where it
//! is produced: [`tr`] for fixed text, [`trf!`](crate::trf) for formatted text. Keep both
//! wordings side by side so neither language falls behind.

use std::sync::atomic::{AtomicU8, Ordering};

/// A language the app ships.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    #[default]
    De,
    En,
}

static CURRENT: AtomicU8 = AtomicU8::new(0);

#[cfg(test)]
thread_local! {
    static OVERRIDE: std::cell::Cell<Option<Locale>> = const { std::cell::Cell::new(None) };
}

/// The language native text is produced in.
pub fn locale() -> Locale {
    #[cfg(test)]
    if let Some(locale) = OVERRIDE.with(std::cell::Cell::get) {
        return locale;
    }
    match CURRENT.load(Ordering::Relaxed) {
        1 => Locale::En,
        _ => Locale::De,
    }
}

/// Switches every text produced from now on.
pub fn set_locale(locale: Locale) {
    CURRENT.store(
        match locale {
            Locale::De => 0,
            Locale::En => 1,
        },
        Ordering::Relaxed,
    );
}

/// The German or the English wording, whichever is in effect.
pub fn tr(de: &'static str, en: &'static str) -> &'static str {
    match locale() {
        Locale::De => de,
        Locale::En => en,
    }
}

/// `format!` with a German and an English format string; both take the same arguments.
#[macro_export]
macro_rules! trf {
    ($de:literal, $en:literal $(, $arg:expr)* $(,)?) => {
        match $crate::i18n::locale() {
            $crate::i18n::Locale::De => format!($de $(, $arg)*),
            $crate::i18n::Locale::En => format!($en $(, $arg)*),
        }
    };
}

/// Runs `body` with `locale` in effect on this thread only, so parallel tests never race.
#[cfg(test)]
pub fn with_locale<T>(locale: Locale, body: impl FnOnce() -> T) -> T {
    let previous = OVERRIDE.with(|cell| cell.replace(Some(locale)));
    let result = body();
    OVERRIDE.with(|cell| cell.set(previous));
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn german_is_the_default() {
        assert_eq!(tr("Ja", "Yes"), "Ja");
    }

    #[test]
    fn english_applies_inside_the_override_only() {
        assert_eq!(with_locale(Locale::En, || tr("Ja", "Yes")), "Yes");
        assert_eq!(tr("Ja", "Yes"), "Ja");
    }

    #[test]
    fn formats_both_wordings_with_captured_arguments() {
        let count = 3;
        assert_eq!(trf!("{count} Runs", "{count} runs"), "3 Runs");
        assert_eq!(
            with_locale(Locale::En, || trf!("{} Runs", "{} runs", count)),
            "3 runs"
        );
    }

    #[test]
    fn reads_the_panel_values() {
        assert_eq!(
            serde_json::from_str::<Locale>("\"en\"").unwrap(),
            Locale::En
        );
        assert_eq!(
            serde_json::from_str::<Locale>("\"de\"").unwrap(),
            Locale::De
        );
    }
}
