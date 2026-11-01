use crate::auth::{AuthError, SecretToken};
use crate::browser_auth;
use crate::github::{ApiRequest, ApiResponse, Method, TransportError};
use crate::live::schedule::{CATALOG_SECONDS, RETRY_SECONDS};
use crate::live::*;
use crate::run_history::{Cause, ScopeError};
use std::cell::Cell;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

const START: u64 = 1_800_000_000;
thread_local! {
    static NOW: Cell<u64> = const { Cell::new(START) };
}
fn clock() -> u64 {
    NOW.with(Cell::get)
}
fn advance(seconds: u64) {
    NOW.with(|now| now.set(now.get() + seconds));
}

fn json(status: u16, body: Value) -> Result<ApiResponse, TransportError> {
    Ok(ApiResponse {
        status,
        headers: BTreeMap::new(),
        body: serde_json::to_vec(&body).unwrap(),
    })
}
fn names(values: &[String]) -> Value {
    values
        .iter()
        .map(|name| serde_json::json!({ "name": name }))
        .collect()
}
fn run(repo: u64, id: u64, status: &str) -> Value {
    serde_json::json!({
        "id": id, "workflow_id": 9, "name": "Fixture build", "head_branch": "main",
        "status": status,
        "conclusion": if status == "completed" { Some("success") } else { None },
        "created_at": "2026-11-01T10:00:00Z", "updated_at": "2026-11-01T10:01:00Z",
        "html_url": format!("https://github.com/fixture-owner/fixture-{repo}/actions/runs/{id}"),
    })
}
fn confirmation(repo: u64, id: u64) -> Result<ApiResponse, TransportError> {
    json(
        200,
        serde_json::json!({
            "workflow_run_id": id,
            "run_url": format!("https://api.github.com/repos/fixture-owner/fixture-{repo}/actions/runs/{id}"),
            "html_url": format!("https://github.com/fixture-owner/fixture-{repo}/actions/runs/{id}"),
        }),
    )
}

/// Synthetic GitHub: accounts list `fixture-owner/fixture-<n>` repositories, each with
/// one startable workflow (ID 9) on every known branch and tag.
#[derive(Default)]
struct Remote {
    repos: BTreeMap<String, Vec<u64>>,
    /// Status every request of an account is answered with (401: revoked).
    account_status: BTreeMap<String, u16>,
    /// Status the Actions run endpoints of a repository answer with.
    runs_status: BTreeMap<u64, u16>,
    runs: BTreeMap<u64, Vec<Value>>,
    branches: Vec<String>,
    tags: Vec<String>,
    /// Branch listings paginate without end, so the ref picker cuts them off.
    endless_branches: bool,
    dispatches: VecDeque<Result<ApiResponse, TransportError>>,
    /// Every request as `(account, method, path?query)`.
    requests: Vec<(String, Method, String)>,
    /// Claim rows in the cache file at the moment each dispatch POST left.
    claims_at_post: Vec<i64>,
    db: PathBuf,
}
impl Remote {
    fn new() -> Self {
        Self {
            repos: BTreeMap::from([("github-1".into(), vec![1])]),
            branches: vec!["main".into(), "feature".into()],
            tags: vec!["v1".into()],
            ..Self::default()
        }
    }
    fn posts(&self) -> usize {
        self.requests
            .iter()
            .filter(|(_, method, _)| *method == Method::Post)
            .count()
    }
    fn count(&self, account: &str, fragment: &str) -> usize {
        self.requests
            .iter()
            .filter(|(owner, _, target)| owner == account && target.contains(fragment))
            .count()
    }
    fn repository(
        &mut self,
        method: Method,
        repo: u64,
        rest: &[&str],
        query: &BTreeMap<String, String>,
    ) -> Result<ApiResponse, TransportError> {
        match rest {
            ["branches"] if self.endless_branches => {
                let page: u32 = query.get("page").and_then(|p| p.parse().ok()).unwrap_or(1);
                let listed: Vec<_> = (0..100).map(|i| format!("branch-{page}-{i}")).collect();
                let next = format!("<https://api.github.com/repos/fixture-owner/fixture-{repo}/branches?per_page=100&page={}>; rel=\"next\"", page + 1);
                Ok(ApiResponse {
                    status: 200,
                    headers: BTreeMap::from([("Link".to_string(), next)]),
                    body: serde_json::to_vec(&names(&listed)).unwrap(),
                })
            }
            ["branches"] => json(200, names(&self.branches)),
            ["tags"] => json(200, names(&self.tags)),
            ["actions", "workflows"] => json(
                200,
                serde_json::json!({"workflows": [{"id": 9, "name": "Fixture build", "path": ".github/workflows/build.yml", "state": "active"}]}),
            ),
            ["contents", ".github", "workflows", "build.yml"] => {
                let git_ref = query.get("ref").cloned().unwrap_or_default();
                if self.branches.contains(&git_ref) || self.tags.contains(&git_ref) {
                    let content =
                        base64::engine::general_purpose::STANDARD.encode("on: workflow_dispatch\n");
                    json(
                        200,
                        serde_json::json!({"encoding": "base64", "content": content}),
                    )
                } else {
                    json(404, serde_json::json!({"message": "No commit found"}))
                }
            }
            ["actions", "workflows", "9", "dispatches"] => {
                assert_eq!(method, Method::Post);
                let claims = rusqlite::Connection::open(&self.db)
                    .unwrap()
                    .query_row("SELECT COUNT(*) FROM dispatch_claims", [], |row| row.get(0))
                    .unwrap();
                self.claims_at_post.push(claims);
                self.dispatches
                    .pop_front()
                    .expect("unexpected dispatch POST")
            }
            ["actions", "runs", ..] if self.runs_status.contains_key(&repo) => {
                json(self.runs_status[&repo], serde_json::json!({}))
            }
            ["actions", "runs"] => {
                let listed = self.runs.get(&repo).cloned().unwrap_or_default();
                let listed: Vec<_> = match query.get("status") {
                    Some(status) => listed
                        .into_iter()
                        .filter(|run| run["status"] == *status)
                        .collect(),
                    None => listed,
                };
                json(200, serde_json::json!({ "workflow_runs": listed }))
            }
            ["actions", "runs", id] => {
                let id: u64 = id.parse().unwrap();
                let found = self
                    .runs
                    .get(&repo)
                    .and_then(|runs| runs.iter().find(|run| run["id"] == id));
                match found {
                    Some(run) => json(200, run.clone()),
                    None => json(404, serde_json::json!({"message": "Not Found"})),
                }
            }
            other => panic!("unexpected repository request {other:?}"),
        }
    }
}

