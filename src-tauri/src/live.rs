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
    run_history::{self, Cause, ScopeError},
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
const ACCOUNT_SAVE_FAILED: &str =
    "Konto konnte nicht lokal gespeichert werden. Es wurde nichts verbunden; versuche es erneut.";
const BROWSER_SETUP_NOTICE: &str = "GitHub-Konto verbunden. Richte in den Einstellungen die App-Installation und Repository-Freigabe ein; Organisationsfreigabe oder SSO können erforderlich sein.";

/// Appends a notice to a panel message, once.
fn with_notice(message: Option<String>, notice: &str) -> String {
    match message {
        Some(message) if message.contains(notice) => message,
        Some(message) => format!("{message} · {notice}"),
        None => notice.into(),
    }
}

/// The native engine. `T` is the GitHub transport; tests drive it through a synthetic one.
pub struct LiveStore<T: Transport = HttpTransport> {
    data: Snapshot,
    client: ApiClient<T>,
    keyring: Arc<dyn NativeKeyring>,
    cache: Cache,
    schedule: Schedule,
    poll_at: BTreeMap<String, u64>,
    history_since: BTreeMap<String, u64>,
    tracked: BTreeMap<u64, crate::github::RunTracker>,
    outcomes: RecentOutcomes<String, (String, DispatchOutcome)>,
    /// Mirrors the persisted dispatch claims; kept outside `data` so no reset can hide one.
    claims: Vec<UncertainStart>,
    /// UNIX seconds for refresh timers and backoff; tests step it forward.
    clock: fn() -> u64,
}
impl LiveStore<HttpTransport> {
    pub fn new(cache: Cache, keyring: Arc<dyn NativeKeyring>) -> Result<Self, String> {
        let client = ApiClient::new(HttpTransport::new(keyring.clone())?);
        Self::with_client(cache, keyring, client)
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
        let account = Account {
            id: id.clone(),
            login,
            label: if expected_login.is_some() {
                "GitHub · gh CLI (Kopie)"
            } else {
                "GitHub · Token"
            }
            .into(),
        };
        self.connect_account(account, |keyring| {
            browser_auth::commit_credential(keyring, &id, &token, &still_current)
        })
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
        let encoded = credential.encode()?;
        let account = Account {
            id: id.clone(),
            login,
            label: "GitHub · Browser".into(),
        };
        self.connect_account(account, |keyring| {
            browser_auth::commit_credential(keyring, &id, &encoded, &still_current)
        })
    }
}
impl<T: Transport> LiveStore<T> {
    fn with_client(
        cache: Cache,
        keyring: Arc<dyn NativeKeyring>,
        client: ApiClient<T>,
    ) -> Result<Self, String> {
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
            client,
            data,
            keyring,
            cache,
            schedule: Schedule::default(),
            poll_at: BTreeMap::new(),
            history_since: BTreeMap::new(),
            tracked: BTreeMap::new(),
            outcomes: RecentOutcomes::new(MAX_RECORDED_OUTCOMES),
            claims,
            clock: now,
        })
    }
    /// A denied repository's open runs are frozen at their last known state; they leave the
    /// panel instead of looking current. Completed runs stay as history.
    pub fn snapshot(&self) -> Snapshot {
        let mut snapshot = self.data.clone();
        snapshot.uncertain_starts = self.claims.clone();
        let denied: BTreeSet<_> = snapshot
            .repos
            .iter()
            .filter(|repo| repo.permission == Permission::Denied)
            .map(|repo| repo.id.clone())
            .collect();
        snapshot
            .runs
            .retain(|run| run.status == RunStatus::Completed || !denied.contains(&run.repo_id));
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
            .get_pages(account, url(path, query)?, (self.clock)())
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
            self.data.message = Some(with_notice(self.data.message.take(), CACHE_NOTICE));
        }
    }
    /// Adds a verified account. Its cache row is written before `commit` stores the
    /// credential, so a connected account always survives a restart and stays removable from
    /// the panel even when a later full snapshot write fails. A failed row write leaves the
    /// vault untouched.
    fn connect_account(
        &mut self,
        account: Account,
        commit: impl FnOnce(&dyn NativeKeyring) -> Result<(), String>,
    ) -> Result<Snapshot, String> {
        let id = account.id.clone();
        let stored = self
            .cache
            .account_ids()
            .map_err(|_| ACCOUNT_SAVE_FAILED)?
            .contains(&id);
        if !stored {
            let mut minimal = empty_snapshot();
            minimal.accounts = vec![account.clone()];
            minimal.message = None;
            self.cache
                .save_snapshot(&id, &minimal)
                .map_err(|_| ACCOUNT_SAVE_FAILED)?;
        }
        if let Err(error) = commit(self.keyring.as_ref()) {
            if !stored {
                // Best effort; only the row goes, never pins, settings or claims. A row left
                // behind shows an account that asks to be reconnected or disconnected.
                let _ = self.cache.delete_snapshot(&id);
            }
            return Err(error);
        }
        self.schedule.forget_account(&id, &self.data.repos);
        self.data.accounts.retain(|a| a.id != id);
        self.data.accounts.push(account);
        self.refresh();
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
        self.schedule.forget_account(account, &self.data.repos);
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
    /// Lists every account whose catalog is due, each on its own timer. A failing account
    /// keeps its last known repositories: a transient failure retries after a minute, an
    /// unauthorized account waits out its hold. Healthy accounts are not refetched early.
    fn catalog(&mut self, issues: &mut RefreshIssues, now: u64) {
        let mut listings = BTreeMap::new();
        for account in &self.data.accounts {
            if issues.blocked.contains(&account.id) || !self.schedule.catalog_due(&account.id, now)
            {
                continue;
            }
            match account_repos(&self.client, account, now) {
                Ok(listing) => {
                    self.schedule.catalog_read(&account.id, None, now);
                    listings.insert(account.id.clone(), listing);
                }
                Err(error) => {
                    let error = error.for_account();
                    self.schedule.catalog_read(&account.id, Some(&error), now);
                    if matches!(error, ScopeError::Unauthorized(_)) {
                        self.schedule.hold(&account.id, error.clone(), now);
                    }
                    issues.block(account, error);
                }
            }
        }
        if !listings.is_empty() {
            self.data.repos = merge_catalog(&self.data.repos, &self.data.accounts, listings);
        }
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
    fn repo_metadata(&self, repo: &Repo, now: u64) -> Result<Vec<Workflow>, ScopeError> {
        let base = ["repos", repo.owner.as_str(), repo.name.as_str()];
        let mut listing = RefListing::default();
        for (kind, names) in [
            ("branches", &mut listing.branches),
            ("tags", &mut listing.tags),
        ] {
            let path = [base.as_slice(), &[kind]].concat();
            let (values, truncated) =
                list_values(&self.client, &repo.account_id, &path, None, REF_PAGES, now)?;
            listing.truncated |= truncated;
            for value in values {
                names.push(text(&value, "name")?.to_string());
            }
        }
        let mut workflows = vec![];
        let (values, _) = list_values(
            &self.client,
            &repo.account_id,
            &[base.as_slice(), &["actions", "workflows"]].concat(),
            Some("workflows"),
            usize::MAX,
            now,
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
        let refs = bounded_refs(&repo.default_branch, &pinned, &listing, copies);
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
    /// known data while the others update, and each keeps its own metadata timer. A denied
    /// repository is marked on the repository itself and named in a notice; any other failure
    /// still marks the whole snapshot stale, because the models carry no per-account or
    /// per-repository freshness yet.
    pub fn refresh(&mut self) -> Snapshot {
        if self.data.accounts.is_empty() {
            self.data = empty_snapshot();
            return self.snapshot();
        }
        let now = (self.clock)();
        let mut issues = RefreshIssues::default();
        let mut oauth = OAuthClient::default();
        for account in &self.data.accounts {
            // An unauthorized account waits for its hold to end or for a reconnect.
            if let Some(error) = self.schedule.held(&account.id, now) {
                issues.block(account, error.clone());
                continue;
            }
            if !browser_auth::is_browser_account(&account.id) {
                continue;
            }
            let usable = match oauth.prepare(&account.id) {
                Ok(oauth) => {
                    browser_auth::access_token(self.keyring.as_ref(), &account.id, oauth, now)
                        .map(drop)
                        .map_err(|error| ScopeError::Unauthorized(Cause::Text(error)))
                }
                Err(error) => Err(ScopeError::Transient(Cause::Text(error))),
            };
            if let Err(error) = usable {
                if matches!(error, ScopeError::Unauthorized(_)) {
                    self.schedule.hold(&account.id, error.clone(), now);
                }
                issues.block(account, error);
            }
        }
        self.catalog(&mut issues, now);
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
            if self.schedule.metadata_due(&repo.id, now) {
                match self.repo_metadata(repo, now) {
                    Ok(workflows) => {
                        self.schedule.metadata_read(&repo.id, None, now);
                        self.data.workflows.retain(|w| w.repo_id != repo.id);
                        self.data.workflows.extend(workflows);
                    }
                    Err(error) => {
                        self.schedule.metadata_read(&repo.id, Some(&error), now);
                        self.scope_failed(&mut issues, repo, error, now);
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
            now,
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
            self.scope_failed(&mut issues, &repo, error, now);
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
        run_history::follow_dispatched(&self.client, &mut self.tracked, &active, &mut runs, now);
        self.data.runs = runs;
        for (repo_id, polled_at) in polled {
            self.poll_at.insert(repo_id.clone(), polled_at);
            self.history_since.insert(repo_id, polled_at);
        }
        self.settle(issues);
        self.snapshot()
    }
    fn login(&self, account_id: &str) -> String {
        self.data
            .accounts
            .iter()
            .find(|account| account.id == account_id)
            .map_or_else(|| account_id.to_owned(), |account| account.login.clone())
    }
    /// A repository-level denial marks only that repository ("Actions · Kein Zugriff"),
    /// which also blocks dispatch to it; the next catalog listing re-reads its permission
    /// and retries it. An unauthorized answer holds the whole account. Every other failure
    /// is reported at snapshot level.
    fn scope_failed(
        &mut self,
        issues: &mut RefreshIssues,
        repo: &Repo,
        error: ScopeError,
        now: u64,
    ) {
        if let ScopeError::Denied(_) = error {
            if let Some(known) = self.data.repos.iter_mut().find(|r| r.id == repo.id) {
                known.permission = Permission::Denied;
            }
            return;
        }
        if let ScopeError::Unauthorized(_) = error {
            issues.blocked.insert(repo.account_id.clone());
            self.schedule.hold(&repo.account_id, error.clone(), now);
        }
        issues.failures.push(Failure {
            login: self.login(&repo.account_id),
            repo: Some(format!("{}/{}", repo.owner, repo.name)),
            error,
        });
    }
    /// Selected repositories whose Actions GitHub refused; their runs are not current.
    fn denied_notice(&self) -> Option<String> {
        let mut denied = self
            .data
            .repos
            .iter()
            .filter(|repo| repo.selected && repo.permission == Permission::Denied);
        let first = denied.next()?;
        let more = match denied.count() {
            0 => String::new(),
            count => format!(" (+{count} weitere)"),
        };
        Some(format!(
            "Kein Zugriff auf Actions: {}/{}{more} – prüfe Token-Rechte oder SSO-Freigabe.",
            first.owner, first.name
        ))
    }
    fn settle(&mut self, issues: RefreshIssues) {
        let denied = self.denied_notice();
        // An account that needs reconnecting is the most actionable headline.
        let headline = issues
            .failures
            .iter()
            .find(|failure| matches!(failure.error, ScopeError::Unauthorized(_)))
            .or_else(|| issues.failures.first());
        match headline {
            None => {
                self.data.updated_at = chrono::Utc::now().to_rfc3339();
                self.data.stale = false;
                self.data.connectivity = Connectivity::Online;
                let setup = (self.data.repos.is_empty()
                    && self
                        .data
                        .accounts
                        .iter()
                        .any(|a| browser_auth::is_browser_account(&a.id)))
                .then(|| BROWSER_SETUP_NOTICE.to_owned());
                self.data.message = match (setup, denied) {
                    (Some(setup), Some(denied)) => Some(with_notice(Some(setup), &denied)),
                    (setup, denied) => setup.or(denied),
                };
            }
            Some(failure) => {
                self.data.stale = true;
                self.data.connectivity = if issues
                    .failures
                    .iter()
                    .any(|failure| matches!(failure.error, ScopeError::Unauthorized(_)))
                {
                    Connectivity::Forbidden
                } else {
                    Connectivity::Offline
                };
                let more = match issues.failures.len() - 1 {
                    0 => String::new(),
                    count => format!(" (+{count} weitere)"),
                };
                let headline = format!("Letzter Stand · {}{more}", failure.describe());
                self.data.message = Some(match denied {
                    Some(denied) => with_notice(Some(headline), &denied),
                    None => headline,
                });
            }
        }
        // Healthy scopes were updated even when another one failed; keep them. A failed cache
        // write only adds a notice and never marks fresh data stale.
        self.persist();
    }
    /// The explicit "refresh repository access" action: every scope, including a held
    /// account, reads its catalog and metadata again now.
    pub fn refresh_repositories(&mut self) -> Snapshot {
        self.schedule = Schedule::default();
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
    /// Validates against the last refresh, reads the workflow at the requested ref (a ref
    /// GitHub no longer knows is rejected here, before any claim), then sends exactly once.
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
        let mut outcome = self
            .client
            .dispatch(&api, &repo.owner, &repo.name, (self.clock)());
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
/// How often each account's catalog and each repository's metadata are read again.
const CATALOG_SECONDS: u64 = 600;
/// A transiently failed catalog or metadata read retries after this delay.
const RETRY_SECONDS: u64 = 60;
/// Pages (100 names each) read per ref kind for the ref picker.
const REF_PAGES: usize = 3;
/// Refs offered per startable workflow, the default branch included; pinned refs come on top.
const MAX_REFS: usize = 100;
/// Every workflow carries its own copy of the repository's refs; all copies of one
/// repository share this budget, so 50 selected repositories stay far below the cache cap.
const REPO_REF_BYTES: usize = 8 * 1024;

/// One failing scope of a refresh, named for the panel.
struct Failure {
    login: String,
    /// `owner/name` when the scope is a repository.
    repo: Option<String>,
    error: ScopeError,
}
impl Failure {
    fn describe(&self) -> String {
        self.error.describe(&self.login, self.repo.as_deref())
    }
}

/// Per-refresh bookkeeping: failing scopes and the accounts that sit this refresh out.
#[derive(Default)]
struct RefreshIssues {
    blocked: BTreeSet<String>,
    failures: Vec<Failure>,
}
impl RefreshIssues {
    /// The account sits out the rest of this refresh.
    fn block(&mut self, account: &Account, error: ScopeError) {
        self.blocked.insert(account.id.clone());
        self.failures.push(Failure {
            login: account.login.clone(),
            repo: None,
            error,
        });
    }
}

/// When each scope next reads its metadata (UNIX seconds; a missing entry means now). Every
/// account catalog and every repository's branches, tags and workflows keep their own timer,
/// so a failing scope never makes the healthy ones refetch early. An unauthorized account
/// sits out every request for the full interval, until it reconnects, or until the explicit
/// repository-access refresh.
#[derive(Debug, Default)]
struct Schedule {
    catalog: BTreeMap<String, u64>,
    metadata: BTreeMap<String, u64>,
    held: BTreeMap<String, (u64, ScopeError)>,
}
impl Schedule {
    fn catalog_due(&self, account: &str, now: u64) -> bool {
        self.catalog.get(account).is_none_or(|at| now >= *at)
    }
    fn metadata_due(&self, repo: &str, now: u64) -> bool {
        self.metadata.get(repo).is_none_or(|at| now >= *at)
    }
    fn catalog_read(&mut self, account: &str, failure: Option<&ScopeError>, now: u64) {
        let delay = match failure {
            Some(ScopeError::Transient(_)) => RETRY_SECONDS,
            _ => CATALOG_SECONDS,
        };
        self.catalog
            .insert(account.to_owned(), now.saturating_add(delay));
    }
    /// A denied repository is skipped until a catalog listing grants access again and then
    /// reads its metadata at once.
    fn metadata_read(&mut self, repo: &str, failure: Option<&ScopeError>, now: u64) {
        let delay = match failure {
            Some(ScopeError::Denied(_)) => {
                self.metadata.remove(repo);
                return;
            }
            Some(ScopeError::Transient(_)) => RETRY_SECONDS,
            _ => CATALOG_SECONDS,
        };
        self.metadata
            .insert(repo.to_owned(), now.saturating_add(delay));
    }
    fn hold(&mut self, account: &str, error: ScopeError, now: u64) {
        let until = now.saturating_add(CATALOG_SECONDS);
        self.held.insert(account.to_owned(), (until, error));
        self.catalog.insert(account.to_owned(), until);
    }
    fn held(&self, account: &str, now: u64) -> Option<&ScopeError> {
        self.held
            .get(account)
            .filter(|(until, _)| now < *until)
            .map(|(_, error)| error)
    }
    /// A new, reconnected or removed account starts its timers over.
    fn forget_account(&mut self, account: &str, repos: &[Repo]) {
        self.catalog.remove(account);
        self.held.remove(account);
        for repo in repos.iter().filter(|repo| repo.account_id == account) {
            self.metadata.remove(&repo.id);
        }
    }
}

/// A listing within `max_pages` (`usize::MAX`: the transport's whole page budget).
/// The flag reports a cut-off listing; GitHub's first pages are returned either way.
fn list_values<T: Transport>(
    client: &ApiClient<T>,
    account: &str,
    path: &[&str],
    key: Option<&str>,
    max_pages: usize,
    now: u64,
) -> Result<(Vec<Value>, bool), ScopeError> {
    let pages =
        client.get_pages_limited(account, url(path, &[("per_page", "100")])?, now, max_pages)?;
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
    now: u64,
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
            now,
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
                now,
            )?;
            truncated |= cut;
            for value in repositories {
                let permission = browser_repository_permission(&installation, &value);
                values.push((value, permission));
            }
        }
    } else {
        let (repositories, cut) = list_values(
            client,
            &account.id,
            &["user", "repos"],
            None,
            usize::MAX,
            now,
        )?;
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

/// A repository's branches and tags as far as the ref picker reads them.
#[derive(Debug, Default)]
struct RefListing {
    branches: Vec<String>,
    tags: Vec<String>,
    /// Either kind was cut at `REF_PAGES`.
    truncated: bool,
}

/// The refs one startable workflow offers, sorted. Dispatch validation in UI and core checks
/// against exactly this list.
///
/// - The default branch, always.
/// - Every ref a pin of this repository uses, outside `MAX_REFS` and the byte budget, so a
///   template stays startable: when the listing names it, or when the listing was cut off and
///   cannot prove the ref is gone. A vanished ref is still safe: `dispatch` reads the workflow
///   at that ref before it claims or sends anything, and GitHub's 404 rejects the start.
/// - Branches and tags in turns, in GitHub's order, while `MAX_REFS` and the repository's
///   byte budget (shared by `copies` workflows) allow; neither kind starves the other.
fn bounded_refs(
    default_branch: &str,
    pinned: &[&str],
    listing: &RefListing,
    copies: usize,
) -> Vec<String> {
    let budget = REPO_REF_BYTES / copies.max(1);
    // JSON quotes and a separator per entry.
    let cost = |name: &str| name.len() + 3;
    let mut used = cost(default_branch);
    let mut refs = BTreeSet::from([default_branch.to_owned()]);
    for name in pinned {
        let listed = listing
            .branches
            .iter()
            .chain(&listing.tags)
            .any(|known| known == name);
        if (listed || listing.truncated) && refs.insert((*name).to_owned()) {
            used += cost(name);
        }
    }
    let turns = listing.branches.len().max(listing.tags.len());
    let alternating = (0..turns)
        .flat_map(|index| [listing.branches.get(index), listing.tags.get(index)])
        .flatten();
    for name in alternating {
        if refs.len() >= MAX_REFS {
            break;
        }
        if refs.contains(name) || used + cost(name) > budget {
            continue;
        }
        used += cost(name);
        refs.insert(name.clone());
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
        let found = RefListing {
            branches: (0..600).map(|i| format!("release/{i:04}")).collect(),
            ..RefListing::default()
        };
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

    #[test]
    fn pinned_refs_survive_the_cap_the_budget_and_a_cut_off_listing() {
        let branches: Vec<_> = (0..300).map(|i| format!("feature/{i:04}")).collect();
        let tags: Vec<_> = (0..5).map(|i| format!("v1.{i}")).collect();
        let cut = RefListing {
            branches: branches.clone(),
            tags: tags.clone(),
            truncated: true,
        };
        // Ten startable workflows leave each copy about 800 bytes, far fewer than MAX_REFS.
        let pins = ["release/beyond-the-cut", "feature/0299", "v1.4"];
        let refs = bounded_refs("main", &pins, &cut, 10);
        for pin in pins {
            assert!(refs.contains(&pin.to_string()), "{pin}");
        }
        // Tags are not starved by a long branch list.
        for tag in &tags {
            assert!(refs.contains(tag), "{tag}");
        }
        let bytes: usize = refs.iter().map(|name| name.len() + 3).sum();
        let pin_bytes: usize = pins.iter().map(|name| name.len() + 3).sum();
        assert!(bytes <= REPO_REF_BYTES / 10 + pin_bytes);
        // A complete listing proves an unlisted pinned ref is gone.
        let complete = RefListing {
            truncated: false,
            ..cut
        };
        let refs = bounded_refs("main", &pins, &complete, 10);
        assert!(!refs.contains(&"release/beyond-the-cut".to_string()));
        assert!(refs.contains(&"feature/0299".to_string()));
        // Pins stay offered even when they alone exceed MAX_REFS.
        let many: Vec<String> = (0..MAX_REFS + 5).map(|i| format!("pin/{i}")).collect();
        let many: Vec<&str> = many.iter().map(String::as_str).collect();
        let unknown = RefListing {
            truncated: true,
            ..RefListing::default()
        };
        assert_eq!(bounded_refs("main", &many, &unknown, 1).len(), MAX_REFS + 6);
        // Both kinds share one budget in turns.
        let even = RefListing {
            branches: (0..200).map(|i| format!("b{i:03}")).collect(),
            tags: (0..200).map(|i| format!("t{i:03}")).collect(),
            truncated: false,
        };
        let refs = bounded_refs("main", &[], &even, 1);
        let tagged = refs.iter().filter(|name| name.starts_with('t')).count();
        let branched = refs.iter().filter(|name| name.starts_with('b')).count();
        assert_eq!((branched, tagged), (50, 49));
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
        let listing = account_repos(&client, &account("github-1"), 0).unwrap();
        assert!(listing.truncated);
        assert_eq!(listing.repos.len(), 20);
        assert_eq!(listing.repos[0].permission, Permission::Write);
        assert_eq!(listing.repos[1].permission, Permission::Read);
        let revoked = ApiClient::new(Listing { revoked: true });
        let error = account_repos(&revoked, &account("github-2"), 0)
            .err()
            .unwrap();
        assert!(matches!(error, ScopeError::Unauthorized(_)));
        assert!(matches!(
            ScopeError::Denied(Cause::Http(403)).for_account(),
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

/// The refresh and dispatch orchestration against a synthetic GitHub. No real account,
/// token or repository is involved; every name below is a labelled fixture.
#[cfg(test)]
mod orchestration_tests {
    use super::*;
    use crate::auth::AuthError;
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
                        let content = base64::engine::general_purpose::STANDARD
                            .encode("on: workflow_dispatch\n");
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
}
