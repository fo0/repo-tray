use super::harness::*;
use crate::live::schedule::{Schedule, METADATA_SECONDS};

#[test]
fn the_interval_is_validated_stored_and_survives_a_restart() {
    let mut h = Harness::new("refresh-interval", Remote::new(), &["github-1"]);
    assert_eq!(h.live.refresh_interval(), 60, "the default");
    assert!(h.live.set_refresh_interval(14).is_err());
    assert!(h.live.set_refresh_interval(3601).is_err());
    assert_eq!(
        h.live.refresh_interval(),
        60,
        "a refused value changes nothing"
    );
    assert_eq!(h.live.set_refresh_interval(300), Ok(300));
    assert_eq!(h.live.refresh_interval(), 300);
    assert_eq!(h.restart().refresh_interval(), 300);
    // The other preference in the same row is kept.
    h.live.set_notifications_enabled(true).unwrap();
    assert_eq!(h.restart().refresh_interval(), 300);
    assert!(h.restart().notifications_enabled());
}

#[test]
fn the_catalog_follows_the_interval_and_metadata_keeps_its_own() {
    let mut h = Harness::new("refresh-catalog", Remote::new(), &["github-1"]);
    h.load(&["github-1:1"]);
    // With the default, the catalog is read again after one minute.
    h.remote().requests.clear();
    advance(60);
    h.live.refresh();
    assert_eq!(h.remote().count("github-1", "/user/repos"), 1);
    // A longer interval applies from the next read; metadata keeps its ten minutes.
    h.live.set_refresh_interval(1800).unwrap();
    h.remote().requests.clear();
    advance(60);
    h.live.refresh();
    assert_eq!(h.remote().count("github-1", "/user/repos"), 1);
    h.remote().requests.clear();
    advance(METADATA_SECONDS);
    h.live.refresh();
    assert_eq!(h.remote().count("github-1", "/user/repos"), 0);
    assert_eq!(h.remote().count("github-1", "/branches"), 1);
    h.remote().requests.clear();
    advance(1800 - METADATA_SECONDS);
    h.live.refresh();
    assert_eq!(h.remote().count("github-1", "/user/repos"), 1);
}

#[test]
fn a_short_interval_keeps_the_catalog_floor_and_a_long_one_widens_the_clock_guard() {
    let mut schedule = Schedule::new(15);
    schedule.catalog_read("a", None, 100);
    assert!(
        !schedule.catalog_due("a", 159),
        "never faster than a minute"
    );
    assert!(schedule.catalog_due("a", 160));
    // An hour-long interval is not mistaken for a backward clock jump.
    schedule.set_refresh(3600);
    schedule.catalog_read("a", None, 100);
    assert!(!schedule.catalog_due("a", 100 + METADATA_SECONDS));
    assert!(!schedule.catalog_due("a", 3699));
    assert!(schedule.catalog_due("a", 3700));
    // Still, a deadline further ahead than any interval was set before the clock went back.
    schedule.catalog_read("b", None, 10_000);
    assert!(schedule.catalog_due("b", 5_000));
    // Shortening the interval lets a deadline beyond the new bound count as reached.
    schedule.set_refresh(60);
    assert!(schedule.catalog_due("a", 200));
}
