use super::*;

fn request() -> DispatchRequest {
    DispatchRequest {
        account_id: "demo-personal".into(),
        repo_id: "demo-personal-kit".into(),
        workflow_id: 101,
        git_ref: "main".into(),
        inputs: Inputs::new(),
        request_id: "start-1".into(),
    }
}

#[test]
fn fixture_round_trips_the_ui_contract() {
    let snapshot = DemoStore::new().snapshot();
    let json = serde_json::to_value(&snapshot).unwrap();
    assert_eq!(json["mode"], "demo");
    assert_eq!(json["repos"][0]["accountId"], "demo-personal");
    assert_eq!(json["pins"][0]["ref"], "main");
    let fixture: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
    assert_eq!(json, fixture);
}

#[test]
fn each_account_shows_its_ten_newest_repositories_and_its_favorites() {
    let snapshot = DemoStore::new().snapshot();
    let shown = |account: &str| {
        snapshot
            .repos
            .iter()
            .filter(|repo| repo.account_id == account && repo.selected)
            .count()
    };
    assert_eq!(shown("demo-work"), crate::auto_repos::AUTO_REPOS);
    assert_eq!(shown("demo-personal"), 2);
    let hidden: Vec<_> = snapshot
        .repos
        .iter()
        .filter(|repo| !repo.selected)
        .map(|repo| repo.id.as_str())
        .collect();
    assert_eq!(hidden, ["demo-extra", "demo-work-legacy"]);
}

#[test]
fn default_branch_presence_is_required_but_tags_can_be_dispatched() {
    let mut store = DemoStore::new();
    let mut tag = request();
    tag.git_ref = "v0.1.0".into();
    assert_eq!(store.dispatch(tag).state, DispatchState::Accepted);
    store.snapshot.workflows[0]
        .refs
        .retain(|git_ref| git_ref != "main");
    let mut next = request();
    next.request_id = "start-2".into();
    next.git_ref = "develop".into();
    assert_eq!(store.dispatch(next).state, DispatchState::Rejected);
}

#[test]
fn double_dispatch_is_idempotent_even_after_refresh() {
    let mut store = DemoStore::new();
    let original_count = store.snapshot.runs.len();
    let outcome = store.dispatch(request());
    assert_eq!(outcome.state, DispatchState::Accepted);
    assert_eq!(store.dispatch(request()), outcome);
    assert_eq!(store.snapshot.runs.len(), original_count + 1);
    let id = outcome.run_id.unwrap();
    let started = store.simulated_runs[&id].started;
    store.refresh_at(started + Duration::from_secs(1));
    assert_eq!(store.snapshot.runs[0].status, RunStatus::InProgress);
    store.refresh_at(started + Duration::from_secs(2));
    assert_eq!(store.snapshot.runs[0].status, RunStatus::Completed);
    assert_eq!(store.snapshot.runs[0].conclusion, Some(Conclusion::Success));
    assert_eq!(store.dispatch(request()), outcome);
    assert_eq!(store.snapshot.runs.len(), original_count + 1);
    let mut altered = request();
    altered.git_ref = "develop".into();
    assert_eq!(store.dispatch(altered).state, DispatchState::Rejected);
}

#[test]
fn checks_unknown_inputs_refs_types_rights_and_selected_repositories() {
    let mut invalid = vec![];
    let mut value = request();
    value
        .inputs
        .insert("surprise".into(), InputValue::Boolean(true));
    invalid.push(value);
    let mut value = request();
    value
        .inputs
        .insert("dry_run".into(), InputValue::String("true".into()));
    invalid.push(value);
    let mut value = request();
    value.git_ref = "unknown".into();
    invalid.push(value);
    let mut value = request();
    value.workflow_id = 102;
    invalid.push(value);
    let mut value = request();
    value.repo_id = "demo-personal-site".into();
    value.workflow_id = 301;
    invalid.push(value);
    let mut value = request();
    value.account_id = "demo-work".into();
    value.repo_id = "demo-extra".into();
    value.workflow_id = 401;
    invalid.push(value);
    let mut value = request();
    value.account_id = "demo-work".into();
    invalid.push(value);
    for request in invalid {
        let mut store = DemoStore::new();
        let count = store.snapshot.runs.len();
        assert_eq!(store.dispatch(request).state, DispatchState::Rejected);
        assert_eq!(store.snapshot.runs.len(), count);
    }
}

