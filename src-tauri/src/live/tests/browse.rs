use super::harness::*;
use crate::live::browse::BROWSED_REPOS;
use crate::live::schedule::CATALOG_SECONDS;

fn ids(numbers: impl IntoIterator<Item = u64>) -> Vec<String> {
    numbers
        .into_iter()
        .map(|n| format!("github-1:{n}"))
        .collect()
}
fn strs(ids: &[String]) -> Vec<&str> {
    ids.iter().map(String::as_str).collect()
}

/// `count` repositories; the lower the number, the newer its push, so 1–10 are selected.
fn listed(name: &str, count: u64) -> Harness {
    let mut remote = Remote::new();
    remote
        .repos
        .insert("github-1".into(), (1..=count).collect());
    for n in 1..=count {
        remote
            .pushed
            .insert(n, format!("2026-10-{:02}T08:00:00Z", 31 - n));
    }
    let mut h = Harness::new(name, remote, &["github-1"]);
    h.load(&strs(&ids(1..=10)));
    h.remote().requests.clear();
    h
}

#[test]
fn an_opened_repository_loads_at_once_and_survives_the_next_catalog_listing() {
    let mut h = listed("browse-open", 12);
    assert!(!h
        .live
        .data
        .workflows
        .iter()
        .any(|w| w.repo_id == "github-1:12"));
    h.remote().runs.insert(12, vec![run(12, 120, "completed")]);
    let snapshot = h.live.open_repository("github-1:12".into()).unwrap();
    assert!(selected_ids(&snapshot).contains(&"github-1:12"));
    assert!(snapshot
        .workflows
        .iter()
        .any(|w| w.repo_id == "github-1:12" && w.id == 9 && w.dispatch));
    assert!(snapshot.runs.iter().any(|run| run.id == 120));
    {
        let remote = h.remote();
        assert_eq!(remote.count("github-1", "/fixture-12/branches"), 1);
        assert_eq!(
            remote.count("github-1", "/fixture-12/actions/runs?per_page=50"),
            1,
            "its initial history"
        );
        // The other repositories keep their own timers.
        assert_eq!(remote.count("github-1", "/fixture-1/"), 0);
        assert_eq!(remote.count("github-1", "/user/repos"), 0);
    }
    // The next listing would deselect it by push time; the opened repository stays.
    advance(CATALOG_SECONDS);
    h.remote().requests.clear();
    let snapshot = h.live.refresh();
    assert_eq!(h.remote().count("github-1", "/user/repos"), 1);
    let mut expected = ids(1..=10);
    expected.push("github-1:12".into());
    assert_eq!(selected_ids(&snapshot), strs(&expected));
    assert!(snapshot.runs.iter().any(|run| run.id == 120));
    // Opened repositories are never persisted: after a restart the listing deselects it.
    let mut restarted = h.restart();
    let snapshot = restarted.refresh();
    assert_eq!(selected_ids(&snapshot), strs(&ids(1..=10)));
}

#[test]
fn a_deselected_repository_reads_its_metadata_again_when_opened() {
    let mut h = listed("browse-reopen", 10);
    // Deselected after its metadata was read, whose timer has not run out yet.
    h.live.data.repos[0].selected = false;
    let snapshot = h.live.open_repository("github-1:1".into()).unwrap();
    assert!(selected_ids(&snapshot).contains(&"github-1:1"));
    let remote = h.remote();
    assert_eq!(remote.count("github-1", "/fixture-1/branches"), 1);
    assert_eq!(
        remote.count("github-1", "/fixture-1/actions/runs?per_page=50"),
        1
    );
}

#[test]
fn at_most_five_opened_repositories_are_kept_and_reopening_one_renews_it() {
    let mut h = listed("browse-lru", 17);
    for n in 11..=16 {
        h.live.open_repository(format!("github-1:{n}")).unwrap();
    }
    assert_eq!(BROWSED_REPOS, 5);
    assert_eq!(h.live.browsed.ids(), strs(&ids(12..=16)));
    // An already selected repository, automatic or opened, takes no new place.
    h.live.open_repository("github-1:1".into()).unwrap();
    h.live.open_repository("github-1:12".into()).unwrap();
    let mut renewed = ids(13..=16);
    renewed.push("github-1:12".into());
    assert_eq!(h.live.browsed.ids(), strs(&renewed));
    // 11 dropped out first and stays selected only until the next listing.
    assert!(selected_ids(&h.live.snapshot()).contains(&"github-1:11"));
    advance(CATALOG_SECONDS);
    let snapshot = h.live.refresh();
    let mut expected = ids(1..=10);
    expected.extend(ids(12..=16));
    assert_eq!(selected_ids(&snapshot), strs(&expected));
    // Opening a sixth drops the least recently opened one, 13.
    h.live.open_repository("github-1:17".into()).unwrap();
    let mut kept = ids(14..=16);
    kept.extend(ids([12, 17]));
    assert_eq!(h.live.browsed.ids(), strs(&kept));
}

#[test]
fn only_a_listed_repository_of_a_connected_account_opens_and_disconnecting_forgets_it() {
    let mut h = listed("browse-unknown", 11);
    for unknown in ["github-1:99", "github-2:11", ""] {
        assert_eq!(
            h.live.open_repository(unknown.into()).unwrap_err(),
            "Repository nicht gefunden."
        );
    }
    assert!(h.remote().requests.is_empty());
    h.live.open_repository("github-1:11".into()).unwrap();
    assert_eq!(h.live.browsed.ids(), ["github-1:11"]);
    h.live.disconnect("github-1").unwrap();
    assert!(h.live.browsed.ids().is_empty());
}
