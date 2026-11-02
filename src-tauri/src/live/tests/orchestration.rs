use super::harness::*;
use crate::live::schedule::{CATALOG_SECONDS, RETRY_SECONDS};
use crate::live::*;
use crate::run_history::{Cause, ScopeError};

#[test]
fn the_claim_is_stored_before_the_post_and_an_accepted_start_releases_it() {
    let mut remote = Remote::new();
    remote.dispatches.push_back(confirmation(1, 77));
    let mut h = Harness::new("accepted", remote, &["github-1"]);
    h.load(&["github-1:1"]);
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
    h.load(&["github-1:1"]);
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
    h.load(&["github-1:1"]);
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
    h.load(&["github-1:1"]);
    h.live.data.stale = true;
    h.remote().requests.clear();
    let outcome = h.live.dispatch(request("start-1", "main"));
    assert_eq!(outcome.state, DispatchState::Rejected);
    assert_eq!(outcome.message, "Klicke zuerst auf Aktualisieren.");
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
    h.load(&["github-1:1"]);
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
    h.load(&["github-1:1"]);
    let refs = &h.live.data.workflows[0].refs;
    assert!(refs.contains(&"release/gone".to_string()));
    assert!(refs.contains(&"v1".to_string()), "tags are not starved");
    assert!(refs.contains(&"main".to_string()));
    // The workflow read at the ref fails before any claim; nothing is sent.
    let outcome = h.live.dispatch(request("start-1", "release/gone"));
    assert_eq!(outcome.state, DispatchState::Rejected);
    assert_eq!(
        outcome.message,
        "Workflow auf „release/gone“ nicht gefunden – der Branch oder Tag fehlt oder enthält den Workflow nicht."
    );
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
    h.load(&["github-1:1", "github-1:2", "github-1:3"]);
    assert!(h.live.snapshot().runs.iter().any(|run| run.id == 20));
    h.remote().runs_status.extend([(2, 403), (3, 404)]);
    advance(60);
    let snapshot = h.live.refresh();
    assert!(!snapshot.stale);
    assert_eq!(snapshot.connectivity, Connectivity::Online);
    assert_eq!(
        snapshot.message.as_deref(),
        Some("Kein Zugriff auf Workflows: fixture-owner/fixture-2 (+1 weitere) – prüfe Token-Rechte oder SSO-Freigabe.")
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
    h.load(&["github-1:1", "github-1:2"]);
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
    h.load(&["github-1:1"]);
    let snapshot = h.live.snapshot();
    assert!(snapshot.stale);
    assert_eq!(snapshot.connectivity, Connectivity::Forbidden);
    // The revoked account heads the message; the failing github-3 catalog counts too.
    assert_eq!(
        snapshot.message.as_deref(),
        Some("Letzter Stand · Zugang von fixture-github-2 abgelaufen oder widerrufen – verbinde das Konto neu. (+1 weitere)")
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
fn a_backward_clock_jump_neither_stalls_reads_nor_extends_a_hold() {
    let mut remote = Remote::new();
    remote.account_status.insert("github-2".into(), 401);
    let mut h = Harness::new("clock", remote, &["github-1", "github-2"]);
    h.load(&["github-1:1"]);
    // The clock goes back a day: every deadline now lies more than an interval ahead.
    h.remote().requests.clear();
    rewind(86_400);
    h.live.refresh();
    {
        let remote = h.remote();
        assert_eq!(remote.count("github-1", "/user/repos"), 1, "catalog");
        assert_eq!(remote.count("github-1", "/branches"), 1, "metadata");
        assert!(remote.count("github-1", "/actions/runs") > 0, "runs");
        assert_eq!(remote.count("github-2", "/user/repos"), 1, "the hold ended");
        let window = remote
            .requests
            .iter()
            .filter(|(account, _, _)| account == "github-1")
            .find_map(|(_, _, target)| {
                let url = reqwest::Url::parse(&format!("https://api.github.com{target}")).ok()?;
                let created = url.query_pairs().find(|(key, _)| key == "created")?;
                Some(created.1.into_owned())
            })
            .expect("a discovery window");
        let opened = chrono::DateTime::from_timestamp(clock() as i64 - 2, 0).unwrap();
        assert_eq!(
            window,
            format!(">={}", opened.to_rfc3339()),
            "the discovery window never opens in the future"
        );
    }
    // From here the timers run on the new clock: no storm, and the new hold holds.
    h.remote().requests.clear();
    advance(RETRY_SECONDS);
    h.live.refresh();
    {
        let remote = h.remote();
        assert_eq!(remote.count("github-1", "/user/repos"), 0);
        assert_eq!(remote.count("github-1", "/branches"), 0);
        assert_eq!(remote.count("github-2", "/"), 0);
    }
    // The account recovers and the clock goes back again, ending the new hold early. Once the
    // clock catches up to within an interval of that hold's old deadline, it never reapplies.
    h.remote().account_status.remove("github-2");
    rewind(86_400);
    let snapshot = h.live.refresh();
    assert_ne!(snapshot.connectivity, Connectivity::Forbidden);
    advance(86_400 - RETRY_SECONDS);
    h.remote().requests.clear();
    let snapshot = h.live.refresh();
    assert_ne!(
        snapshot.connectivity,
        Connectivity::Forbidden,
        "{:?}",
        snapshot.message
    );
    assert!(!snapshot
        .message
        .as_deref()
        .is_some_and(|message| message.contains("fixture-github-2")));
    assert_eq!(h.remote().count("github-2", "/user/repos"), 1);
}

#[test]
fn a_missing_vault_entry_holds_its_account_and_asks_to_reconnect_or_disconnect() {
    let mut remote = Remote::new();
    remote.repos.insert("github-2".into(), vec![2]);
    remote.missing.insert("github-2".into());
    let mut h = Harness::new("missing", remote, &["github-1", "github-2"]);
    h.load(&["github-1:1"]);
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
        pushed_at: None,
        selected: true,
        permission: Permission::Write,
    }];
    schedule.forget_account("c", &repos);
    assert!(schedule.held("c", 101).is_none());
    assert!(schedule.catalog_due("c", 101) && schedule.metadata_due("c:1", 201));
    // A deadline further ahead than its interval was set before the clock went back.
    schedule.catalog_read("d", None, 10_000);
    schedule.metadata_read("d:1", None, 10_000);
    schedule.hold("e", revoked.clone(), 10_000);
    assert!(!schedule.catalog_due("d", 10_100) && !schedule.metadata_due("d:1", 10_100));
    assert_eq!(schedule.held("e", 10_100), Some(&revoked));
    assert!(schedule.catalog_due("d", 9_000) && schedule.metadata_due("d:1", 9_000));
    assert_eq!(schedule.held("e", 9_000), None);
}

#[test]
fn a_workflow_listing_past_the_page_budget_keeps_known_workflows_and_names_the_cut() {
    let mut h = Harness::new("endless-workflows", Remote::new(), &["github-1"]);
    h.load(&["github-1:1"]);
    assert_eq!(h.live.data.workflows.len(), 1);
    h.remote().endless_workflows = true;
    advance(CATALOG_SECONDS);
    let snapshot = h.live.refresh();
    assert_eq!(snapshot.workflows.len(), 1, "the known workflows stay");
    assert!(snapshot.stale);
    let message = snapshot.message.unwrap_or_default();
    assert!(
        message.contains("Liste von fixture-owner/fixture-1 unvollständig – zu viele Einträge."),
        "{message}"
    );
}

#[test]
fn an_environment_listing_past_the_page_budget_disables_only_that_input() {
    let mut remote = Remote::new();
    remote.workflow_source = Some(
        "on:\n  workflow_dispatch:\n    inputs:\n      target: {type: environment}\n      note: {type: string}\n",
    );
    remote.endless_environments = true;
    remote.runs.insert(1, vec![run(1, 11, "in_progress")]);
    remote.dispatches.push_back(confirmation(1, 77));
    let mut h = Harness::new("endless-environments", remote, &["github-1"]);
    h.load(&["github-1:1"]);
    assert!(!h.live.data.stale, "{:?}", h.live.data.message);
    // The workflow stays startable; only the environment choice is unavailable.
    let workflow = &h.live.data.workflows[0];
    assert!(workflow.dispatch);
    let target = &workflow.inputs[0];
    assert!(target.options.is_empty());
    assert_eq!(
        target.note.as_deref(),
        Some("Zu viele Umgebungen – Auswahl nicht verfügbar.")
    );
    assert_eq!(workflow.inputs[1].note, None);
    assert_eq!(h.live.data.runs.len(), 1, "the repository is polled");
    // No value is accepted for the unavailable input, and nothing is claimed or sent.
    let mut guessed = request("start-1", "main");
    guessed
        .inputs
        .insert("target".into(), InputValue::String("production".into()));
    let outcome = h.live.dispatch(guessed);
    assert_eq!(outcome.state, DispatchState::Rejected);
    assert_eq!(
        outcome.message,
        "„target“: Zu viele Umgebungen – Auswahl nicht verfügbar."
    );
    assert_eq!(h.remote().posts(), 0);
    // Without it the workflow still starts.
    let outcome = h.live.dispatch(request("start-2", "main"));
    assert_eq!(
        outcome.state,
        DispatchState::Accepted,
        "{}",
        outcome.message
    );
    // Run polling continues: a new run of the repository appears.
    h.remote()
        .runs
        .get_mut(&1)
        .unwrap()
        .push(run(1, 12, "queued"));
    advance(CATALOG_SECONDS);
    let snapshot = h.live.refresh();
    assert!(snapshot.runs.iter().any(|run| run.id == 12));
}