#[test]
fn offline_and_forbidden_keep_cache_but_never_create_a_run() {
    for scenario in ["offline", "forbidden"] {
        let mut store = DemoStore::new();
        let runs = store.snapshot.runs.clone();
        store.set_scenario(scenario.into()).unwrap();
        assert!(store.refresh().stale);
        assert_eq!(store.dispatch(request()).state, DispatchState::Rejected);
        assert_eq!(store.snapshot.runs, runs);
    }
}

#[test]
fn uncertain_blocks_new_ids_for_same_target_until_reset_and_is_account_isolated() {
    let mut store = DemoStore::new();
    let count = store.snapshot.runs.len();
    store.set_scenario("uncertain".into()).unwrap();
    let first = store.dispatch(request());
    assert_eq!(first.state, DispatchState::Uncertain);
    store.set_scenario("normal".into()).unwrap();
    let mut second = request();
    second.request_id = "new-id".into();
    assert_eq!(store.dispatch(second).state, DispatchState::Uncertain);
    assert_eq!(store.snapshot.runs.len(), count);
    let mut work = request();
    work.account_id = "demo-work".into();
    work.repo_id = "demo-team-tools".into();
    work.workflow_id = 201;
    assert_eq!(store.dispatch(work).state, DispatchState::Accepted);
    store.reset();
    assert_eq!(store.dispatch(request()).state, DispatchState::Accepted);
}

#[test]
fn uncertain_start_is_listed_and_released_only_by_an_exact_explicit_call() {
    let mut store = DemoStore::new();
    store.set_scenario("uncertain".into()).unwrap();
    assert_eq!(store.dispatch(request()).state, DispatchState::Uncertain);
    store.set_scenario("normal".into()).unwrap();
    store.refresh();
    let starts = store.snapshot().uncertain_starts;
    assert_eq!(starts.len(), 1);
    assert_eq!(starts[0].target(), DispatchTarget::from(&request()));
    assert!(starts[0].claimed_at.is_some());
    let mut outdated = starts[0].clone();
    outdated.claimed_at = Some("2000-01-01T00:00:00Z".into());
    assert!(store.release_uncertain_start(outdated).is_err());
    assert_eq!(store.snapshot().uncertain_starts, starts);
    let released = store.release_uncertain_start(starts[0].clone()).unwrap();
    assert!(released.uncertain_starts.is_empty());
    // The uncertain request ID keeps its outcome; only a new ID may start again.
    assert_eq!(store.dispatch(request()).state, DispatchState::Uncertain);
    let mut fresh = request();
    fresh.request_id = "after-release".into();
    assert_eq!(store.dispatch(fresh).state, DispatchState::Accepted);
    assert!(store.release_uncertain_start(starts[0].clone()).is_ok());
}

#[test]
fn overlong_request_ids_are_rejected_without_being_recorded() {
    let mut store = DemoStore::new();
    let mut long = request();
    long.request_id = "x".repeat(MAX_REQUEST_ID_CHARS + 1);
    assert_eq!(store.dispatch(long).state, DispatchState::Rejected);
    assert!(store.requests.is_empty());
    let mut pin = store.snapshot.pins[0].clone();
    pin.label = "x".repeat(MAX_PIN_LABEL_CHARS + 1);
    assert!(store.save_pin(pin).is_err());
    let mut pin = store.snapshot.pins[0].clone();
    pin.git_ref = "main..evil".into();
    assert_eq!(
        store.save_pin(pin).unwrap_err(),
        "Branch oder Tag des Favoriten ist ungültig."
    );
}

#[test]
fn pin_defaults_are_validated_and_account_cannot_be_changed() {
    let mut store = DemoStore::new();
    let mut pin = store.snapshot.pins[0].clone();
    pin.inputs.clear();
    store.save_pin(pin.clone()).unwrap();
    assert_eq!(store.snapshot.pins[0].inputs.len(), 3);
    pin.inputs
        .insert("password".into(), InputValue::String("x".into()));
    assert!(store.save_pin(pin).is_err());
    let mut pin = store.snapshot.pins[0].clone();
    pin.account_id = "demo-work".into();
    pin.repo_id = "demo-team-tools".into();
    pin.workflow_id = 201;
    pin.inputs.clear();
    assert!(store.save_pin(pin).is_err());
}
