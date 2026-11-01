use super::harness::*;
use crate::live::schedule::{CATALOG_SECONDS, RETRY_SECONDS};
use crate::live::*;
use crate::run_history::{Cause, ScopeError};

#[test]
fn the_claim_is_stored_before_the_post_and_an_accepted_start_releases_it() {
    let mut remote = Remote::new();
    remote.dispatches.push_back(confirmation(1, 77));
    let mut h = Harness::new("accepted", remote, &["github-1"]);
    h.select(&["github-1:1"]);
    assert!(!h.live.data.stale, "{:?}", h.live.data.message);
    let outcome = h.live.dispatch(request("start-1", "feature"));
    assert_eq!(
        outcome.state,
        DispatchState::Accepted,
        "{}",
        outcome.message
    );
    assert_eq!(outcome.run_id, Some(77));
    assert_eq!(h.remote().claims_at_post, vec![1]);
    assert!(h.live.snapshot().uncertain_starts.is_empty());
    assert!(h.restart().snapshot().uncertain_starts.is_empty());
}

#[test]
fn an_uncertain_start_keeps_its_claim_across_restart_and_is_never_sent_again() {
    let mut remote = Remote::new();
    remote
        .dispatches
        .push_back(json(204, serde_json::json!({})));
    let mut h = Harness::new("uncertain", remote, &["github-1"]);
    h.select(&["github-1:1"]);
    let first = h.live.dispatch(request("start-1", "main"));
    assert_eq!(first.state, DispatchState::Uncertain);
    assert_eq!(h.remote().claims_at_post, vec![1]);
    assert_eq!(h.live.snapshot().uncertain_starts.len(), 1);
    let second = h.live.dispatch(request("start-2", "main"));
    assert_eq!(second.state, DispatchState::Uncertain);
    assert_eq!(h.remote().posts(), 1);
    let mut restarted = h.restart();
    restarted.refresh();
    assert!(!restarted.data.stale);
    assert_eq!(restarted.snapshot().uncertain_starts.len(), 1);
    let third = restarted.dispatch(request("start-3", "main"));
    assert_eq!(third.state, DispatchState::Uncertain);
    assert_eq!(
        h.remote().posts(),
        1,
        "an uncertain target is never sent again"
    );
}

#[test]
fn a_rejected_start_releases_its_claim_and_the_target_can_start_again() {
    let mut remote = Remote::new();
    remote.dispatches.push_back(json(
        422,
        serde_json::json!({"message": "Unexpected inputs"}),
    ));
    remote.dispatches.push_back(confirmation(1, 78));
    let mut h = Harness::new("rejected", remote, &["github-1"]);
    h.select(&["github-1:1"]);
    let first = h.live.dispatch(request("start-1", "main"));
    assert_eq!(first.state, DispatchState::Rejected);
    assert!(
        first.message.contains("abgelehnt (HTTP 422)"),
        "{}",
        first.message
    );
    assert!(h.live.snapshot().uncertain_starts.is_empty());
    assert!(h.restart().snapshot().uncertain_starts.is_empty());
    let second = h.live.dispatch(request("start-2", "main"));
    assert_eq!(second.state, DispatchState::Accepted, "{}", second.message);
    assert_eq!(h.remote().claims_at_post, vec![1, 1]);
}

#[test]
fn a_stale_snapshot_refuses_dispatch_before_any_request_or_claim() {
    let mut h = Harness::new("stale", Remote::new(), &["github-1"]);
    h.select(&["github-1:1"]);
    h.live.data.stale = true;
    h.remote().requests.clear();
    let outcome = h.live.dispatch(request("start-1", "main"));
    assert_eq!(outcome.state, DispatchState::Rejected);
    assert_eq!(outcome.message, "Verbindung zuerst aktualisieren.");
    assert!(h.remote().requests.is_empty());
    assert!(h.live.snapshot().uncertain_starts.is_empty());
}