struct Fake(Arc<Mutex<Remote>>);
impl Transport for Fake {
    fn send(&mut self, request: &ApiRequest) -> Result<ApiResponse, TransportError> {
        let mut remote = self.0.lock().unwrap();
        let uri = reqwest::Url::parse(request.url().as_str()).unwrap();
        let account = request.account_id().to_owned();
        let target = match uri.query() {
            Some(query) => format!("{}?{query}", uri.path()),
            None => uri.path().to_owned(),
        };
        remote
            .requests
            .push((account.clone(), request.method(), target));
        if let Some(status) = remote.account_status.get(&account) {
            return json(*status, serde_json::json!({}));
        }
        let query: BTreeMap<String, String> = uri.query_pairs().into_owned().collect();
        let segments: Vec<&str> = uri.path_segments().unwrap().collect();
        match segments.as_slice() {
            ["user", "repos"] => {
                let listed: Vec<_> = remote
                    .repos
                    .get(&account)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|n| serde_json::json!({"id": n, "name": format!("fixture-{n}"), "owner": {"login": "fixture-owner"}, "default_branch": "main", "permissions": {"push": true}}))
                    .collect();
                json(200, Value::Array(listed))
            }
            ["repos", "fixture-owner", name, rest @ ..] => {
                let repo = name.trim_start_matches("fixture-").parse().unwrap();
                remote.repository(request.method(), repo, rest, &query)
            }
            other => panic!("unexpected request {other:?}"),
        }
    }
}

