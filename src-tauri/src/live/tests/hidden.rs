use super::harness::*;
use crate::live::hidden::{HIDDEN_TOO_MANY, HIDDEN_UNKNOWN, MAX_HIDDEN_REPOS};
use crate::live::schedule::METADATA_SECONDS;
use crate::live::*;

/// `github-1:<number>` for each number.
fn ids(numbers: impl IntoIterator<Item = u64>) -> Vec<String> {
    numbers
        .into_iter()
        .map(|number| format!("github-1:{number}"))
        .collect()
}
fn hidden(number: u64) -> HiddenRepo {
    HiddenRepo {
        account_id: "github-1".into(),
        repo_id: format!("github-1:{number}"),
        owner: "fixture-owner".into(),
        name: format!("fixture-{number}"),
    }
}
/// Eleven repositories of github-1, the lower the number the newer its push; 1 has a run.
fn eleven() -> Harness {
    let mut remote = Remote::new();
    remote.repos.insert("github-1".into(), (1..=11).collect());
    for n in 1..=11 {
        remote
            .pushed
            .insert(n, format!("2026-10-{:02}T08:00:00Z", 30 - n));
    }
    remote.runs.insert(1, vec![run(1, 10, "completed")]);
    let mut h = Harness::new("hidden", remote, &["github-1"]);
    let first = ids(1..=10);
    h.load(&first.iter().map(String::as_str).collect::<Vec<_>>());
    h
}
fn selected(snapshot: &Snapshot) -> Vec<String> {
    selected_ids(snapshot)
        .into_iter()
        .map(String::from)
        .collect()
}

#[test]
fn hiding_frees_the_place_at_once_and_survives_a_restart() {
    let mut h = eleven();
    h.remote().requests.clear();
    let snapshot = h
        .live
        .set_repo_hidden("github-1".into(), "github-1:1".into(), true)
        .unwrap();
    assert!(h.remote().requests.is_empty(), "no network round trip");
    assert_eq!(snapshot.hidden_repos, vec![hidden(1)]);
    assert_eq!(selected(&snapshot), ids(2..=11), "11 moves up");
    assert!(!snapshot.runs.iter().any(|run| run.repo_id == "github-1:1"));
    // Hiding again changes nothing.
    let again = h
        .live
        .set_repo_hidden("github-1".into(), "github-1:1".into(), true)
        .unwrap();
    assert_eq!(again.hidden_repos, vec![hidden(1)]);

    let restarted = h.restart().snapshot();
    assert_eq!(restarted.hidden_repos, vec![hidden(1)]);
    assert_eq!(selected(&restarted), ids(2..=11));

    // The next refresh loads 11's initial history and leaves 1 alone, also after a
    // catalog listing.
    advance(METADATA_SECONDS);
    h.remote().requests.clear();
    let snapshot = h.live.refresh();
    assert_eq!(selected(&snapshot), ids(2..=11));
    assert_eq!(
        h.remote()
            .count("github-1", "/fixture-11/actions/runs?per_page=50"),
        1
    );
    assert_eq!(h.remote().count("github-1", "/fixture-1/"), 0);
}

#[test]
fn showing_again_restores_the_newest_and_a_missing_entry_is_no_error() {
    let mut h = eleven();
    h.live
        .set_repo_hidden("github-1".into(), "github-1:1".into(), true)
        .unwrap();
    let snapshot = h
        .live
        .set_repo_hidden("github-1".into(), "github-1:1".into(), false)
        .unwrap();
    assert!(snapshot.hidden_repos.is_empty());
    assert_eq!(selected(&snapshot), ids(1..=10));
    assert!(h.restart().snapshot().hidden_repos.is_empty());
    // Showing an entry that is gone succeeds and changes nothing.
    let unchanged = h
        .live
        .set_repo_hidden("github-1".into(), "github-1:404".into(), false)
        .unwrap();
    assert_eq!(selected(&unchanged), ids(1..=10));
}

#[test]
fn only_a_known_repository_of_a_connected_account_can_be_hidden() {
    let mut h = eleven();
    for (account, repo) in [
        ("github-1", "github-1:404"),
        ("github-2", "github-1:1"),
        ("", "github-1:1"),
        ("github-1", "github-1:\n1"),
        ("github-1", &"x".repeat(201)),
    ] {
        assert_eq!(
            h.live.set_repo_hidden(account.into(), repo.into(), true),
            Err(HIDDEN_UNKNOWN.into())
        );
    }
    assert!(h.live.snapshot().hidden_repos.is_empty());
    // The list is bounded.
    h.live.hidden = (100..100 + MAX_HIDDEN_REPOS as u64).map(hidden).collect();
    assert_eq!(
        h.live
            .set_repo_hidden("github-1".into(), "github-1:1".into(), true),
        Err(HIDDEN_TOO_MANY.into())
    );
}

#[test]
fn a_favorite_keeps_its_hidden_repository_polled() {
    let mut h = eleven();
    h.live.data.pins.push(Pin {
        id: "pin-1".into(),
        label: "Fixture".into(),
        account_id: "github-1".into(),
        repo_id: "github-1:1".into(),
        workflow_id: 9,
        git_ref: "main".into(),
        inputs: Inputs::new(),
        quick_start: false,
    });
    let snapshot = h
        .live
        .set_repo_hidden("github-1".into(), "github-1:1".into(), true)
        .unwrap();
    let mut expected = ids([1]);
    expected.extend(ids(2..=11));
    assert_eq!(selected(&snapshot), expected);
    assert!(snapshot.runs.iter().any(|run| run.id == 10));
    assert_eq!(snapshot.hidden_repos, vec![hidden(1)]);
}

#[test]
fn disconnecting_an_account_drops_its_hidden_repositories() {
    let mut h = eleven();
    h.live
        .set_repo_hidden("github-1".into(), "github-1:1".into(), true)
        .unwrap();
    // Another preference in the same row stays.
    h.live.set_refresh_interval(300).unwrap();
    assert!(h
        .live
        .disconnect("github-1")
        .unwrap()
        .hidden_repos
        .is_empty());
    assert!(h
        .live
        .cache
        .load_app_settings()
        .unwrap()
        .hidden_repos
        .is_empty());
    let restarted = h.restart();
    assert!(restarted.snapshot().hidden_repos.is_empty());
    assert_eq!(restarted.refresh_interval(), 300);
}