#[test]
fn a_request_id_replays_its_outcome_and_refuses_a_changed_payload() {
    let mut remote = Remote::new();
    remote.dispatches.push_back(json(
        422,
        serde_json::json!({"message": "Unexpected inputs"}),
    ));
    let mut h = Harness::new("request-id", remote, &["github-1"]);
    h.select(&["github-1:1"]);
    let first = h.live.dispatch(request("start-1", "main"));
    assert_eq!(first.state, DispatchState::Rejected);
    assert_eq!(h.live.dispatch(request("start-1", "main")), first);
    let changed = h.live.dispatch(request("start-1", "feature"));
    assert_eq!(changed.message, "Start-ID bereits verwendet.");
    assert_eq!(h.remote().posts(), 1);
}

#[test]
fn a_pinned_ref_beyond_a_cut_off_listing_is_offered_and_a_vanished_one_is_rejected_unclaimed() {
    let mut remote = Remote::new();
    remote.endless_branches = true;
    let mut h = Harness::new("pinned-ref", remote, &["github-1"]);
    h.live.refresh();
    h.live.data.pins.push(Pin {
        id: "pin-1".into(),
        label: "Fixture release".into(),
        account_id: "github-1".into(),
        repo_id: "github-1:1".into(),
        workflow_id: 9,
        git_ref: "release/gone".into(),
        inputs: Inputs::new(),
        quick_start: true,
    });
    h.live.select_repos(vec!["github-1:1".into()]).unwrap();
    let refs = &h.live.data.workflows[0].refs;
    assert!(refs.contains(&"release/gone".to_string()));
    assert!(refs.contains(&"v1".to_string()), "tags are not starved");
    assert!(refs.contains(&"main".to_string()));
    // The workflow read at the ref fails before any claim; nothing is sent.
    let outcome = h.live.dispatch(request("start-1", "release/gone"));
    assert_eq!(outcome.state, DispatchState::Rejected);
    assert_eq!(outcome.message, "GitHub-Fehler 404.");
    assert_eq!(h.remote().posts(), 0);
    assert!(h.remote().claims_at_post.is_empty());
    assert!(h.live.snapshot().uncertain_starts.is_empty());
}

#[test]
fn a_denied_repository_is_named_without_staling_and_its_frozen_open_runs_leave_the_panel() {
    let mut remote = Remote::new();
    remote.repos.insert("github-1".into(), vec![1, 2, 3]);
    remote.runs.insert(1, vec![run(1, 10, "completed")]);
    remote
        .runs
        .insert(2, vec![run(2, 20, "in_progress"), run(2, 21, "completed")]);
    let mut h = Harness::new("denied", remote, &["github-1"]);
    h.select(&["github-1:1", "github-1:2", "github-1:3"]);
    assert!(h.live.snapshot().runs.iter().any(|run| run.id == 20));
    h.remote().runs_status.extend([(2, 403), (3, 404)]);
    advance(60);
    let snapshot = h.live.refresh();
    assert!(!snapshot.stale);
    assert_eq!(snapshot.connectivity, Connectivity::Online);
    assert_eq!(
        snapshot.message.as_deref(),
        Some("Kein Zugriff auf Actions: fixture-owner/fixture-2 (+1 weitere) – prüfe Token-Rechte oder SSO-Freigabe.")
    );
    let ids: BTreeSet<_> = snapshot.runs.iter().map(|run| run.id).collect();
    assert_eq!(
        ids,
        BTreeSet::from([10, 21]),
        "the frozen open run is hidden"
    );
    assert!(snapshot
        .repos
        .iter()
        .filter(|repo| repo.id != "github-1:1")
        .all(|repo| repo.permission == Permission::Denied));
    // The notice stays while the repository is denied; no request retries it early.
    h.remote().requests.clear();
    advance(60);
    let again = h.live.refresh();
    assert_eq!(again.message, snapshot.message);
    assert_eq!(h.remote().count("github-1", "fixture-2"), 0);
}

