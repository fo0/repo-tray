use super::harness::*;
use crate::github::{Method, TransportError};
use crate::live::*;

const REPO: &str = "github-1:1";

/// One selected repository with an open run (30) and a completed one (31); the requests of
/// the initial load are cleared.
fn with_open_run(name: &str) -> Harness {
    let mut remote = Remote::new();
    remote
        .runs
        .insert(1, vec![run(1, 30, "in_progress"), run(1, 31, "completed")]);
    let mut h = Harness::new(name, remote, &["github-1"]);
    h.load(&[REPO]);
    assert!(h.live.poll_at.contains_key(REPO));
    h.remote().requests.clear();
    h
}

#[test]
fn an_accepted_cancel_posts_once_and_the_next_refresh_polls_the_real_outcome() {
    let mut h = with_open_run("cancel-accepted");
    h.remote()
        .cancels
        .push_back(json(202, serde_json::json!({})));
    let before = h.live.snapshot().runs;
    let snapshot = h.live.cancel_run(REPO.into(), 30).unwrap();
    assert_eq!(snapshot.runs, before, "no status is faked locally");
    assert_eq!(
        h.remote().requests,
        vec![(
            "github-1".to_string(),
            Method::Post,
            "/repos/fixture-owner/fixture-1/actions/runs/30/cancel".to_string()
        )]
    );
    assert!(!h.live.poll_at.contains_key(REPO), "polls at once");
    // GitHub finished cancelling; the refresh at the same moment polls and shows it.
    let mut cancelled = run(1, 30, "completed");
    cancelled["conclusion"] = "cancelled".into();
    h.remote()
        .runs
        .insert(1, vec![cancelled, run(1, 31, "completed")]);
    h.remote().requests.clear();
    let snapshot = h.live.refresh();
    assert!(h.remote().count("github-1", "/actions/runs") > 0);
    let run = snapshot.runs.iter().find(|run| run.id == 30).unwrap();
    assert_eq!(run.status, RunStatus::Completed);
    assert_eq!(run.conclusion, Some(Conclusion::Cancelled));
    assert_eq!(h.remote().posts(), 0, "never sent again");
}

#[test]
fn a_refused_cancel_is_named_in_german_and_never_resent() {
    for (status, expected) in [
        (
            409,
            "Run lässt sich nicht mehr abbrechen – er ist bereits beendet.",
        ),
        (
            403,
            "Abbrechen nicht erlaubt – der Zugang braucht „Actions: Lesen und Schreiben“.",
        ),
        (
            404,
            "Abbrechen nicht erlaubt – der Zugang braucht „Actions: Lesen und Schreiben“.",
        ),
        (
            401,
            "Zugang von fixture-github-1 abgelaufen oder widerrufen – verbinde das Konto neu.",
        ),
        (500, "GitHub-Fehler 500 beim Abbrechen."),
    ] {
        let mut h = with_open_run(&format!("cancel-{status}"));
        h.remote()
            .cancels
            .push_back(json(status, serde_json::json!({"message": "Fixture"})));
        let before = h.live.snapshot().runs;
        assert_eq!(h.live.cancel_run(REPO.into(), 30).unwrap_err(), expected);
        assert_eq!(h.remote().posts(), 1, "{status}");
        assert_eq!(h.live.snapshot().runs, before, "{status}");
        // Only a run GitHub already finished makes the next refresh poll at once.
        assert_eq!(h.live.poll_at.contains_key(REPO), status != 409, "{status}");
    }
}

#[test]
fn a_throttled_or_unanswered_cancel_says_so() {
    let mut h = with_open_run("cancel-throttled");
    let mut limited = json(
        403,
        serde_json::json!({"message": "API rate limit exceeded"}),
    )
    .unwrap();
    limited
        .headers
        .insert("x-ratelimit-remaining".into(), "0".into());
    limited
        .headers
        .insert("x-ratelimit-reset".into(), (START + 600).to_string());
    h.remote().cancels.push_back(Ok(limited));
    let error = h.live.cancel_run(REPO.into(), 30).unwrap_err();
    assert!(
        error.starts_with("GitHub-Limit erreicht – neuer Versuch um "),
        "{error}"
    );
    // During the backoff nothing is sent.
    let again = h.live.cancel_run(REPO.into(), 30).unwrap_err();
    assert!(again.starts_with("GitHub-Limit erreicht"), "{again}");
    assert_eq!(h.remote().posts(), 1);

    let mut h = with_open_run("cancel-429");
    h.remote()
        .cancels
        .push_back(json(429, serde_json::json!({})));
    let error = h.live.cancel_run(REPO.into(), 30).unwrap_err();
    assert!(error.starts_with("GitHub-Limit erreicht"), "{error}");

    let mut h = with_open_run("cancel-timeout");
    h.remote()
        .cancels
        .push_back(Err(TransportError::OutcomeUnknown));
    assert_eq!(
        h.live.cancel_run(REPO.into(), 30).unwrap_err(),
        "Abbruch nicht bestätigt – prüfe den Run auf GitHub."
    );
    assert_eq!(h.remote().posts(), 1);

    // Nothing left the machine: no reason to check GitHub, the connection is the problem.
    let mut h = with_open_run("cancel-offline");
    h.remote()
        .cancels
        .push_back(Err(TransportError::BeforeSend));
    assert_eq!(
        h.live.cancel_run(REPO.into(), 30).unwrap_err(),
        "GitHub nicht erreichbar – prüfe deine Verbindung."
    );
}

#[test]
fn a_cancel_that_cannot_apply_is_refused_before_any_request() {
    let mut h = with_open_run("cancel-refused");
    for (repo, run, expected) in [
        (REPO, 31, "Run ist bereits beendet."),
        (REPO, 99, "Run nicht gefunden."),
        ("github-1:2", 30, "Run nicht gefunden."),
    ] {
        assert_eq!(h.live.cancel_run(repo.into(), run).unwrap_err(), expected);
    }
    h.live.data.repos[0].permission = Permission::Read;
    assert_eq!(
        h.live.cancel_run(REPO.into(), 30).unwrap_err(),
        "Für dieses Repository fehlt der Schreibzugriff."
    );
    h.live.data.repos[0].permission = Permission::Write;
    h.live.data.repos[0].selected = false;
    assert_eq!(
        h.live.cancel_run(REPO.into(), 30).unwrap_err(),
        "Repository nicht im Tray."
    );
    assert!(h.remote().requests.is_empty());
}

#[test]
fn a_run_github_never_queued_is_named_stuck_not_finished() {
    let mut h = with_open_run("cancel-never-queued");
    h.remote().cancels.push_back(json(
        409,
        serde_json::json!({"message": "Cannot cancel a workflow run that has not been queued yet."}),
    ));
    assert_eq!(
        h.live.cancel_run(REPO.into(), 30).unwrap_err(),
        "GitHub nimmt den Abbruch nicht an – der Run hängt auf GitHub. Lösche ihn dort."
    );
    assert_eq!(h.remote().posts(), 1);

    // A run already classified as stuck is refused before any request.
    let mut h = with_open_run("cancel-stuck");
    let run = h
        .live
        .data
        .runs
        .iter_mut()
        .find(|run| run.id == 30)
        .unwrap();
    run.status = RunStatus::Stuck;
    assert_eq!(
        h.live.cancel_run(REPO.into(), 30).unwrap_err(),
        "GitHub nimmt den Abbruch nicht an – der Run hängt auf GitHub. Lösche ihn dort."
    );
    assert!(h.remote().requests.is_empty());
}
