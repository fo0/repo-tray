//! The user's refresh interval: how often idle repositories, the desktop worker and the
//! account catalogs read GitHub again. An open run is always followed every 15 seconds.

/// Without a saved preference.
pub const DEFAULT_SECONDS: u64 = 60;
pub const MIN_SECONDS: u64 = 15;
pub const MAX_SECONDS: u64 = 3600;
/// An open run is followed this often, whatever the setting.
pub const OPEN_RUN_SECONDS: u64 = 15;
/// The account catalog (which repositories, their push times) never reads more often.
pub const CATALOG_FLOOR_SECONDS: u64 = 60;

const OUT_OF_RANGE: &str = "Aktualisierung muss zwischen 15 s und 60 min liegen.";

/// A value the user chose; out of range is refused, never silently changed.
pub fn validate(seconds: u64) -> Result<u64, String> {
    if (MIN_SECONDS..=MAX_SECONDS).contains(&seconds) {
        Ok(seconds)
    } else {
        Err(OUT_OF_RANGE.into())
    }
}

/// The interval in effect for a stored value: absent means the default, and a value outside
/// the range (an edited or foreign row) is clamped into it.
pub fn effective(stored: Option<u64>) -> u64 {
    stored.map_or(DEFAULT_SECONDS, |seconds| {
        seconds.clamp(MIN_SECONDS, MAX_SECONDS)
    })
}

/// How often each account's catalog is read for a refresh interval.
pub fn catalog_seconds(refresh: u64) -> u64 {
    refresh.max(CATALOG_FLOOR_SECONDS)
}

/// How long a repository or the desktop worker waits before its next poll.
pub fn poll_seconds(open_run: bool, refresh: u64) -> u64 {
    if open_run {
        OPEN_RUN_SECONDS
    } else {
        refresh
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_chosen_value_outside_the_range_is_refused() {
        assert_eq!(validate(15), Ok(15));
        assert_eq!(validate(3600), Ok(3600));
        assert_eq!(validate(14), Err(OUT_OF_RANGE.into()));
        assert_eq!(validate(3601), Err(OUT_OF_RANGE.into()));
        assert_eq!(validate(0), Err(OUT_OF_RANGE.into()));
    }

    #[test]
    fn a_stored_value_defaults_when_absent_and_clamps_when_foreign() {
        assert_eq!(effective(None), DEFAULT_SECONDS);
        assert_eq!(effective(Some(120)), 120);
        assert_eq!(effective(Some(1)), MIN_SECONDS);
        assert_eq!(effective(Some(u64::MAX)), MAX_SECONDS);
    }

    #[test]
    fn the_catalog_keeps_a_floor_and_an_open_run_stays_fast() {
        assert_eq!(catalog_seconds(15), 60);
        assert_eq!(catalog_seconds(60), 60);
        assert_eq!(catalog_seconds(1800), 1800);
        assert_eq!(poll_seconds(true, 1800), 15);
        assert_eq!(poll_seconds(false, 1800), 1800);
        assert_eq!(poll_seconds(false, 15), 15);
        assert_eq!(poll_seconds(true, 15), 15);
    }
}