#[test]
fn a_partial_refresh_keeps_and_persists_the_healthy_scopes() {
    let mut remote = Remote::new();
    remote.repos.insert("github-1".into(), vec![1, 2]);
    remote.runs.insert(1, vec![run(1, 10, "completed")]);
    remote.runs_status.insert(2, 502);
    let mut h = Harness::new("partial", remote, &["github-1"]);
    h.select(&["github-1:1", "github-1:2"]);
    let snapshot = h.live.snapshot();
    assert!(snapshot.stale);
    assert_eq!(snapshot.connectivity, Connectivity::Offline);
    assert_eq!(
        snapshot.message.as_deref(),
        Some("Letzter Stand · GitHub-Fehler 502 bei fixture-owner/fixture-2.")
    );
    assert!(snapshot.runs.iter().any(|run| run.id == 10));
    let cached = Cache::open(&h.path)
        .unwrap()
        .load_snapshot("github-1")
        .unwrap()
        .unwrap();
    assert!(cached.runs.iter().any(|run| run.id == 10));
    assert_eq!(cached.repos.iter().filter(|repo| repo.selected).count(), 2);
}

#[test]
fn a_revoked_account_neither_storms_healthy_metadata_nor_retries_before_its_hold_ends() {
    let mut remote = Remote::new();
    remote.repos.insert("github-3".into(), vec![3]);
    remote.account_status.insert("github-2".into(), 401);
    remote.account_status.insert("github-3".into(), 502);
    let mut h = Harness::new("storm", remote, &["github-1", "github-2", "github-3"]);
    h.select(&["github-1:1"]);
    let snapshot = h.live.snapshot();
    assert!(snapshot.stale);
    assert_eq!(snapshot.connectivity, Connectivity::Forbidden);
    assert_eq!(
        snapshot.message.as_deref(),
        Some("Letzter Stand · Zugang von fixture-github-2 abgelaufen oder widerrufen – verbinde das Konto neu.")
    );
    // One minute later: run polling only. The revoked account sends nothing, the transient
    // catalog failure retries alone, and healthy metadata is not read again.
    h.remote().requests.clear();
    advance(60);
    let snapshot = h.live.refresh();
    {
        let remote = h.remote();
        for fragment in ["/branches", "/tags", "/actions/workflows", "/contents/"] {
            assert_eq!(remote.count("github-1", fragment), 0, "{fragment}");
        }
        assert_eq!(remote.count("github-1", "/user/repos"), 0);
        assert_eq!(remote.count("github-2", "/"), 0);
        assert_eq!(remote.count("github-3", "/user/repos"), 1);
        assert!(remote.count("github-1", "/actions/runs") > 0);
    }
    assert!(snapshot.message.as_deref().is_some_and(|message| message
        .starts_with("Letzter Stand · Zugang von fixture-github-2")
        && message.ends_with("(+1 weitere)")));
    // The full interval later every catalog and the healthy metadata are due again, and the
    // revoked account gets exactly one new try.
    h.remote().requests.clear();
    advance(CATALOG_SECONDS - 60);
    h.live.refresh();
    let remote = h.remote();
    assert_eq!(remote.count("github-2", "/"), 1);
    assert_eq!(remote.count("github-1", "/user/repos"), 1);
    assert_eq!(remote.count("github-1", "/branches"), 1);
}

