//! Native authenticated GitHub access. Secrets never enter Snapshot or the metadata cache.
//!
//! `LiveStore` is the native engine; its behavior is split by concern:
//! `transport` (HTTPS and vault-backed bearer tokens), `connect` (adding and removing
//! accounts), `refresh` (catalog, metadata and run orchestration), `schedule` (per-scope
//! refresh timers), `catalog` (repository and ref listings) and `dispatch` (claimed,
//! exactly-once workflow starts).
use crate::{
    auth::NativeKeyring,
    cache::{AppSettings, Cache, CacheError},
    github::{ApiClient, ApiError, ApiUrl, Transport},
    models::*,
    workflow::{parse_workflow_yaml, validate_non_secret_inputs},
};
use base64::Engine as _;
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

mod catalog;
mod connect;
mod dispatch;
mod refresh;
mod schedule;
mod transport;

use schedule::Schedule;
pub use transport::HttpTransport;

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
/// The controls it names sit at the end of the Repositories page (`ReposPage.svelte`).
const BROWSER_SETUP_NOTICE: &str =
    "Keine Repositories freigegeben – unter Repositories die Freigabe auf GitHub ändern.";

const PIN_CREDENTIAL_REFUSED: &str =
    "Namen oder Werte, die wie Zugangsdaten aussehen, werden nicht gespeichert.";
const PIN_TOO_LARGE: &str = "Favorit ist zu groß zum Speichern – kürze seine Eingaben.";
const PIN_SAVE_FAILED: &str = "Favorit konnte nicht lokal gespeichert werden. Versuche es erneut.";
const PIN_DELETE_FAILED: &str = "Favorit konnte nicht lokal entfernt werden. Versuche es erneut.";

/// The panel text for a favorite the cache refused. `CacheError` text is internal English;
/// after the store's own checks (input limits included), a refused value can only be a
/// credential-looking string, and an oversized entry is named as such.
fn pin_save_error(error: CacheError) -> String {
    match error {
        CacheError::Invalid(_) => PIN_CREDENTIAL_REFUSED,
        CacheError::TooLarge => PIN_TOO_LARGE,
        CacheError::Database(_) | CacheError::Serialization(_) => PIN_SAVE_FAILED,
    }
    .into()
}

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
    ) -> Result<Vec<Value>, ApiError> {
        let url = url(path, query).map_err(|_| ApiError::Policy("API-Adresse ungültig."))?;
        self.client
            .get_pages(account, url, (self.clock)())?
            .iter()
            .map(|body| serde_json::from_slice(body).map_err(|_| ApiError::InvalidResponse))
            .collect()
    }
    fn one(&self, account: &str, path: &[&str], query: &[(&str, &str)]) -> Result<Value, ApiError> {
        self.pages(account, path, query)?
            .into_iter()
            .next()
            .ok_or(ApiError::InvalidResponse)
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
        let value = self
            .one(&repo.account_id, &segments, &[("ref", git_ref)])
            .map_err(|error| match error {
                // Dispatch reads the default branch first; a 404 at another ref means that
                // branch or tag is gone or does not contain the workflow file.
                ApiError::Http(404) if git_ref != repo.default_branch => format!(
                    "Workflow auf „{git_ref}“ nicht gefunden – der Branch oder Tag fehlt oder enthält den Workflow nicht."
                ),
                other => other.to_string(),
            })?;
        if value["encoding"] != "base64" {
            return Err("Workflow-Inhalt ungültig.".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(text(&value, "content")?.replace(['\n', '\r'], ""))
            .map_err(|_| "Workflow-Inhalt ungültig.")?;
        parse_workflow_yaml(std::str::from_utf8(&bytes).map_err(|_| "Workflow ist kein UTF-8.")?)
            .map_err(|e| e.to_string())
    }
    /// Pins have their own cache table, so saving or deleting one never rewrites the snapshot.
    pub fn save_pin(&mut self, pin: Pin) -> Result<Snapshot, String> {
        validate_pin_fields(&pin)?;
        check_pin_room(&self.data.pins, &pin.id)?;
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
            return Err("Favorit passt nicht zum Konto oder Repository.".into());
        }
        if self
            .data
            .pins
            .iter()
            .any(|p| p.id == pin.id && p.account_id != pin.account_id)
        {
            return Err("Ein Favorit kann nicht in ein anderes Konto verschoben werden.".into());
        }
        self.cache
            .save_pin(&pin.account_id, &pin)
            .map_err(pin_save_error)?;
        self.data.pins.retain(|p| p.id != pin.id);
        self.data.pins.push(pin);
        Ok(self.snapshot())
    }
    pub fn delete_pin(&mut self, id: String) -> Result<Snapshot, String> {
        if let Some(pin) = self.data.pins.iter().find(|p| p.id == id) {
            self.cache
                .delete_pin(&pin.account_id, &id)
                .map_err(|_| PIN_DELETE_FAILED)?;
        }
        self.data.pins.retain(|p| p.id != id);
        Ok(self.snapshot())
    }
}

#[cfg(test)]
mod tests;
