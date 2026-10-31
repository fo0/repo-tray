//! Seed history once; discover open runs and follow them only until completion.
use crate::{
    github::{ApiClient, ApiRequest, Transport},
    live::{parse_run, url},
    models::{Repo, Run, RunStatus},
};
use serde_json::Value;
use std::collections::BTreeMap;

pub(crate) const COMPLETED_LIMIT: usize = 50;

pub(crate) fn refresh_repo_runs<T: Transport>(
    client: &ApiClient<T>,
    repo: &Repo,
    previous: &[Run],
    since: Option<u64>,
    now: u64,
) -> Result<Vec<Run>, String> {
    let path = ["repos", &repo.owner, &repo.name, "actions", "runs"];
    let mut fresh = BTreeMap::new();
    // Separate active traversals keep long-running jobs outside the recent page visible.
    for status in ["queued", "in_progress", "waiting", "pending", "requested"] {
        for body in client
            .get_pages(
                &repo.account_id,
                url(&path, &[("per_page", "100"), ("status", status)])?,
                now,
            )
            .map_err(|e| e.to_string())?
        {
            for run in parse_list(&repo.id, &body)? {
                fresh.entry(run.id).or_insert(run);
            }
        }
    }
    if let Some(since) = since {
        // Discover runs created between polls, including short runs that already finished.
        // This does not revisit older completed history or use it as a status-poll target.
        let timestamp = chrono::DateTime::from_timestamp(since.saturating_sub(2) as i64, 0)
            .ok_or("Run-Zeitfenster ungültig.")?
            .to_rfc3339();
        let created = format!(">={timestamp}");
        for body in client
            .get_pages_uncached(
                &repo.account_id,
                url(&path, &[("per_page", "100"), ("created", &created)])?,
                now,
            )
            .map_err(|e| e.to_string())?
        {
            for run in parse_list(&repo.id, &body)? {
                fresh.entry(run.id).or_insert(run);
            }
        }
    } else {
        let response = client
            .execute(
                &ApiRequest::get(&repo.account_id, url(&path, &[("per_page", "50")])?)
                    .map_err(|e| e.to_string())?,
                now,
            )
            .map_err(|e| e.to_string())?;
        if response.status != 200 {
            return Err(format!("GitHub returned HTTP {}.", response.status));
        }
        for run in parse_list(&repo.id, &response.body)? {
            fresh.entry(run.id).or_insert(run);
        }
    }
    let mut history: BTreeMap<_, _> = previous
        .iter()
        .filter(|run| run.repo_id == repo.id)
        .map(|run| (run.id, run.clone()))
        .collect();
    // A run disappearing from active lists may have completed. Resolve its exact ID;
    // never drop it or guess an outcome from its absence.
    for run in history.values() {
        if run.status == RunStatus::Completed || fresh.contains_key(&run.id) {
            continue;
        }
        let id = run.id.to_string();
        let response = client
            .execute(
                &ApiRequest::get(
                    &repo.account_id,
                    url(
                        &["repos", &repo.owner, &repo.name, "actions", "runs", &id],
                        &[],
                    )?,
                )
                .map_err(|e| e.to_string())?,
                now,
            )
            .map_err(|e| e.to_string())?;
        if response.status != 200 {
            return Err(format!("GitHub returned HTTP {}.", response.status));
        }
        let value: Value =
            serde_json::from_slice(&response.body).map_err(|_| "Run-Antwort ungültig.")?;
        let updated = parse_run(&repo.id, &value)?;
        if updated.id != run.id || updated.workflow_id != run.workflow_id {
            return Err("Run-Antwort passt nicht zur Anfrage.".into());
        }
        fresh.insert(updated.id, updated);
    }
    for (id, run) in fresh {
        // Completed cache entries are immutable. A rerun discovered as active is new work.
        if history
            .get(&id)
            .is_some_and(|old| old.status == RunStatus::Completed)
            && run.status == RunStatus::Completed
        {
            continue;
        }
        history.insert(id, run);
    }
    let mut runs: Vec<_> = history.into_values().collect();
    runs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let mut completed = 0;
    runs.retain(|run| {
        if run.status != RunStatus::Completed {
            true
        } else {
            completed += 1;
            completed <= COMPLETED_LIMIT
        }
    });
    Ok(runs)
}

