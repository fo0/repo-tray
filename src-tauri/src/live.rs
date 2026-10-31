//! Native authenticated GitHub access. Secrets never enter Snapshot or the metadata cache.
use crate::{
    auth::{NativeKeyring, SecretToken},
    browser_auth::{self, BrowserCredential, BrowserTokens, NativeOAuthTransport, OAuthTransport},
    cache::Cache,
    github::{ApiClient, ApiRequest, ApiResponse, ApiUrl, Method, Transport, TransportError},
    models::*,
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
        })
    }
}
impl Transport for HttpTransport {
    fn send(&mut self, request: &ApiRequest) -> Result<ApiResponse, TransportError> {
        let stored;
        let token = if request.account_id() == "pending" {
            self.bootstrap.as_ref()
        } else {
            stored = Some(
                browser_auth::access_token(
                    self.keyring.as_ref(),
                    request.account_id(),
                    &mut NativeOAuthTransport::new().map_err(|_| TransportError::BeforeSend)?,
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
pub fn now() -> u64 {
    chrono::Utc::now().timestamp().max(0) as u64
}
fn url(path: &[&str], query: &[(&str, &str)]) -> Result<ApiUrl, String> {
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
    }
}

pub struct LiveStore {
    data: Snapshot,
    client: ApiClient<HttpTransport>,
    keyring: Arc<dyn NativeKeyring>,
    cache: Cache,
    catalog_at: u64,
    poll_at: BTreeMap<String, u64>,
    tracked: BTreeMap<u64, crate::github::RunTracker>,
    outcomes: BTreeMap<String, (String, DispatchOutcome)>,
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
                if cached.snapshot.mode != Mode::Live {
                    continue;
                }
                data.accounts.extend(cached.snapshot.accounts);
                data.repos.extend(cached.snapshot.repos);
                data.workflows.extend(cached.snapshot.workflows);
                data.runs.extend(cached.snapshot.runs);
                data.pins.extend(cached.snapshot.pins);
                data.updated_at = cached.snapshot.updated_at;
            }
        }
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
            tracked: BTreeMap::new(),
            outcomes: BTreeMap::new(),
        })
    }
    pub fn snapshot(&self) -> Snapshot {
        self.data.clone()
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
    fn persist(&mut self) -> Result<(), String> {
        for account in &self.data.accounts {
            self.cache
                .save_snapshot(&account.id, &self.data, None)
                .map_err(|_| "Metadaten konnten nicht gespeichert werden.")?;
        }
        Ok(())
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
        self.persist()?;
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
        self.persist()?;
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
        self.data.accounts.retain(|a| a.id != account);
        self.data.repos.retain(|r| r.account_id != account);
        self.data.pins.retain(|p| p.account_id != account);
        let ids: BTreeSet<_> = self.data.repos.iter().map(|r| r.id.clone()).collect();
        self.data.runs.retain(|r| ids.contains(&r.repo_id));
        self.data.workflows.retain(|w| ids.contains(&w.repo_id));
        Ok(self.snapshot())
    }
    fn catalog(&mut self) -> Result<(), String> {
        let selected: BTreeSet<_> = self
            .data
            .repos
            .iter()
            .filter(|r| r.selected)
            .map(|r| r.id.clone())
            .collect();
        let mut repos = vec![];
        for account in &self.data.accounts {
            let mut values = vec![];
            if browser_auth::is_browser_account(&account.id) {
                for installation in self.list(
                    &account.id,
                    &["user", "installations"],
                    Some("installations"),
                )? {
                    if !installation["suspended_at"].is_null() {
                        continue;
                    }
                    let installation_id = number(&installation, "id")?.to_string();
                    for value in self.list(
                        &account.id,
                        &["user", "installations", &installation_id, "repositories"],
                        Some("repositories"),
                    )? {
                        let permission = browser_repository_permission(&installation, &value);
                        values.push((value, permission));
                    }
                }
            } else {
                for value in self.list(&account.id, &["user", "repos"], None)? {
                    let permission = if value["permissions"]["push"].as_bool() == Some(true) {
                        Permission::Write
                    } else {
                        Permission::Read
                    };
                    values.push((value, permission));
                }
            }
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
        }
        for repo in &mut repos {
            repo.selected = selected.contains(&repo.id);
        }
        self.data.repos = repos;
        self.catalog_at = now();
        Ok(())
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
    fn repo_metadata(&self, repo: &Repo) -> Result<Vec<Workflow>, String> {
        let base = ["repos", repo.owner.as_str(), repo.name.as_str()];
        let mut refs = vec![];
        for kind in ["branches", "tags"] {
            for value in self.list(&repo.account_id, &[base.as_slice(), &[kind]].concat(), None)? {
                refs.push(text(&value, "name")?.to_string());
            }
        }
        refs.sort();
        refs.dedup();
        let mut workflows = vec![];
        for value in self.list(
            &repo.account_id,
            &[base.as_slice(), &["actions", "workflows"]].concat(),
            Some("workflows"),
        )? {
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
                refs: refs.clone(),
            });
        }
        Ok(workflows)
    }
    pub fn refresh(&mut self) -> Snapshot {
        if self.data.accounts.is_empty() {
            self.data = empty_snapshot();
            return self.snapshot();
        }
        let result = (|| -> Result<(), String> {
            for account in &self.data.accounts {
                if browser_auth::is_browser_account(&account.id) {
                    browser_auth::access_token(
                        self.keyring.as_ref(),
                        &account.id,
                        &mut NativeOAuthTransport::new()?,
                        now(),
                    )?;
                }
            }
            let metadata_due = now().saturating_sub(self.catalog_at) >= 600;
            if metadata_due {
                self.catalog()?;
            }
            let selected: Vec<_> = self
                .data
                .repos
                .iter()
                .filter(|r| r.selected)
                .cloned()
                .collect();
            let mut runs = vec![];
            for repo in selected {
                if metadata_due || !self.data.workflows.iter().any(|w| w.repo_id == repo.id) {
                    let workflows = self.repo_metadata(&repo)?;
                    self.data.workflows.retain(|w| w.repo_id != repo.id);
                    self.data.workflows.extend(workflows);
                }
                let interval = if self
                    .data
                    .runs
                    .iter()
                    .any(|r| r.repo_id == repo.id && r.status != RunStatus::Completed)
                {
                    15
                } else {
                    60
                };
                if now().saturating_sub(*self.poll_at.get(&repo.id).unwrap_or(&0)) < interval {
                    runs.extend(
                        self.data
                            .runs
                            .iter()
                            .filter(|r| r.repo_id == repo.id)
                            .cloned(),
                    );
                    continue;
                }
                let path = [
                    "repos",
                    repo.owner.as_str(),
                    repo.name.as_str(),
                    "actions",
                    "runs",
                ];
                let mut values = vec![];
                // Active runs have separate traversals so long-running jobs cannot fall out of recent history.
                for status in ["queued", "in_progress", "waiting", "pending", "requested"] {
                    for page in self.pages(
                        &repo.account_id,
                        &path,
                        &[("per_page", "100"), ("status", status)],
                    )? {
                        values.extend(
                            page["workflow_runs"]
                                .as_array()
                                .ok_or("Run-Liste ungültig.")?
                                .iter()
                                .cloned(),
                        );
                    }
                }
                let response = self
                    .client
                    .execute(
                        &ApiRequest::get(&repo.account_id, url(&path, &[("per_page", "30")])?)
                            .map_err(|e| e.to_string())?,
                        now(),
                    )
                    .map_err(|e| e.to_string())?;
                if response.status != 200 {
                    return Err(format!("GitHub returned HTTP {}.", response.status));
                }
                let recent: Value =
                    serde_json::from_slice(&response.body).map_err(|_| "Run-Liste ungültig.")?;
                values.extend(
                    recent["workflow_runs"]
                        .as_array()
                        .ok_or("Run-Liste ungültig.")?
                        .iter()
                        .cloned(),
                );
                let mut seen = BTreeSet::new();
                for value in values {
                    let run = parse_run(&repo.id, &value)?;
                    if seen.insert(run.id) {
                        runs.push(run);
                    }
                }
                self.poll_at.insert(repo.id.clone(), now());
            }
            let mut completed = vec![];
            for (id, tracker) in &self.tracked {
                if !self
                    .data
                    .repos
                    .iter()
                    .any(|repo| repo.id == tracker.repo_id && repo.selected)
                {
                    continue;
                }
                if let Ok(response) = self
                    .client
                    .execute(&tracker.request().map_err(|e| e.to_string())?, now())
                {
                    if let Ok(run) = tracker.parse(&response) {
                        if run.status == RunStatus::Completed {
                            completed.push(*id);
                        }
                        runs.retain(|r| r.id != *id);
                        runs.push(run);
                    }
                }
            }
            for id in completed {
                self.tracked.remove(&id);
            }
            self.data.runs = runs;
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
            self.persist()
        })();
        if let Err(error) = result {
            self.data.stale = true;
            self.data.connectivity = if error.contains("401") || error.contains("403") {
                Connectivity::Forbidden
            } else {
                Connectivity::Offline
            };
            self.data.message = Some(format!("Letzter Stand · {error}"));
        }
        self.snapshot()
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
            repo.selected = ids.contains(&repo.id);
        }
        self.poll_at.clear();
        self.persist()?;
        Ok(self.refresh())
    }
    pub fn save_pin(&mut self, pin: Pin) -> Result<Snapshot, String> {
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
        self.cache
            .save_pin(&pin.account_id, &pin)
            .map_err(|e| e.to_string())?;
        self.data.pins.retain(|p| p.id != pin.id);
        self.data.pins.push(pin);
        self.persist()?;
        Ok(self.snapshot())
    }
    pub fn delete_pin(&mut self, id: String) -> Result<Snapshot, String> {
        if let Some(pin) = self.data.pins.iter().find(|p| p.id == id) {
            self.cache
                .delete_pin(&pin.account_id, &id)
                .map_err(|e| e.to_string())?;
        }
        self.data.pins.retain(|p| p.id != id);
        self.persist()?;
        Ok(self.snapshot())
    }
    pub fn dispatch(&mut self, request: DispatchRequest) -> DispatchOutcome {
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
        let checked = (|| -> Result<(Repo, crate::github::ApiRequest, String), String> {
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
            let target =
                serde_json::to_string(&(&repo.account_id, &repo.id, workflow.id, &request.git_ref))
                    .map_err(|_| "Startziel ungültig.")?;
            if !self
                .cache
                .claim_dispatch(&target)
                .map_err(|_| "Startsperre konnte nicht gespeichert werden.")?
            {
                return Err("Start-Status ungeklärt. Erneuter Start dieses Ziels ist gesperrt; prüfe die Runs auf GitHub.".into());
            }
            Ok((repo, api, target))
        })();
        let outcome = match checked {
            Err(error) => DispatchOutcome::rejected(error),
            Ok((repo, api, target)) => {
                let outcome = self.client.dispatch(&api, &repo.owner, &repo.name, now());
                if outcome.state != DispatchState::Uncertain {
                    let _ = self.cache.resolve_dispatch(&target);
                }
                if outcome.state == DispatchState::Accepted {
                    if let (Some(id), Some(html_url)) = (outcome.run_id, outcome.html_url.as_ref())
                    {
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
        };
        self.outcomes
            .insert(request.request_id, (fingerprint, outcome.clone()));
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
fn parse_run(repo: &str, value: &Value) -> Result<Run, String> {
    Ok(Run {
        id: number(value, "id")?,
        repo_id: repo.into(),
        workflow_id: number(value, "workflow_id")?,
        name: text(value, "name")?.into(),
        branch: value["head_branch"].as_str().unwrap_or("").into(),
        status: match value["status"].as_str() {
            Some("completed") => RunStatus::Completed,
            Some("in_progress") => RunStatus::InProgress,
            Some("waiting" | "pending" | "requested") => RunStatus::Waiting,
            _ => RunStatus::Queued,
        },
        conclusion: match value["conclusion"].as_str() {
            Some("success") => Some(Conclusion::Success),
            Some("failure" | "timed_out" | "action_required" | "startup_failure") => {
                Some(Conclusion::Failure)
            }
            Some("cancelled" | "skipped" | "neutral" | "stale") => Some(Conclusion::Cancelled),
            _ => None,
        },
        created_at: text(value, "created_at")?.into(),
        updated_at: text(value, "updated_at")?.into(),
        html_url: text(value, "html_url")?.into(),
    })
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
