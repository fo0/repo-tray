//! Native authenticated GitHub access. Secrets never enter Snapshot or the metadata cache.
use crate::{
    auth::{NativeKeyring, SecretToken},
    browser_auth::{
        self, BrowserCredential, BrowserTokens, NativeOAuthTransport, OAuthEndpoint, OAuthResponse,
        OAuthTransport,
    },
    cache::{AppSettings, Cache, Release},
    github::{ApiClient, ApiRequest, ApiResponse, ApiUrl, Method, Transport, TransportError},
    models::*,
    run_history::{self, ScopeError},
    workflow::{parse_workflow_yaml, validate_inputs, validate_non_secret_inputs},
};
use base64::Engine as _;
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Read,
    sync::Arc,
    time::Duration,
};

pub struct HttpTransport {
    client: reqwest::blocking::Client,
    keyring: Arc<dyn NativeKeyring>,
    bootstrap: Option<SecretToken>,
    oauth: OAuthClient,
}
impl HttpTransport {
    pub fn new(keyring: Arc<dyn NativeKeyring>) -> Result<Self, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(25))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("RepoTray/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|_| "HTTP-Dienst konnte nicht gestartet werden.")?;
        Ok(Self {
            client,
            keyring,
            bootstrap: None,
            oauth: OAuthClient::default(),
        })
    }
}
impl Transport for HttpTransport {
    fn send(&mut self, request: &ApiRequest) -> Result<ApiResponse, TransportError> {
        let stored;
        let token = if request.account_id() == "pending" {
            self.bootstrap.as_ref()
        } else {
            let oauth = self
                .oauth
                .prepare(request.account_id())
                .map_err(|_| TransportError::BeforeSend)?;
            stored = Some(
                browser_auth::access_token(
                    self.keyring.as_ref(),
                    request.account_id(),
                    oauth,
                    now(),
                )
                .map_err(|_| TransportError::BeforeSend)?,
            );
            stored.as_ref()
        }
        .ok_or(TransportError::BeforeSend)?;
        let mut builder = self.client.request(
            match request.method() {
                Method::Get => reqwest::Method::GET,
                Method::Post => reqwest::Method::POST,
            },
            request.url().as_str(),
        );
        for (key, value) in request.headers() {
            builder = builder.header(key, value);
        }
        builder = token.with_secret(|value| builder.bearer_auth(value));
        if let Some(body) = request.body() {
            builder = builder.body(body.to_vec());
        }
        let response = builder.send().map_err(|e| {
            if e.is_connect() || e.is_builder() {
                TransportError::BeforeSend
            } else {
                TransportError::OutcomeUnknown
            }
        })?;
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.to_string(), v.to_string())))
            .collect();
        let mut body = Vec::new();
        response
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut body)
            .map_err(|_| TransportError::OutcomeUnknown)?;
        if body.len() > 2 * 1024 * 1024 {
            return Err(TransportError::OutcomeUnknown);
        }
        Ok(ApiResponse {
            status,
            headers,
            body,
        })
    }
}
/// The OAuth HTTP client (runtime thread, TLS config) exists only for browser accounts,
/// whose credentials may rotate, and is built once and reused; PAT and gh accounts never
/// build one. It is built before `access_token` runs: rotation marks the vault entry before
/// its first request, so a failed build must happen while the credential is untouched.
#[derive(Default)]
struct OAuthClient(Option<NativeOAuthTransport>);
impl OAuthClient {
    fn prepare(&mut self, account: &str) -> Result<&mut Self, String> {
        if browser_auth::is_browser_account(account) && self.0.is_none() {
            self.0 = Some(NativeOAuthTransport::new()?);
        }
        Ok(self)
    }
    fn native(&mut self) -> Result<&mut NativeOAuthTransport, String> {
        self.0
            .as_mut()
            .ok_or_else(|| "Anmeldedienst nicht verfügbar.".into())
    }
}
impl OAuthTransport for OAuthClient {
    fn post(
        &mut self,
        endpoint: OAuthEndpoint,
        form: &[(&str, &str)],
    ) -> Result<OAuthResponse, String> {
        self.native()?.post(endpoint, form)
    }
    fn identity(&mut self, token: &SecretToken) -> Result<(u64, String), String> {
        self.native()?.identity(token)
    }
}
pub fn now() -> u64 {
    chrono::Utc::now().timestamp().max(0) as u64
}
pub(crate) fn url(path: &[&str], query: &[(&str, &str)]) -> Result<ApiUrl, String> {
    let mut value =
        reqwest::Url::parse("https://api.github.com").map_err(|_| "API-Adresse ungültig.")?;
    value
        .path_segments_mut()
        .map_err(|_| "API-Adresse ungültig.")?
        .extend(path);
    if !query.is_empty() {
        value.query_pairs_mut().extend_pairs(query.iter().copied());
    }
    ApiUrl::parse(value.as_str()).map_err(|_| "API-Adresse ungültig.".into())
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .ok_or_else(|| "GitHub-Metadaten unvollständig.".into())
}
fn number(value: &Value, key: &str) -> Result<u64, String> {
    value[key]
        .as_u64()
        .filter(|v| *v > 0)
        .ok_or_else(|| "GitHub-ID ungültig.".into())
}
pub fn empty_snapshot() -> Snapshot {
    Snapshot {
        accounts: vec![],
        repos: vec![],
        workflows: vec![],
        runs: vec![],
        pins: vec![],
        mode: Mode::Live,
        connectivity: Connectivity::Online,
        updated_at: chrono::Utc::now().to_rfc3339(),
        stale: false,
        message: Some("Verbinde dein GitHub-Konto in den Einstellungen.".into()),
        uncertain_starts: vec![],
    }
}
const CACHE_NOTICE: &str = "Lokaler Zwischenspeicher konnte nicht aktualisiert werden.";

