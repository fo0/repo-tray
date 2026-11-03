//! The app-wide settings row: notifications and the refresh interval.
use super::super::*;
use super::{remove_db, temp_db};

#[test]
fn app_settings_persist_and_the_reserved_key_is_not_an_account() {
    let path = temp_db("settings");
    {
        let cache = Cache::open(&path).unwrap();
        assert!(!cache.load_app_settings().unwrap().notifications);
        cache
            .save_app_settings(&AppSettings {
                notifications: true,
                ..AppSettings::default()
            })
            .unwrap();
    }
    let mut cache = Cache::open(&path).unwrap();
    assert!(cache.load_app_settings().unwrap().notifications);
    assert!(cache.delete_account(APP_SETTINGS_KEY).is_err());
    assert!(cache.load_app_settings().unwrap().notifications);
    drop(cache);
    remove_db(&path);
}

#[test]
fn the_refresh_interval_round_trips_and_an_older_row_keeps_the_default() {
    let cache = Cache::in_memory().unwrap();
    // A row written before the setting existed, with a field from a newer build.
    cache
        .write_settings_row(APP_SETTINGS_KEY, r#"{"notifications":true,"future":1}"#)
        .unwrap();
    let older = cache.load_app_settings().unwrap();
    assert!(older.notifications);
    assert_eq!(older.refresh_seconds, None);
    assert_eq!(older.refresh_interval(), 60);
    // An absent value is not written, so an older build reads the row unchanged.
    assert!(!encode(&older).unwrap().contains("refresh"));
    let chosen = AppSettings {
        refresh_seconds: Some(300),
        ..older
    };
    cache.save_app_settings(&chosen).unwrap();
    let loaded = cache.load_app_settings().unwrap();
    assert_eq!(loaded, chosen);
    assert_eq!(loaded.refresh_interval(), 300);
    // A foreign value outside the range is clamped, never used as is.
    cache
        .write_settings_row(APP_SETTINGS_KEY, r#"{"refreshSeconds":1}"#)
        .unwrap();
    assert_eq!(cache.load_app_settings().unwrap().refresh_interval(), 15);
}