#[test]
fn a_missing_vault_entry_holds_its_account_and_asks_to_reconnect_or_disconnect() {
    let mut remote = Remote::new();
    remote.repos.insert("github-2".into(), vec![2]);
    remote.missing.insert("github-2".into());
    let mut h = Harness::new("missing", remote, &["github-1", "github-2"]);
    h.select(&["github-1:1"]);
    let snapshot = h.live.snapshot();
    assert!(snapshot.stale);
    assert_eq!(snapshot.connectivity, Connectivity::Forbidden);
    assert_eq!(
        snapshot.message.as_deref(),
        Some("Letzter Stand · Zugang von fixture-github-2 fehlt im Tresor – verbinde das Konto neu oder trenne es.")
    );
    assert!(snapshot.workflows.iter().any(|w| w.repo_id == "github-1:1"));
    // Held like a revoked account: no retry after a minute, one after the full interval.
    h.remote().requests.clear();
    advance(RETRY_SECONDS);
    h.live.refresh();
    assert_eq!(h.remote().count("github-2", "/"), 0);
    advance(CATALOG_SECONDS - RETRY_SECONDS);
    h.live.refresh();
    assert_eq!(h.remote().count("github-2", "/"), 1);
    // Disconnecting it is possible and leaves the healthy account fresh.
    let snapshot = h.live.disconnect("github-2").unwrap();
    assert_eq!(snapshot.accounts, vec![account("github-1")]);
    advance(RETRY_SECONDS);
    let snapshot = h.live.refresh();
    assert!(!snapshot.stale, "{:?}", snapshot.message);
    // An entry that vanishes between catalog reads is caught by the run poll and held too.
    h.remote().missing.insert("github-1".into());
    advance(RETRY_SECONDS);
    let snapshot = h.live.refresh();
    assert_eq!(snapshot.connectivity, Connectivity::Forbidden);
    assert_eq!(
        snapshot.message.as_deref(),
        Some("Letzter Stand · Zugang von fixture-github-1 fehlt im Tresor – verbinde das Konto neu oder trenne es.")
    );
    h.remote().requests.clear();
    advance(RETRY_SECONDS);
    h.live.refresh();
    assert_eq!(h.remote().count("github-1", "/"), 0);
}

#[test]
fn schedule_timers_are_per_scope_and_unauthorized_waits_the_full_interval() {
    let revoked = ScopeError::Unauthorized(Cause::Http(401));
    let transient = ScopeError::Transient(Cause::Unreachable);
    let mut schedule = Schedule::default();
    assert!(schedule.catalog_due("a", 0) && schedule.metadata_due("a:1", 0));
    schedule.catalog_read("a", None, 100);
    assert!(!schedule.catalog_due("a", 100 + CATALOG_SECONDS - 1));
    assert!(schedule.catalog_due("a", 100 + CATALOG_SECONDS));
    schedule.catalog_read("b", Some(&transient), 100);
    assert!(schedule.catalog_due("b", 100 + RETRY_SECONDS));
    schedule.catalog_read("c", Some(&revoked), 100);
    assert!(!schedule.catalog_due("c", 100 + RETRY_SECONDS));
    schedule.hold("c", revoked.clone(), 100);
    assert_eq!(
        schedule.held("c", 100 + CATALOG_SECONDS - 1),
        Some(&revoked)
    );
    assert_eq!(schedule.held("c", 100 + CATALOG_SECONDS), None);
    schedule.metadata_read("c:1", Some(&transient), 100);
    assert!(!schedule.metadata_due("c:1", 159));
    assert!(schedule.metadata_due("c:1", 160));
    schedule.metadata_read("a:1", None, 100);
    schedule.metadata_read("a:1", Some(&ScopeError::Denied(Cause::Http(403))), 101);
    assert!(
        schedule.metadata_due("a:1", 101),
        "a denied repository reads at once when allowed again"
    );
    // A reconnect starts the account over.
    schedule.metadata_read("c:1", None, 200);
    let repos = [Repo {
        id: "c:1".into(),
        account_id: "c".into(),
        owner: "fixture-owner".into(),
        name: "fixture-1".into(),
        default_branch: "main".into(),
        selected: true,
        permission: Permission::Write,
    }];
    schedule.forget_account("c", &repos);
    assert!(schedule.held("c", 101).is_none());
    assert!(schedule.catalog_due("c", 101) && schedule.metadata_due("c:1", 201));
}