pub struct LiveStore {
    data: Snapshot,
    client: ApiClient<HttpTransport>,
    keyring: Arc<dyn NativeKeyring>,
    cache: Cache,
    catalog_at: u64,
    poll_at: BTreeMap<String, u64>,
    history_since: BTreeMap<String, u64>,
    tracked: BTreeMap<u64, crate::github::RunTracker>,
    outcomes: RecentOutcomes<String, (String, DispatchOutcome)>,
    /// Mirrors the persisted dispatch claims; kept outside `data` so no reset can hide one.
    claims: Vec<UncertainStart>,
}
impl LiveStore {
    pub fn new(cache: Cache, keyring: Arc<dyn NativeKeyring>) -> Result<Self, String> {
        let mut data = empty_snapshot();
        for account in cache
            .account_ids()
            .map_err(|_| "Konten konnten nicht geladen werden.")?
        {
            if let Some(cached) = cache
                .load_snapshot(&account)
                .map_err(|_| "Cache konnte nicht geladen werden.")?
            {
                if cached.mode != Mode::Live {
                    continue;
                }
                data.accounts.extend(cached.accounts);
                data.repos.extend(cached.repos);
                data.workflows.extend(cached.workflows);
                data.runs.extend(cached.runs);
                data.pins.extend(cached.pins);
                data.updated_at = cached.updated_at;
            }
        }
        let claims = cache
            .uncertain_starts()
            .map_err(|_| "Startsperren konnten nicht geladen werden.")?;
        if !data.accounts.is_empty() {
            data.stale = true;
            data.connectivity = Connectivity::Offline;
            data.message = Some("Letzter gespeicherter Stand · Verbindung wird geprüft.".into());
        }
        Ok(Self {
            client: ApiClient::new(HttpTransport::new(keyring.clone())?),
            data,
            keyring,
            cache,
            catalog_at: 0,
            poll_at: BTreeMap::new(),
            history_since: BTreeMap::new(),
            tracked: BTreeMap::new(),
            outcomes: RecentOutcomes::new(MAX_RECORDED_OUTCOMES),
            claims,
        })
    }
    pub fn snapshot(&self) -> Snapshot {
        let mut snapshot = self.data.clone();
        snapshot.uncertain_starts = self.claims.clone();
        snapshot
    }
    /// Explicit user action after checking the runs on GitHub. It never dispatches, and no
    /// code path calls it automatically.
    pub fn release_uncertain_start(&mut self, start: UncertainStart) -> Result<Snapshot, String> {
        let release = self
            .cache
            .release_uncertain_start(&start)
            .map_err(|_| "Startsperre konnte nicht aufgehoben werden.")?;
        self.claims = self
            .cache
            .uncertain_starts()
            .map_err(|_| "Startsperren konnten nicht geladen werden.")?;
        if release == Release::Replaced {
            return Err(
                "Für dieses Ziel gibt es eine neuere Startsperre. Prüfe die Runs erneut.".into(),
            );
        }
        Ok(self.snapshot())
    }
    /// An unreadable preference keeps the default: notifications off.
    pub fn notifications_enabled(&self) -> bool {
        self.cache
            .load_app_settings()
            .is_ok_and(|settings| settings.notifications)
    }
    pub fn set_notifications_enabled(&mut self, enabled: bool) -> Result<(), String> {
        let mut settings: AppSettings = self.cache.load_app_settings().unwrap_or_default();
        settings.notifications = enabled;
        self.cache
            .save_app_settings(&settings)
            .map_err(|_| "Einstellung konnte nicht gespeichert werden.".into())
    }
    fn pages(
        &self,
        account: &str,
        path: &[&str],
        query: &[(&str, &str)],
    ) -> Result<Vec<Value>, String> {
        self.client
            .get_pages(account, url(path, query)?, now())
            .map_err(|e| e.to_string())?
            .iter()
            .map(|body| serde_json::from_slice(body).map_err(|_| "GitHub-Antwort ungültig.".into()))
            .collect()
    }
    fn one(&self, account: &str, path: &[&str], query: &[(&str, &str)]) -> Result<Value, String> {
        self.pages(account, path, query)?
            .into_iter()
            .next()
            .ok_or_else(|| "GitHub-Antwort fehlt.".into())
    }
    fn list(&self, account: &str, path: &[&str], key: Option<&str>) -> Result<Vec<Value>, String> {
        let mut all = vec![];
        for page in self.pages(account, path, &[("per_page", "100")])? {
            all.extend(
                key.map_or(&page, |k| &page[k])
                    .as_array()
                    .ok_or("GitHub-Liste ungültig.")?
                    .iter()
                    .cloned(),
            );
        }
        Ok(all)
    }
    /// Writes the public metadata cache. A failed write never marks data stale: what is in
    /// memory is still what GitHub returned, so the failure only becomes a notice.
    fn persist(&mut self) {
        let mut failed = false;
        for account in &self.data.accounts {
            failed |= self.cache.save_snapshot(&account.id, &self.data).is_err();
        }
        if failed {
            self.data.message = Some(match self.data.message.take() {
                Some(message) if !message.contains(CACHE_NOTICE) => {
                    format!("{message} · {CACHE_NOTICE}")
                }
                Some(message) => message,
                None => CACHE_NOTICE.into(),
            });
        }
    }
    pub fn connect_token(
        &mut self,
        token: SecretToken,
        still_current: impl Fn() -> bool,
    ) -> Result<Snapshot, String> {
        self.connect_credential(token, None, still_current)
    }
    pub fn connect_local_token(
        &mut self,
        token: SecretToken,
        expected_login: &str,
        still_current: impl Fn() -> bool,
    ) -> Result<Snapshot, String> {
        self.connect_credential(token, Some(expected_login), still_current)
    }
    fn connect_credential(
        &mut self,
        token: SecretToken,
        expected_login: Option<&str>,
        still_current: impl Fn() -> bool,
    ) -> Result<Snapshot, String> {
        if !still_current() {
            return Err("Anmeldung wurde abgebrochen.".into());
        }
        let mut transport = HttpTransport::new(self.keyring.clone())?;
        token.with_secret(|v| {
            if v.is_empty()
                || v.len() > 2048
                || v.bytes()
                    .any(|b| b.is_ascii_control() || b.is_ascii_whitespace())
            {
                Err("Token ist ungültig.")
            } else {
                Ok(())
            }
        })?;
        transport.bootstrap = Some(token);
        let client = ApiClient::new(transport);
        let request =
            ApiRequest::get("pending", url(&["user"], &[])?).map_err(|_| "Anfrage ungültig.")?;
        let response = client
            .execute(&request, now())
            .map_err(|_| "GitHub nicht erreichbar. Token wurde nicht gespeichert.")?;
        if response.status != 200 {
            return Err("Token wurde von GitHub nicht bestätigt. Prüfe Gültigkeit und Organisationsfreigabe.".into());
        }
        let user: Value =
            serde_json::from_slice(&response.body).map_err(|_| "GitHub-Konto ungültig.")?;
        let login = text(&user, "login")?.to_string();
        verify_local_identity(expected_login, &login)?;
        // Separate app-owned imports from PAT entries. Disconnect only deletes our copy;
        // it never changes, deletes or revokes the gh CLI's credential or active account.
        let id = credential_account_id(number(&user, "id")?, expected_login.is_some());
        // Consume the verified temporary token without serialization or UI round-trip.
        let mut guard = client
            .into_transport()
            .map_err(|_| "Anmeldung konnte nicht abgeschlossen werden.")?;
        let token = guard.bootstrap.take().ok_or("Token fehlt.")?;
        if !still_current() {
            return Err("Anmeldung wurde abgebrochen.".into());
        }
        browser_auth::commit_credential(self.keyring.as_ref(), &id, &token, &still_current)?;
        self.data.accounts.retain(|a| a.id != id);
        self.data.accounts.push(Account {
            id,
            login,
            label: if expected_login.is_some() {
                "GitHub · gh CLI (Kopie)"
            } else {
                "GitHub · Token"
            }
            .into(),
        });
        self.catalog_at = 0;
        self.refresh();
        self.persist();
        Ok(self.snapshot())
    }
    pub fn connect_browser(
        &mut self,
        tokens: BrowserTokens,
        still_current: impl Fn() -> bool,
    ) -> Result<Snapshot, String> {
        if !still_current() {
            return Err("Anmeldung wurde abgebrochen.".into());
        }
        let (user_id, login) = NativeOAuthTransport::new()?.identity(&tokens.access)?;
        let id = browser_auth::account_id(user_id);
        let credential = BrowserCredential {
            tokens,
            client_id: browser_auth::publisher()?.0.into(),
            user_id,
            rotation_pending: false,
        };
        if !still_current() {
            return Err("Anmeldung wurde abgebrochen.".into());
        }
        browser_auth::commit_credential(
            self.keyring.as_ref(),
            &id,
            &credential.encode()?,
            &still_current,
        )?;
        self.data.accounts.retain(|a| a.id != id);
        self.data.accounts.push(Account {
            id,
            login,
            label: "GitHub · Browser".into(),
        });
        self.catalog_at = 0;
        self.refresh();
        self.persist();
        Ok(self.snapshot())
    }
    pub fn disconnect(&mut self, account: &str) -> Result<Snapshot, String> {
        if !self.data.accounts.iter().any(|a| a.id == account) {
            return Err("Konto unbekannt.".into());
        }
        browser_auth::disconnect_credential(self.keyring.as_ref(), account)?;
        self.cache
            .delete_account(account)
            .map_err(|_| "Kontometadaten konnten nicht entfernt werden.")?;
        self.claims.retain(|claim| claim.account_id != account);
        self.data.accounts.retain(|a| a.id != account);
        self.data.repos.retain(|r| r.account_id != account);
        self.data.pins.retain(|p| p.account_id != account);
        let ids: BTreeSet<_> = self.data.repos.iter().map(|r| r.id.clone()).collect();
        self.data.runs.retain(|r| ids.contains(&r.repo_id));
        self.data.workflows.retain(|w| ids.contains(&w.repo_id));
        self.poll_at.retain(|id, _| ids.contains(id));
        self.history_since.retain(|id, _| ids.contains(id));
        self.tracked
            .retain(|_, tracker| tracker.account_id != account);
        Ok(self.snapshot())
    }
    /// Lists every usable account on its own. A failing account keeps its last known
    /// repositories and sits out this refresh; the other accounts' catalogs update.
    fn catalog(&mut self, issues: &mut RefreshIssues) {
        let mut listings = BTreeMap::new();
        for account in &self.data.accounts {
            if issues.blocked.contains(&account.id) {
                continue;
            }
            match account_repos(&self.client, account) {
                Ok(listing) => {
                    listings.insert(account.id.clone(), listing);
                }
                Err(error) => {
                    issues.blocked.insert(account.id.clone());
                    issues
                        .failures
                        .push((account.login.clone(), error.for_account()));
                }
            }
        }
        let complete = listings.len() == self.data.accounts.len();
        self.data.repos = merge_catalog(&self.data.repos, &self.data.accounts, listings);
        // A failed account retries its catalog after a minute, not after the full interval.
        self.catalog_at = if complete {
            now()
        } else {
            now().saturating_sub(CATALOG_SECONDS - 60)
        };
    }
    fn yaml(
        &self,
        repo: &Repo,
        path: &str,
        git_ref: &str,
    ) -> Result<crate::workflow::ParsedWorkflow, String> {
        if !path.starts_with(".github/workflows/")
            || path.split('/').any(|s| s == ".." || s.is_empty())
        {
            return Err("Workflow-Pfad ungültig.".into());
        }
        let mut segments = vec!["repos", &repo.owner, &repo.name, "contents"];
        segments.extend(path.split('/'));
        let value = self.one(&repo.account_id, &segments, &[("ref", git_ref)])?;
        if value["encoding"] != "base64" {
            return Err("Workflow-Inhalt ungültig.".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(text(&value, "content")?.replace(['\n', '\r'], ""))
            .map_err(|_| "Workflow-Inhalt ungültig.")?;
        parse_workflow_yaml(std::str::from_utf8(&bytes).map_err(|_| "Workflow ist kein UTF-8.")?)
            .map_err(|e| e.to_string())
    }
    fn repo_metadata(&self, repo: &Repo) -> Result<Vec<Workflow>, ScopeError> {
        let base = ["repos", repo.owner.as_str(), repo.name.as_str()];
        let mut found = vec![];
        for kind in ["branches", "tags"] {
            let path = [base.as_slice(), &[kind]].concat();
            let (values, _) = list_values(&self.client, &repo.account_id, &path, None, REF_PAGES)?;
            for value in values {
                found.push(text(&value, "name")?.to_string());
            }
        }
        let mut workflows = vec![];
        let (values, _) = list_values(
            &self.client,
            &repo.account_id,
            &[base.as_slice(), &["actions", "workflows"]].concat(),
            Some("workflows"),
            usize::MAX,
        )?;
        for value in values {
            let path = text(&value, "path")?;
            // Fail closed when YAML cannot be read/parsed; activity remains available.
            let mut parsed = self.yaml(repo, path, &repo.default_branch).ok();
            if parsed
                .as_ref()
                .is_some_and(|p| p.inputs.iter().any(|i| i.r#type == InputType::Environment))
            {
                let environments = self.list(
                    &repo.account_id,
                    &["repos", &repo.owner, &repo.name, "environments"],
                    Some("environments"),
                );
                match environments {
                    Ok(values) => {
                        let names: Vec<_> = values
                            .iter()
                            .filter_map(|v| v["name"].as_str().map(str::to_string))
                            .collect();
                        if let Some(p) = &mut parsed {
                            for input in &mut p.inputs {
                                if input.r#type == InputType::Environment {
                                    input.options = names.clone();
                                }
                            }
                        }
                    }
                    Err(_) => parsed = None,
                }
            }
            workflows.push(Workflow {
                id: number(&value, "id")?,
                repo_id: repo.id.clone(),
                name: text(&value, "name")?.into(),
                path: path.into(),
                dispatch: value["state"] == "active" && parsed.as_ref().is_some_and(|p| p.dispatch),
                inputs: parsed.map(|p| p.inputs).unwrap_or_default(),
                refs: vec![],
            });
        }
        let pinned: Vec<_> = self
            .data
            .pins
            .iter()
            .filter(|pin| pin.repo_id == repo.id)
            .map(|pin| pin.git_ref.as_str())
            .collect();
        let copies = workflows.iter().filter(|w| w.dispatch).count();
        let refs = bounded_refs(&repo.default_branch, &pinned, &found, copies);
        for workflow in &mut workflows {
            // Only startable workflows offer a ref choice; the others show the default branch.
            workflow.refs = if workflow.dispatch {
                refs.clone()
            } else {
                vec![repo.default_branch.clone()]
            };
        }
        Ok(workflows)
    }
    /// Every account and repository refreshes on its own: a failing scope keeps its last
    /// known data while the others update. A denied repository is marked on the repository
    /// itself; any other failure still marks the whole snapshot stale, because the models
    /// carry no per-account or per-repository freshness yet.
    pub fn refresh(&mut self) -> Snapshot {
        if self.data.accounts.is_empty() {
            self.data = empty_snapshot();
            return self.snapshot();
        }
        let mut issues = RefreshIssues::default();
        let mut oauth = OAuthClient::default();
        for account in &self.data.accounts {
            if browser_auth::is_browser_account(&account.id) {
                let usable = match oauth.prepare(&account.id) {
                    Ok(oauth) => {
                        browser_auth::access_token(self.keyring.as_ref(), &account.id, oauth, now())
                            .map(drop)
                            .map_err(ScopeError::Unauthorized)
                    }
                    Err(error) => Err(ScopeError::Transient(error)),
                };
                if let Err(error) = usable {
                    issues.blocked.insert(account.id.clone());
                    issues.failures.push((account.login.clone(), error));
                }
            }
        }
        let metadata_due = now().saturating_sub(self.catalog_at) >= CATALOG_SECONDS;
        if metadata_due {
            self.catalog(&mut issues);
        }
        let selected: Vec<_> = self
            .data
            .repos
            .iter()
            .filter(|r| r.selected)
            .cloned()
            .collect();
        let mut eligible = vec![];
        for repo in &selected {
            if issues.blocked.contains(&repo.account_id) || repo.permission == Permission::Denied {
                continue;
            }
            if metadata_due || !self.data.workflows.iter().any(|w| w.repo_id == repo.id) {
                match self.repo_metadata(repo) {
                    Ok(workflows) => {
                        self.data.workflows.retain(|w| w.repo_id != repo.id);
                        self.data.workflows.extend(workflows);
                    }
                    Err(error) => {
                        self.scope_failed(&mut issues, repo, error);
                        continue;
                    }
                }
            }
            eligible.push(repo.clone());
        }
        let run_history::RunsRefresh {
            mut runs,
            polled,
            failures,
        } = run_history::refresh_selected(
            &self.client,
            &eligible,
            &self.data.runs,
            &self.poll_at,
            &self.history_since,
            &mut issues.blocked,
            now(),
        );
        // Held repositories (account unusable, access denied, metadata failed) keep their runs.
        let eligible_ids: BTreeSet<_> = eligible.iter().map(|r| r.id.as_str()).collect();
        runs.extend(
            self.data
                .runs
                .iter()
                .filter(|run| {
                    !eligible_ids.contains(run.repo_id.as_str())
                        && selected.iter().any(|repo| repo.id == run.repo_id)
                })
                .cloned(),
        );
        for (repo, error) in failures {
            self.scope_failed(&mut issues, &repo, error);
        }
        let active: BTreeSet<_> = self
            .data
            .repos
            .iter()
            .filter(|r| {
                eligible_ids.contains(r.id.as_str())
                    && r.permission != Permission::Denied
                    && !issues.blocked.contains(&r.account_id)
            })
            .map(|r| r.id.clone())
            .collect();
        run_history::follow_dispatched(&self.client, &mut self.tracked, &active, &mut runs, now());
        self.data.runs = runs;
        for (repo_id, polled_at) in polled {
            self.poll_at.insert(repo_id.clone(), polled_at);
            self.history_since.insert(repo_id, polled_at);
        }
        self.settle(issues);
        self.snapshot()
    }
    /// A repository-level denial marks only that repository ("Actions · Kein Zugriff"),
    /// which also blocks dispatch to it; the next catalog listing re-reads its permission
    /// and retries it. Every other failure is reported at snapshot level.
    fn scope_failed(&mut self, issues: &mut RefreshIssues, repo: &Repo, error: ScopeError) {
        if let ScopeError::Denied(_) = error {
            if let Some(known) = self.data.repos.iter_mut().find(|r| r.id == repo.id) {
                known.permission = Permission::Denied;
            }
            return;
        }
        if let ScopeError::Unauthorized(_) = error {
            issues.blocked.insert(repo.account_id.clone());
        }
        issues
            .failures
            .push((format!("{}/{}", repo.owner, repo.name), error));
    }
    fn settle(&mut self, issues: RefreshIssues) {
        match issues.failures.first() {
            None => {
                self.data.updated_at = chrono::Utc::now().to_rfc3339();
                self.data.stale = false;
                self.data.connectivity = Connectivity::Online;
                self.data.message = if self.data.repos.is_empty()
                    && self
                        .data
                        .accounts
                        .iter()
                        .any(|a| browser_auth::is_browser_account(&a.id))
                {
                    Some("GitHub-Konto verbunden. Richte in den Einstellungen die App-Installation und Repository-Freigabe ein; Organisationsfreigabe oder SSO können erforderlich sein.".into())
                } else {
                    None
                };
            }
            Some((scope, error)) => {
                self.data.stale = true;
                self.data.connectivity = if issues
                    .failures
                    .iter()
                    .any(|(_, error)| matches!(error, ScopeError::Unauthorized(_)))
                {
                    Connectivity::Forbidden
                } else {
                    Connectivity::Offline
                };
                let more = match issues.failures.len() - 1 {
                    0 => String::new(),
                    count => format!(" (+{count} weitere)"),
                };
                self.data.message = Some(format!(
                    "Letzter Stand · {scope}: {}{more}",
                    error.message()
                ));
            }
        }
        // Healthy scopes were updated even when another one failed; keep them. A failed cache
        // write only adds a notice and never marks fresh data stale.
        self.persist();
    }
    pub fn refresh_repositories(&mut self) -> Snapshot {
        self.catalog_at = 0;
        self.refresh()
    }
    pub fn select_repos(&mut self, ids: Vec<String>) -> Result<Snapshot, String> {
        if ids.len() > 50
            || ids
                .iter()
                .any(|id| !self.data.repos.iter().any(|r| &r.id == id))
        {
            return Err("Wähle höchstens 50 bekannte Repositories.".into());
        }
        for repo in &mut self.data.repos {
            let selected = ids.contains(&repo.id);
            if selected && !repo.selected {
                // A deselected repository's runs leave the foreground snapshot.
                // Re-selecting must restore its initial history, not just new runs.
                self.history_since.remove(&repo.id);
            }
            repo.selected = selected;
        }
        self.poll_at.clear();
        self.persist();
        Ok(self.refresh())
    }
    /// Pins have their own cache table, so saving or deleting one never rewrites the snapshot.
    pub fn save_pin(&mut self, pin: Pin) -> Result<Snapshot, String> {
        validate_pin_fields(&pin)?;
        validate_non_secret_inputs(&pin.inputs).map_err(|e| e.to_string())?;
        if !self
            .data
            .repos
            .iter()
            .any(|r| r.id == pin.repo_id && r.account_id == pin.account_id)
            || !self
                .data
                .workflows
                .iter()
                .any(|w| w.id == pin.workflow_id && w.repo_id == pin.repo_id)
        {
            return Err("Vorlage passt nicht zum Konto/Repository.".into());
        }
        if self
            .data
            .pins
            .iter()
            .any(|p| p.id == pin.id && p.account_id != pin.account_id)
        {
            return Err("Eine Vorlage kann nicht in ein anderes Konto verschoben werden.".into());
        }
        self.cache
            .save_pin(&pin.account_id, &pin)
            .map_err(|e| e.to_string())?;
        self.data.pins.retain(|p| p.id != pin.id);
        self.data.pins.push(pin);
        Ok(self.snapshot())
    }
    pub fn delete_pin(&mut self, id: String) -> Result<Snapshot, String> {
        if let Some(pin) = self.data.pins.iter().find(|p| p.id == id) {
            self.cache
                .delete_pin(&pin.account_id, &id)
                .map_err(|e| e.to_string())?;
        }
        self.data.pins.retain(|p| p.id != id);
        Ok(self.snapshot())
    }
    pub fn dispatch(&mut self, request: DispatchRequest) -> DispatchOutcome {
        if let Err(error) = validate_request_id(&request.request_id) {
            return DispatchOutcome::rejected(error);
        }
        let fingerprint = match serde_json::to_string(&request) {
            Ok(v) => v,
            Err(_) => return DispatchOutcome::rejected("Ungültige Anfrage."),
        };
        if let Some((prior, outcome)) = self.outcomes.get(&request.request_id) {
            return if prior == &fingerprint {
                outcome.clone()
            } else {
                DispatchOutcome::rejected("Start-ID bereits verwendet.")
            };
        }
        let checked = (|| -> Result<(Repo, crate::github::ApiRequest), String> {
            if self.data.stale {
                return Err("Verbindung zuerst aktualisieren.".into());
            }
            let repo = self
                .data
                .repos
                .iter()
                .find(|r| {
                    r.id == request.repo_id && r.account_id == request.account_id && r.selected
                })
                .ok_or("Repository nicht ausgewählt.")?
                .clone();
            if repo.permission != Permission::Write {
                return Err("Repository hat keinen Schreibzugriff.".into());
            }
            let workflow = self
                .data
                .workflows
                .iter()
                .find(|w| w.id == request.workflow_id && w.repo_id == repo.id && w.dispatch)
                .ok_or("Workflow ist nicht manuell startbar.")?;
            let default = self.yaml(&repo, &workflow.path, &repo.default_branch)?;
            if !default.dispatch {
                return Err("workflow_dispatch fehlt im Default-Branch.".into());
            }
            if !workflow.refs.contains(&request.git_ref) {
                return Err("Branch/Tag unbekannt. Metadaten aktualisieren.".into());
            }
            let actual = self.yaml(&repo, &workflow.path, &request.git_ref)?;
            if !actual.dispatch {
                return Err("workflow_dispatch fehlt im gewählten Ref.".into());
            }
            let inputs =
                validate_inputs(&actual.inputs, &request.inputs).map_err(|e| e.to_string())?;
            let api = ApiRequest::workflow_dispatch(
                &repo.account_id,
                &repo.owner,
                &repo.name,
                workflow.id,
                &request.git_ref,
                &inputs,
            )
            .map_err(|e| e.to_string())?;
            Ok((repo, api))
        })();
        let outcome = match checked {
            Err(error) => DispatchOutcome::rejected(error),
            Ok((repo, api)) => self.send_claimed(&request, repo, api),
        };
        self.outcomes
            .insert(request.request_id, (fingerprint, outcome.clone()));
        outcome
    }
    /// Persists the target claim, sends exactly once, and keeps the target locked whenever
    /// the outcome is unknown or the claim could not be removed.
    fn send_claimed(
        &mut self,
        request: &DispatchRequest,
        repo: Repo,
        api: ApiRequest,
    ) -> DispatchOutcome {
        let target = DispatchTarget {
            account_id: repo.account_id.clone(),
            repo_id: repo.id.clone(),
            workflow_id: request.workflow_id,
            git_ref: request.git_ref.clone(),
        };
        match self
            .cache
            .claim_dispatch(&target, &chrono::Utc::now().to_rfc3339())
        {
            Err(_) => {
                return DispatchOutcome::rejected(
                    "Startsperre konnte nicht gespeichert werden. Es wurde nichts gestartet.",
                )
            }
            Ok(None) => {
                return DispatchOutcome::uncertain(
                    "Der letzte Start dieses Ziels ist ungeklärt. Kein erneuter Start; prüfe die Runs auf GitHub und hebe die Sperre danach auf.",
                )
            }
            Ok(Some(claim)) => self.claims.push(claim),
        }
        let mut outcome = self.client.dispatch(&api, &repo.owner, &repo.name, now());
        if outcome.state != DispatchState::Uncertain {
            match self.cache.resolve_dispatch(&target) {
                Ok(()) => self.claims.retain(|claim| claim.target() != target),
                Err(_) => outcome.message.push_str(
                    " Die Startsperre konnte nicht aufgehoben werden; prüfe die Runs auf GitHub und hebe sie danach auf.",
                ),
            }
        }
        if outcome.state == DispatchState::Accepted {
            if let (Some(id), Some(html_url)) = (outcome.run_id, outcome.html_url.as_ref()) {
                if let Ok(run_url) = ApiUrl::parse(&format!(
                    "https://api.github.com/repos/{}/{}/actions/runs/{id}",
                    repo.owner, repo.name
                )) {
                    self.tracked.insert(
                        id,
                        crate::github::RunTracker {
                            account_id: repo.account_id.clone(),
                            repo_id: repo.id.clone(),
                            workflow_id: request.workflow_id,
                            confirmation: crate::github::DispatchConfirmation {
                                workflow_run_id: id,
                                run_url,
                                html_url: html_url.clone(),
                            },
                        },
                    );
                }
            }
            self.poll_at.clear();
            self.refresh();
        }
        outcome
    }
}
fn credential_account_id(id: u64, local_import: bool) -> String {
    format!("github-{}{id}", if local_import { "gh-" } else { "" })
}

fn verify_local_identity(expected: Option<&str>, actual: &str) -> Result<(), String> {
    if expected.is_some_and(|login| !login.eq_ignore_ascii_case(actual)) {
        return Err(
            "GitHub hat ein anderes Konto gemeldet. Lokale Anmeldung erneut prüfen.".into(),
        );
    }
    Ok(())
}
const CATALOG_SECONDS: u64 = 600;
/// Pages (100 names each) read per ref kind for the ref picker.
const REF_PAGES: usize = 3;
/// Refs offered per startable workflow, the default branch included.
const MAX_REFS: usize = 100;
/// Every workflow carries its own copy of the repository's refs; all copies of one
/// repository share this budget, so 50 selected repositories stay far below the cache cap.
const REPO_REF_BYTES: usize = 8 * 1024;

/// Per-refresh bookkeeping: failing scopes and the accounts that sit this refresh out.
#[derive(Default)]
struct RefreshIssues {
    blocked: BTreeSet<String>,
    failures: Vec<(String, ScopeError)>,
}

/// A listing within `max_pages` (`usize::MAX`: the transport's whole page budget).
/// The flag reports a cut-off listing; GitHub's first pages are returned either way.
fn list_values<T: Transport>(
    client: &ApiClient<T>,
    account: &str,
    path: &[&str],
    key: Option<&str>,
    max_pages: usize,
) -> Result<(Vec<Value>, bool), ScopeError> {
    let pages = client.get_pages_limited(
        account,
        url(path, &[("per_page", "100")])?,
        now(),
        max_pages,
    )?;
    let mut all = vec![];
    for body in &pages.bodies {
        let page: Value = serde_json::from_slice(body).map_err(|_| "GitHub-Antwort ungültig.")?;
        all.extend(
            key.map_or(&page, |k| &page[k])
                .as_array()
                .ok_or("GitHub-Liste ungültig.")?
                .iter()
                .cloned(),
        );
    }
    Ok((all, pages.truncated))
}

/// One account's repositories as far as GitHub lists them.
struct AccountRepos {
    repos: Vec<Repo>,
    truncated: bool,
}

fn account_repos<T: Transport>(
    client: &ApiClient<T>,
    account: &Account,
) -> Result<AccountRepos, ScopeError> {
    let mut values = vec![];
    let mut truncated = false;
    if browser_auth::is_browser_account(&account.id) {
        let (installations, cut) = list_values(
            client,
            &account.id,
            &["user", "installations"],
            Some("installations"),
            usize::MAX,
        )?;
        truncated |= cut;
        for installation in installations {
            if !installation["suspended_at"].is_null() {
                continue;
            }
            let installation_id = number(&installation, "id")?.to_string();
            let (repositories, cut) = list_values(
                client,
                &account.id,
                &["user", "installations", &installation_id, "repositories"],
                Some("repositories"),
                usize::MAX,
            )?;
            truncated |= cut;
            for value in repositories {
                let permission = browser_repository_permission(&installation, &value);
                values.push((value, permission));
            }
        }
    } else {
        let (repositories, cut) =
            list_values(client, &account.id, &["user", "repos"], None, usize::MAX)?;
        truncated |= cut;
        for value in repositories {
            let permission = if value["permissions"]["push"].as_bool() == Some(true) {
                Permission::Write
            } else {
                Permission::Read
            };
            values.push((value, permission));
        }
    }
    let mut repos = vec![];
    for (value, permission) in values {
        repos.push(Repo {
            id: format!("{}:{}", account.id, number(&value, "id")?),
            account_id: account.id.clone(),
            owner: text(&value["owner"], "login")?.into(),
            name: text(&value, "name")?.into(),
            default_branch: value["default_branch"].as_str().unwrap_or("main").into(),
            selected: false,
            permission,
        });
    }
    Ok(AccountRepos { repos, truncated })
}

/// Listed accounts take their fresh repositories (selection kept by ID); unlisted accounts
/// keep their last known ones. A cut-off listing cannot prove that a selected repository
/// went away, so a selected repository missing from it stays.
fn merge_catalog(
    previous: &[Repo],
    accounts: &[Account],
    mut listings: BTreeMap<String, AccountRepos>,
) -> Vec<Repo> {
    let selected: BTreeSet<_> = previous
        .iter()
        .filter(|r| r.selected)
        .map(|r| r.id.as_str())
        .collect();
    let mut repos = vec![];
    for account in accounts {
        let known = previous.iter().filter(|r| r.account_id == account.id);
        match listings.remove(&account.id) {
            None => repos.extend(known.cloned()),
            Some(listing) => {
                for mut repo in listing.repos {
                    repo.selected = selected.contains(repo.id.as_str());
                    repos.push(repo);
                }
                if listing.truncated {
                    repos.extend(known.filter(|r| r.selected).cloned());
                }
            }
        }
    }
    let mut seen = BTreeSet::new();
    repos.retain(|repo| seen.insert(repo.id.clone()));
    repos
}

/// The refs one startable workflow offers, sorted: the default branch always, then pinned
/// refs that still exist, then branches and tags in GitHub's order, while `MAX_REFS` and the
/// repository's byte budget (shared by `copies` workflows) allow. Dispatch validation in UI
/// and core checks against exactly this list.
fn bounded_refs(
    default_branch: &str,
    pinned: &[&str],
    found: &[String],
    copies: usize,
) -> Vec<String> {
    let budget = REPO_REF_BYTES / copies.max(1);
    // JSON quotes and a separator per entry.
    let cost = |name: &str| name.len() + 3;
    let mut used = cost(default_branch);
    let mut refs = BTreeSet::from([default_branch.to_owned()]);
    let existing_pins = pinned
        .iter()
        .copied()
        .filter(|name| found.iter().any(|known| known == name));
    for name in existing_pins.chain(found.iter().map(String::as_str)) {
        if refs.len() >= MAX_REFS {
            break;
        }
        if refs.contains(name) || used + cost(name) > budget {
            continue;
        }
        used += cost(name);
        refs.insert(name.to_owned());
    }
    refs.into_iter().collect()
}

#[cfg(test)]
mod refresh_scope_tests {
    use super::*;

    fn account(id: &str) -> Account {
        Account {
            id: id.into(),
            login: format!("{id}-login"),
            label: "GitHub · Token".into(),
        }
    }
    fn repo(account_id: &str, number: u64, selected: bool) -> Repo {
        Repo {
            id: format!("{account_id}:{number}"),
            account_id: account_id.into(),
            owner: "fixture-owner".into(),
            name: format!("fixture-{number}"),
            default_branch: "main".into(),
            selected,
            permission: Permission::Write,
        }
    }

    #[test]
    fn failing_account_keeps_its_repositories_while_others_refresh() {
        let accounts = [account("github-1"), account("github-2")];
        let previous = vec![
            repo("github-1", 10, true),
            repo("github-1", 11, false),
            repo("github-2", 20, true),
        ];
        let listings = BTreeMap::from([(
            "github-1".to_string(),
            AccountRepos {
                repos: vec![repo("github-1", 10, false), repo("github-1", 12, false)],
                truncated: false,
            },
        )]);
        let merged = merge_catalog(&previous, &accounts, listings);
        let ids: Vec<_> = merged.iter().map(|r| (r.id.as_str(), r.selected)).collect();
        // github-1 refreshed: 11 left, 12 is new, 10 keeps its selection.
        // github-2 failed: its last known repositories stay as they were.
        assert_eq!(
            ids,
            vec![
                ("github-1:10", true),
                ("github-1:12", false),
                ("github-2:20", true)
            ]
        );
    }

    #[test]
    fn truncated_listing_keeps_selected_repositories_beyond_the_cut() {
        let accounts = [account("github-1")];
        let previous = vec![
            repo("github-1", 10, false),
            repo("github-1", 99, true),
            repo("github-1", 98, false),
        ];
        let listing = |truncated| {
            BTreeMap::from([(
                "github-1".to_string(),
                AccountRepos {
                    repos: vec![repo("github-1", 10, false), repo("github-1", 10, false)],
                    truncated,
                },
            )])
        };
        let ids = |repos: Vec<Repo>| repos.into_iter().map(|r| r.id).collect::<Vec<_>>();
        assert_eq!(
            ids(merge_catalog(&previous, &accounts, listing(true))),
            vec!["github-1:10", "github-1:99"]
        );
        assert_eq!(
            ids(merge_catalog(&previous, &accounts, listing(false))),
            vec!["github-1:10"]
        );
    }

    #[test]
    fn refs_are_bounded_and_always_offer_the_default_branch_and_existing_pins() {
        let found: Vec<_> = (0..600).map(|i| format!("release/{i:04}")).collect();
        let refs = bounded_refs("trunk", &["release/0599", "gone"], &found, 1);
        assert_eq!(refs.len(), MAX_REFS);
        assert!(refs.contains(&"trunk".to_string()));
        assert!(refs.contains(&"release/0599".to_string()));
        assert!(!refs.contains(&"gone".to_string()));
        let mut sorted = refs.clone();
        sorted.sort();
        assert_eq!(refs, sorted);
        // Many startable workflows share one repository budget.
        let shared = bounded_refs("trunk", &[], &found, 20);
        let bytes: usize = shared.iter().map(|name| name.len() + 3).sum();
        assert!(bytes * 20 <= REPO_REF_BYTES);
        assert!(shared.contains(&"trunk".to_string()));
        // An oversized default branch is still offered.
        let long = "x".repeat(REPO_REF_BYTES);
        assert_eq!(bounded_refs(&long, &[], &found, 50), vec![long]);
    }

    /// An endlessly paginating repository listing, or a revoked token.
    struct Listing {
        revoked: bool,
    }
    impl Transport for Listing {
        fn send(&mut self, request: &ApiRequest) -> Result<ApiResponse, TransportError> {
            let url = request.url().as_str();
            if self.revoked {
                return Ok(ApiResponse {
                    status: 401,
                    headers: BTreeMap::new(),
                    body: b"{}".to_vec(),
                });
            }
            let page: u32 = url
                .split("&page=")
                .nth(1)
                .and_then(|page| page.parse().ok())
                .unwrap_or(1);
            let next = format!(
                "<https://api.github.com/user/repos?per_page=100&page={}>; rel=\"next\"",
                page + 1
            );
            let body = serde_json::json!([{"id": page, "name": format!("fixture-{page}"), "owner": {"login": "fixture-owner"}, "permissions": {"push": page == 1}}]);
            Ok(ApiResponse {
                status: 200,
                headers: BTreeMap::from([("Link".to_string(), next)]),
                body: serde_json::to_vec(&body).unwrap(),
            })
        }
    }

    #[test]
    fn endless_repository_listing_is_truncated_instead_of_failing_the_account() {
        let client = ApiClient::new(Listing { revoked: false });
        let listing = account_repos(&client, &account("github-1")).unwrap();
        assert!(listing.truncated);
        assert_eq!(listing.repos.len(), 20);
        assert_eq!(listing.repos[0].permission, Permission::Write);
        assert_eq!(listing.repos[1].permission, Permission::Read);
        let revoked = ApiClient::new(Listing { revoked: true });
        let error = account_repos(&revoked, &account("github-2")).err().unwrap();
        assert!(matches!(error, ScopeError::Unauthorized(_)));
        assert!(matches!(
            ScopeError::Denied("GitHub returned HTTP 403.".into()).for_account(),
            ScopeError::Unauthorized(_)
        ));
    }
}

#[cfg(test)]
mod local_identity_tests {
    use super::*;
    #[test]
    fn local_import_checks_identity_and_has_a_separate_app_owned_namespace() {
        assert!(verify_local_identity(Some("fixture-alex"), "other-account").is_err());
        assert!(verify_local_identity(Some("fixture-alex"), "Fixture-Alex").is_ok());
        assert!(verify_local_identity(None, "fixture-alex").is_ok());
        assert_ne!(
            credential_account_id(42, true),
            credential_account_id(42, false)
        );
        assert_eq!(credential_account_id(42, true), "github-gh-42");
    }
}

// Installation Actions rights and the user's repository access are separate requirements.
fn browser_repository_permission(installation: &Value, repo: &Value) -> Permission {
    let actions = installation["permissions"]["actions"]
        .as_str()
        .unwrap_or("");
    let contents = installation["permissions"]["contents"]
        .as_str()
        .unwrap_or("");
    if !matches!(actions, "read" | "write") {
        return Permission::Denied;
    }
    if actions == "write"
        && matches!(contents, "read" | "write")
        && repo["permissions"]["push"].as_bool() == Some(true)
    {
        Permission::Write
    } else {
        Permission::Read
    }
}

#[cfg(test)]
mod browser_permission_tests {
    use super::*;
    #[test]
    fn push_flag_does_not_imply_app_actions_write_and_missing_contents_blocks_dispatch() {
        let repo = serde_json::json!({"permissions":{"push":true}});
        for permissions in [
            serde_json::json!({"actions":"read","contents":"read"}),
            serde_json::json!({"actions":"write"}),
        ] {
            assert_eq!(
                browser_repository_permission(
                    &serde_json::json!({"permissions":permissions}),
                    &repo
                ),
                Permission::Read
            );
        }
        assert_eq!(
            browser_repository_permission(
                &serde_json::json!({"permissions":{"contents":"read"}}),
                &repo
            ),
            Permission::Denied
        );
        let installation = serde_json::json!({"permissions":{"actions":"write","contents":"read"}});
        assert_eq!(
            browser_repository_permission(&installation, &repo),
            Permission::Write
        );
        assert_eq!(
            browser_repository_permission(
                &installation,
                &serde_json::json!({"permissions":{"push":false}})
            ),
            Permission::Read
        );
    }
}

#[cfg(test)]
mod store_tests {
    use super::*;
    use crate::auth::AuthError;

    /// Synthetic vault: holds nothing, so no test can read or write a real credential.
    struct EmptyVault;
    impl NativeKeyring for EmptyVault {
        fn read_token(&self, _: &str) -> Result<Option<SecretToken>, AuthError> {
            Ok(None)
        }
        fn write_token(&self, _: &str, _: &SecretToken) -> Result<(), AuthError> {
            Ok(())
        }
        fn delete_token(&self, _: &str) -> Result<(), AuthError> {
            Ok(())
        }
    }

    fn store(cache: Cache) -> LiveStore {
        LiveStore::new(cache, Arc::new(EmptyVault)).unwrap()
    }

    fn account(id: &str) -> Account {
        Account {
            id: id.into(),
            login: format!("fixture-{id}"),
            label: "GitHub · Token".into(),
        }
    }

    #[test]
    fn claims_survive_restart_release_explicitly_and_leave_with_their_account() {
        let path = std::env::temp_dir().join(format!(
            "repotray-live-claims-{}-{}.db",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        {
            let mut cache = Cache::open(&path).unwrap();
            let mut snapshot = empty_snapshot();
            snapshot.accounts = vec![account("github-1"), account("github-2")];
            for id in ["github-1", "github-2"] {
                cache.save_snapshot(id, &snapshot).unwrap();
                let target = DispatchTarget {
                    account_id: id.into(),
                    repo_id: format!("{id}:7"),
                    workflow_id: 9,
                    git_ref: "main".into(),
                };
                cache
                    .claim_dispatch(&target, "2026-11-01T10:00:00+00:00")
                    .unwrap();
            }
        }
        let mut live = store(Cache::open(&path).unwrap());
        let starts = live.snapshot().uncertain_starts;
        assert_eq!(starts.len(), 2);
        let released = live.release_uncertain_start(starts[0].clone()).unwrap();
        assert_eq!(released.uncertain_starts, vec![starts[1].clone()]);
        live.disconnect("github-2").unwrap();
        assert!(live.snapshot().uncertain_starts.is_empty());
        drop(live);
        assert!(store(Cache::open(&path).unwrap())
            .snapshot()
            .uncertain_starts
            .is_empty());
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn invalid_input_is_refused_and_the_outcome_ledger_is_bounded() {
        let mut live = store(Cache::in_memory().unwrap());
        let mut request = DispatchRequest {
            account_id: "github-1".into(),
            repo_id: "github-1:7".into(),
            workflow_id: 9,
            git_ref: "main".into(),
            inputs: Inputs::new(),
            request_id: "x".repeat(MAX_REQUEST_ID_CHARS + 1),
        };
        assert_eq!(
            live.dispatch(request.clone()).state,
            DispatchState::Rejected
        );
        assert!(live.outcomes.is_empty());
        // Unknown repositories are rejected before any network call.
        for index in 0..MAX_RECORDED_OUTCOMES + 44 {
            request.request_id = format!("start-{index}");
            live.dispatch(request.clone());
        }
        assert_eq!(live.outcomes.len(), MAX_RECORDED_OUTCOMES);
        assert!(live.outcomes.get(&"start-0".to_string()).is_none());
        let pin = Pin {
            id: "pin-1".into(),
            label: "x".repeat(MAX_PIN_LABEL_CHARS + 1),
            account_id: "github-1".into(),
            repo_id: "github-1:7".into(),
            workflow_id: 9,
            git_ref: "main".into(),
            inputs: Inputs::new(),
            quick_start: false,
        };
        assert!(live.save_pin(pin).unwrap_err().contains("120"));
    }

    #[test]
    fn a_failed_cache_write_is_a_notice_and_never_marks_live_data_stale() {
        let mut live = store(Cache::in_memory().unwrap());
        // An account ID the cache refuses to store forces the write to fail.
        live.data.accounts = vec![account("ghp_unstorable")];
        live.data.stale = false;
        live.data.connectivity = Connectivity::Online;
        live.data.message = None;
        live.persist();
        live.persist();
        assert!(!live.data.stale);
        assert_eq!(live.data.connectivity, Connectivity::Online);
        assert_eq!(live.data.message.as_deref(), Some(CACHE_NOTICE));
    }
}
