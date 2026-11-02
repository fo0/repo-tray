use super::harness::*;
use crate::live::last_run::MAX_RUN_LOOKUPS;
use crate::live::schedule::CATALOG_SECONDS;
use crate::live::*;

fn workflow(id: u64, file: &str) -> Value {
    serde_json::json!({
        "id": id, "name": format!("Fixture {file}"),
        "path": format!(".github/workflows/{file}.yml"), "state": "active",
    })
}
fn workflow_run(id: u64, workflow_id: u64, created_at: &str) -> Value {
    let mut value = run(1, id, "completed");
    value["workflow_id"] = workflow_id.into();
    value["created_at"] = created_at.into();
    value
}
fn last_run(snapshot: &Snapshot, id: u64) -> Option<&str> {
    snapshot
        .workflows
        .iter()
        .find(|workflow| workflow.id == id)
        .and_then(|workflow| workflow.last_run_at.as_deref())
}
fn lookups(h: &Harness, id: u64) -> usize {
    h.remote().count(
        "github-1",
        &format!("/actions/workflows/{id}/runs?per_page=1"),
    )
}

#[test]
fn a_workflow_without_known_runs_shows_its_latest_run_and_one_with_runs_needs_none() {
    let mut remote = Remote::new();
    remote.extra_workflows.push(workflow(12, "release"));
    remote.runs.insert(1, vec![run(1, 10, "completed")]);
    // The release ran long ago: only its own run listing still reaches it.
    remote.archived.insert(
        1,
        vec![
            workflow_run(4, 12, "2026-08-01T08:00:00Z"),
            workflow_run(5, 12, "2026-09-15T08:00:00Z"),
        ],
    );
    let mut h = Harness::new("last-run", remote, &["github-1"]);
    h.load(&["github-1:1"]);
    // The first metadata read comes before any run is known, so both are looked up, each
    // with one page although the release lists more runs.
    let first = h.live.snapshot();
    assert_eq!(last_run(&first, 12), Some("2026-09-15T08:00:00Z"));
    assert_eq!(last_run(&first, 9), Some("2026-11-01T10:00:00Z"));
    assert_eq!((lookups(&h, 9), lookups(&h, 12)), (1, 1));
    advance(CATALOG_SECONDS);
    h.remote().requests.clear();
    let snapshot = h.live.refresh();
    assert!(!snapshot.stale, "{:?}", snapshot.message);
    assert_eq!((lookups(&h, 9), lookups(&h, 12)), (0, 1));
    assert_eq!(last_run(&snapshot, 9), None, "its run is in the snapshot");
    assert_eq!(last_run(&snapshot, 12), Some("2026-09-15T08:00:00Z"));
    let panel = serde_json::to_value(&snapshot.workflows).unwrap();
    assert!(panel[0]["lastRunAt"].is_null());
    assert_eq!(panel[1]["lastRunAt"], "2026-09-15T08:00:00Z");
    // The cache keeps it across a restart.
    let restarted = h.restart().snapshot();
    assert_eq!(last_run(&restarted, 12), Some("2026-09-15T08:00:00Z"));
}

#[test]
fn a_failed_lookup_never_fails_the_metadata_and_stops_the_lookups_of_that_pass() {
    let mut remote = Remote::new();
    remote.extra_workflows.push(workflow(12, "release"));
    remote.extra_workflows.push(workflow(13, "deploy"));
    remote
        .archived
        .insert(1, vec![workflow_run(5, 13, "2026-09-15T08:00:00Z")]);
    remote.workflow_runs_status.insert(9, 502);
    let mut h = Harness::new("last-run-failed", remote, &["github-1"]);
    h.load(&["github-1:1"]);
    let snapshot = h.live.snapshot();
    assert!(!snapshot.stale, "{:?}", snapshot.message);
    assert_eq!(snapshot.workflows.len(), 3);
    assert!(snapshot.workflows.iter().all(|w| w.last_run_at.is_none()));
    assert_eq!(
        (lookups(&h, 9), lookups(&h, 12), lookups(&h, 13)),
        (1, 0, 0)
    );
    // Once the lookups work, 13 gets its value; a later failure keeps the last known one.
    h.remote().workflow_runs_status.clear();
    advance(CATALOG_SECONDS);
    let snapshot = h.live.refresh();
    assert_eq!(last_run(&snapshot, 13), Some("2026-09-15T08:00:00Z"));
    h.remote().workflow_runs_status.insert(13, 404);
    advance(CATALOG_SECONDS);
    let snapshot = h.live.refresh();
    assert!(!snapshot.stale, "{:?}", snapshot.message);
    assert_eq!(last_run(&snapshot, 13), Some("2026-09-15T08:00:00Z"));
}

#[test]
fn lookups_are_capped_per_repository_and_the_rest_keep_their_last_value() {
    let mut remote = Remote::new();
    let extra: Vec<u64> = (100..112).collect();
    for id in &extra {
        remote
            .extra_workflows
            .push(workflow(*id, &format!("job-{id}")));
    }
    let mut h = Harness::new("last-run-cap", remote, &["github-1"]);
    h.load(&["github-1:1"]);
    let total = |h: &Harness| {
        h.remote()
            .requests
            .iter()
            .filter(|(_, _, target)| target.ends_with("/runs?per_page=1"))
            .count()
    };
    assert_eq!(total(&h), MAX_RUN_LOOKUPS);
    // Workflow 9 and the first nine extras are looked up; the last three are past the cap.
    let past: Vec<u64> = extra[MAX_RUN_LOOKUPS - 1..].to_vec();
    assert_eq!(past, [109, 110, 111]);
    for workflow in &mut h.live.data.workflows {
        workflow.last_run_at = Some("2026-01-01T00:00:00Z".into());
    }
    advance(CATALOG_SECONDS);
    h.remote().requests.clear();
    let snapshot = h.live.refresh();
    assert_eq!(total(&h), MAX_RUN_LOOKUPS);
    for id in [9, 100, 108] {
        assert_eq!(last_run(&snapshot, id), None, "{id} was looked up");
    }
    for id in past {
        assert_eq!(lookups(&h, id), 0);
        assert_eq!(last_run(&snapshot, id), Some("2026-01-01T00:00:00Z"));
    }
}

#[test]
fn a_cached_workflow_from_before_last_run_times_still_loads() {
    let cached = serde_json::json!({
        "id": 9, "repoId": "github-1:1", "name": "Fixture build",
        "path": ".github/workflows/build.yml", "dispatch": true, "inputs": [], "refs": ["main"]
    });
    let workflow: Workflow = serde_json::from_value(cached).unwrap();
    assert_eq!(workflow.last_run_at, None);
    // The panel contract carries the field as `lastRunAt: null`.
    assert!(serde_json::to_value(&workflow).unwrap()["lastRunAt"].is_null());
}