/// Synthetic vault that only records which accounts hold a credential.
#[derive(Default)]
struct Vault(Mutex<BTreeSet<String>>);
impl NativeKeyring for Vault {
    fn read_token(&self, _: &str) -> Result<Option<SecretToken>, AuthError> {
        Ok(None)
    }
    fn write_token(&self, account: &str, _: &SecretToken) -> Result<(), AuthError> {
        self.0.lock().unwrap().insert(account.into());
        Ok(())
    }
    fn delete_token(&self, account: &str) -> Result<(), AuthError> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

fn account(id: &str) -> Account {
    Account {
        id: id.into(),
        login: format!("fixture-{id}"),
        label: "GitHub · Token".into(),
    }
}
fn request(id: &str, git_ref: &str) -> DispatchRequest {
    DispatchRequest {
        account_id: "github-1".into(),
        repo_id: "github-1:1".into(),
        workflow_id: 9,
        git_ref: git_ref.into(),
        inputs: Inputs::new(),
        request_id: id.into(),
    }
}
fn commit(id: &'static str) -> impl FnOnce(&dyn NativeKeyring) -> Result<(), String> {
    move |keyring| {
        browser_auth::commit_credential(
            keyring,
            id,
            &SecretToken::new("synthetic-credential".into()),
            || true,
        )
    }
}
/// A synthetic disk failure for every snapshot row whose payload matches `pattern`.
fn refuse(path: &Path, pattern: &str) {
    let connection = rusqlite::Connection::open(path).unwrap();
    for event in ["INSERT", "UPDATE"] {
        connection
            .execute_batch(&format!(
                "CREATE TRIGGER refuse_{event} BEFORE {event} ON snapshots
                     WHEN NEW.payload LIKE '{pattern}'
                     BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END;"
            ))
            .unwrap();
    }
}

struct Harness {
    live: LiveStore<Fake>,
    remote: Arc<Mutex<Remote>>,
    vault: Arc<Vault>,
    path: PathBuf,
}
impl Harness {
    fn new(name: &str, remote: Remote, accounts: &[&str]) -> Self {
        NOW.with(|now| now.set(START));
        let path = std::env::temp_dir().join(format!(
            "repotray-live-{name}-{}-{}.db",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let remote = Arc::new(Mutex::new(Remote {
            db: path.clone(),
            ..remote
        }));
        let vault = Arc::new(Vault::default());
        let mut live = Self::open(&path, &remote, &vault);
        live.data.accounts = accounts.iter().map(|id| account(id)).collect();
        Self {
            live,
            remote,
            vault,
            path,
        }
    }
    /// Another engine on the same cache file, as after a restart.
    fn open(path: &Path, remote: &Arc<Mutex<Remote>>, vault: &Arc<Vault>) -> LiveStore<Fake> {
        let mut live = LiveStore::with_client(
            Cache::open(path).unwrap(),
            vault.clone(),
            ApiClient::new(Fake(remote.clone())),
        )
        .unwrap();
        live.clock = clock;
        live
    }
    fn restart(&self) -> LiveStore<Fake> {
        Self::open(&self.path, &self.remote, &self.vault)
    }
    /// Lists the catalogs, selects these repositories and reads their metadata and runs.
    fn select(&mut self, ids: &[&str]) {
        self.live.refresh();
        self.live
            .select_repos(ids.iter().map(|id| id.to_string()).collect())
            .unwrap();
    }
    fn remote(&self) -> MutexGuard<'_, Remote> {
        self.remote.lock().unwrap()
    }
}
impl Drop for Harness {
    fn drop(&mut self) {
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", self.path.display()));
        }
    }
}

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

#[test]
fn a_connected_account_survives_restart_when_its_full_snapshot_cannot_be_written() {
    let mut h = Harness::new("connect", Remote::new(), &[]);
    refuse(&h.path, "%\"name\":\"fixture-1\"%");
    let snapshot = h
        .live
        .connect_account(account("github-1"), commit("github-1"))
        .unwrap();
    assert!(snapshot.repos.iter().any(|repo| repo.id == "github-1:1"));
    assert!(snapshot
        .message
        .as_deref()
        .is_some_and(|message| message.contains(CACHE_NOTICE)));
    assert!(h.vault.0.lock().unwrap().contains("github-1"));
    assert_eq!(h.restart().snapshot().accounts, vec![account("github-1")]);
}

#[test]
fn a_connect_whose_account_row_cannot_be_written_stores_no_credential() {
    let mut h = Harness::new("connect-refused", Remote::new(), &[]);
    refuse(&h.path, "%");
    let error = h
        .live
        .connect_account(account("github-1"), commit("github-1"))
        .unwrap_err();
    assert_eq!(error, ACCOUNT_SAVE_FAILED);
    assert!(h.vault.0.lock().unwrap().is_empty());
    assert!(h.live.snapshot().accounts.is_empty());
    assert!(h.remote().requests.is_empty());
}

#[test]
fn a_failed_credential_commit_removes_only_the_new_account_row() {
    let mut h = Harness::new("connect-vault", Remote::new(), &[]);
    let error = h
        .live
        .connect_account(account("github-1"), |_| {
            Err("Betriebssystem-Tresor nicht verfügbar.".into())
        })
        .unwrap_err();
    assert_eq!(error, "Betriebssystem-Tresor nicht verfügbar.");
    assert!(h.live.cache.account_ids().unwrap().is_empty());
    assert!(h.live.snapshot().accounts.is_empty());
    assert!(h.restart().snapshot().accounts.is_empty());
}