fn parse_list(repo_id: &str, body: &[u8]) -> Result<Vec<Run>, String> {
    let page: Value = serde_json::from_slice(body).map_err(|_| "Run-Liste ungültig.")?;
    page["workflow_runs"]
        .as_array()
        .ok_or_else(|| "Run-Liste ungültig.".to_string())?
        .iter()
        .map(|value| parse_run(repo_id, value))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::{ApiRequest, ApiResponse, TransportError};
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct Remote {
        calls: Vec<String>,
        active: Vec<Value>,
        recent: Vec<Value>,
        created: Vec<Value>,
        resolved: BTreeMap<u64, Value>,
        fail_resolution: bool,
    }
    struct Mock(Arc<Mutex<Remote>>);
    impl Transport for Mock {
        fn send(&mut self, request: &ApiRequest) -> Result<ApiResponse, TransportError> {
            assert_eq!(request.account_id(), "fixture-account");
            let mut remote = self.0.lock().unwrap();
            let uri = reqwest::Url::parse(request.url().as_str()).unwrap();
            remote.calls.push(uri.to_string());
            let query: BTreeMap<_, _> = uri.query_pairs().into_owned().collect();
            let body = if let Some(status) = query.get("status") {
                serde_json::json!({"workflow_runs":remote.active.iter().filter(|run| run["status"] == *status).collect::<Vec<_>>()})
            } else if query.contains_key("created") {
                serde_json::json!({"workflow_runs": remote.created})
            } else if uri.path().ends_with("/runs") {
                serde_json::json!({"workflow_runs": remote.recent})
            } else {
                if remote.fail_resolution {
                    return Err(TransportError::BeforeSend);
                }
                let id = uri
                    .path_segments()
                    .unwrap()
                    .next_back()
                    .unwrap()
                    .parse::<u64>()
                    .unwrap();
                remote
                    .resolved
                    .get(&id)
                    .expect("unexpected terminal run poll")
                    .clone()
            };
            Ok(ApiResponse {
                status: 200,
                headers: BTreeMap::new(),
                body: serde_json::to_vec(&body).unwrap(),
            })
        }
    }
    fn repo() -> Repo {
        Repo {
            id: "fixture-repo".into(),
            account_id: "fixture-account".into(),
            owner: "fixture-owner".into(),
            name: "fixture-name".into(),
            default_branch: "main".into(),
            selected: true,
            permission: crate::models::Permission::Write,
        }
    }
    fn run(id: u64, status: &str) -> Value {
        serde_json::json!({"id":id,"workflow_id":101,"name":"Fixture action","head_branch":"main","status":status,"conclusion":if status == "completed" {Some("success")}else{None},"created_at":"2026-10-31T10:00:00Z","updated_at":"2026-10-31T10:01:00Z","html_url":format!("https://github.com/fixture-owner/fixture-name/actions/runs/{id}")})
    }
    #[test]
    fn follows_open_run_to_completion_once_and_never_polls_completed_ids() {
        let remote = Arc::new(Mutex::new(Remote {
            active: vec![run(2, "in_progress")],
            recent: vec![run(1, "completed"), run(2, "in_progress")],
            ..Remote::default()
        }));
        let client = ApiClient::new(Mock(remote.clone()));
        let initial = refresh_repo_runs(&client, &repo(), &[], None, 100).unwrap();
        assert_eq!(initial.len(), 2);
        let frozen = initial.iter().find(|r| r.id == 1).unwrap().clone();
        {
            let mut remote = remote.lock().unwrap();
            remote.calls.clear();
            remote.active.clear();
            let mut finished = run(2, "completed");
            finished["conclusion"] = serde_json::json!("failure");
            remote.resolved.insert(2, finished);
        }
        let finished = refresh_repo_runs(&client, &repo(), &initial, Some(100), 115).unwrap();
        assert!(finished.iter().all(|r| r.status == RunStatus::Completed));
        assert_eq!(finished.iter().find(|r| r.id == 1).unwrap(), &frozen);
        let calls = remote.lock().unwrap().calls.clone();
        assert!(calls.iter().any(|uri| uri.ends_with("/runs/2")));
        assert!(calls.iter().all(|uri| !uri.ends_with("/runs/1")));
        assert!(calls
            .iter()
            .filter(|uri| uri.contains('?'))
            .all(|uri| uri.contains("status=") || uri.contains("created=")));
        remote.lock().unwrap().calls.clear();
        assert_eq!(
            refresh_repo_runs(&client, &repo(), &finished, Some(115), 130).unwrap(),
            finished
        );
        assert!(remote
            .lock()
            .unwrap()
            .calls
            .iter()
            .all(|uri| !uri.ends_with("/runs/2") && !uri.ends_with("/runs/1")));
    }
    #[test]
    fn discovers_short_new_runs_and_keeps_terminal_metadata_frozen_even_during_reseed() {
        let old = parse_run(&repo().id, &run(1, "completed")).unwrap();
        let mut changed = run(1, "completed");
        changed["updated_at"] = serde_json::json!("2026-10-31T12:00:00Z");
        let remote = Arc::new(Mutex::new(Remote {
            recent: vec![changed],
            created: vec![run(3, "completed")],
            ..Remote::default()
        }));
        let client = ApiClient::new(Mock(remote));
        let seeded =
            refresh_repo_runs(&client, &repo(), std::slice::from_ref(&old), None, 100).unwrap();
        assert_eq!(seeded, vec![old.clone()]);
        let next = refresh_repo_runs(&client, &repo(), &seeded, Some(100), 115).unwrap();
        assert_eq!(next.len(), 2);
        assert_eq!(next.iter().find(|r| r.id == 1).unwrap(), &old);
        assert!(next
            .iter()
            .any(|r| r.id == 3 && r.status == RunStatus::Completed));
    }
    #[test]
    fn missing_open_run_is_not_guessed_completed_on_network_failure() {
        let open = parse_run(&repo().id, &run(2, "in_progress")).unwrap();
        let remote = Arc::new(Mutex::new(Remote {
            fail_resolution: true,
            ..Remote::default()
        }));
        let client = ApiClient::new(Mock(remote));
        assert!(refresh_repo_runs(
            &client,
            &repo(),
            std::slice::from_ref(&open),
            Some(100),
            115
        )
        .is_err());
        assert_eq!(open.status, RunStatus::InProgress);
    }
    #[test]
    fn bounds_completed_cache_without_losing_old_active_runs_or_mixing_repositories() {
        let mut previous: Vec<_> = (1..=70)
            .map(|id| parse_run(&repo().id, &run(id, "completed")).unwrap())
            .collect();
        let active = parse_run(&repo().id, &run(80, "waiting")).unwrap();
        previous.push(active.clone());
        previous.push(parse_run("another-account-repo", &run(90, "completed")).unwrap());
        let remote = Arc::new(Mutex::new(Remote {
            active: vec![run(80, "waiting")],
            ..Remote::default()
        }));
        let client = ApiClient::new(Mock(remote));
        let history = refresh_repo_runs(&client, &repo(), &previous, Some(100), 115).unwrap();
        assert_eq!(history.len(), COMPLETED_LIMIT + 1);
        assert!(history.contains(&active));
        assert!(history.iter().all(|r| r.repo_id == repo().id));
    }
}
