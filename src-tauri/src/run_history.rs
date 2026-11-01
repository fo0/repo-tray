//! Seed history once; discover open runs and follow them only until completion.
//! Every repository refreshes on its own: a failing one keeps its last known runs.
use crate::{
    auth::CredentialError,
    github::{
        local_time, resource_gone, run_from_wire, ApiClient, ApiError, ApiRequest, RunTracker,
        Transport, TransportError,
    },
    live::url,
    models::{Repo, Run, RunStatus},
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) const COMPLETED_LIMIT: usize = 50;

/// What went wrong in one scope, kept structured so the panel can name it in German for
/// the right account or repository.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Cause {
    Http(u16),
    RateLimited {
        retry_at: u64,
    },
    /// No answer from GitHub: network, TLS or timeout.
    Unreachable,
    /// Already user-facing German text, such as a malformed response or an unusable credential.
    Text(String),
    /// The vault holds no credential for the account; nothing was sent.
    MissingCredential,
    /// The vault could not be read; nothing was sent.
    VaultUnavailable,
    /// A listing that must be complete exceeded the page budget.
    Truncated,
}

/// Why one refresh scope (an account or a repository) failed. That scope keeps its last
/// known state while the others stay fresh.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ScopeError {
    /// 403/404/410 on a repository endpoint: that repository's Actions are not reachable.
    Denied(Cause),
    /// 401, or a credential that is missing, unreadable or unusable: the whole account needs
    /// attention.
    Unauthorized(Cause),
    /// Network, rate limit, server or malformed responses: retried on a later refresh.
    Transient(Cause),
}

impl ScopeError {
    /// Account-wide endpoints have no narrower scope; a denial there concerns the account.
    pub(crate) fn for_account(self) -> Self {
        match self {
            Self::Denied(cause) => Self::Unauthorized(cause),
            other => other,
        }
    }

    /// The German sentence the panel shows. `login` names the account; `repo` is
    /// `owner/name` when the failing scope is a repository.
    pub(crate) fn describe(&self, login: &str, repo: Option<&str>) -> String {
        let scope = repo.unwrap_or(login);
        let (Self::Denied(cause) | Self::Unauthorized(cause) | Self::Transient(cause)) = self;
        match (self, cause) {
            (_, Cause::MissingCredential) => format!(
                "Zugang von {login} fehlt im Tresor – verbinde das Konto neu oder trenne es."
            ),
            (_, Cause::VaultUnavailable) => format!(
                "Betriebssystem-Tresor nicht verfügbar – Zugang von {login} kann nicht gelesen werden."
            ),
            (Self::Unauthorized(_), Cause::Text(text)) => format!("{login}: {text}"),
            (Self::Unauthorized(_), _) => {
                format!("Zugang von {login} abgelaufen oder widerrufen – verbinde das Konto neu.")
            }
            (_, Cause::Http(status)) => format!("GitHub-Fehler {status} bei {scope}."),
            (_, Cause::RateLimited { retry_at }) => format!(
                "GitHub-Limit erreicht – neuer Versuch um {}.",
                local_time(*retry_at)
            ),
            (_, Cause::Unreachable) => "GitHub nicht erreichbar – prüfe deine Verbindung.".into(),
            (_, Cause::Truncated) => format!("Liste von {scope} unvollständig – zu viele Einträge."),
            (_, Cause::Text(text)) => format!("{scope}: {text}"),
        }
    }
}

impl From<ApiError> for ScopeError {
    fn from(error: ApiError) -> Self {
        match error {
            ApiError::Http(401) => Self::Unauthorized(Cause::Http(401)),
            ApiError::Http(status @ (403 | 404 | 410)) => Self::Denied(Cause::Http(status)),
            ApiError::Http(status) => Self::Transient(Cause::Http(status)),
            ApiError::RateLimited { retry_at } => Self::Transient(Cause::RateLimited { retry_at }),
            ApiError::Transport(TransportError::NoCredential) => {
                Self::Unauthorized(Cause::MissingCredential)
            }
            ApiError::Transport(TransportError::VaultUnavailable) => {
                Self::Unauthorized(Cause::VaultUnavailable)
            }
            ApiError::Transport(_) => Self::Transient(Cause::Unreachable),
            ApiError::Truncated => Self::Transient(Cause::Truncated),
            other => Self::Transient(Cause::Text(other.to_string())),
        }
    }
}

/// A credential that cannot be used holds the account; nothing reached GitHub.
impl From<CredentialError> for ScopeError {
    fn from(error: CredentialError) -> Self {
        Self::Unauthorized(match error {
            CredentialError::Missing => Cause::MissingCredential,
            CredentialError::VaultUnavailable => Cause::VaultUnavailable,
            CredentialError::Unusable(text) => Cause::Text(text),
        })
    }
}

impl From<String> for ScopeError {
    fn from(message: String) -> Self {
        Self::Transient(Cause::Text(message))
    }
}

impl From<&str> for ScopeError {
    fn from(message: &str) -> Self {
        Self::Transient(Cause::Text(message.into()))
    }
}

pub(crate) fn refresh_repo_runs<T: Transport>(
    client: &ApiClient<T>,
    repo: &Repo,
    previous: &[Run],
    since: Option<u64>,
    now: u64,
) -> Result<Vec<Run>, ScopeError> {
    let path = ["repos", &repo.owner, &repo.name, "actions", "runs"];
    let mut fresh = BTreeMap::new();
    // Separate active traversals keep long-running jobs outside the recent page visible.
    for status in ["queued", "in_progress", "waiting", "pending", "requested"] {
        for body in client.get_pages(
            &repo.account_id,
            url(&path, &[("per_page", "100"), ("status", status)])?,
            now,
        )? {
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
        for body in client.get_pages_uncached(
            &repo.account_id,
            url(&path, &[("per_page", "100"), ("created", &created)])?,
            now,
        )? {
            for run in parse_list(&repo.id, &body)? {
                fresh.entry(run.id).or_insert(run);
            }
        }
    } else {
        let response = client.get(
            &ApiRequest::get(&repo.account_id, url(&path, &[("per_page", "50")])?)?,
            now,
        )?;
        if response.status != 200 {
            return Err(ApiError::Http(response.status).into());
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
    // never guess an outcome from its absence. Only an explicit 404/410 drops it.
    let mut gone = vec![];
    for run in history.values() {
        if run.status == RunStatus::Completed || fresh.contains_key(&run.id) {
            continue;
        }
        let id = run.id.to_string();
        let response = client.get(
            &ApiRequest::get(
                &repo.account_id,
                url(
                    &["repos", &repo.owner, &repo.name, "actions", "runs", &id],
                    &[],
                )?,
            )?,
            now,
        )?;
        if resource_gone(response.status) {
            // Deleted by retention or cleanup: it can never complete, so it leaves tracking.
            gone.push(run.id);
            continue;
        }
        if response.status != 200 {
            return Err(ApiError::Http(response.status).into());
        }
        let value: Value =
            serde_json::from_slice(&response.body).map_err(|_| "Run-Antwort ungültig.")?;
        let updated = run_from_wire(&repo.id, &value)?;
        if updated.id != run.id || updated.workflow_id != run.workflow_id {
            return Err("Run-Antwort passt nicht zur Anfrage.".into());
        }
        fresh.insert(updated.id, updated);
    }
    for id in gone {
        history.remove(&id);
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

fn parse_list(repo_id: &str, body: &[u8]) -> Result<Vec<Run>, ScopeError> {
    let page: Value = serde_json::from_slice(body).map_err(|_| "Run-Liste ungültig.")?;
    page["workflow_runs"]
        .as_array()
        .ok_or("Run-Liste ungültig.")?
        .iter()
        .map(|value| run_from_wire(repo_id, value).map_err(ScopeError::from))
        .collect()
}

/// One pass over the repositories that may be polled now.
#[derive(Debug, Default)]
pub(crate) struct RunsRefresh {
    pub runs: Vec<Run>,
    /// Repositories polled successfully, with the time that opens their next discovery window.
    pub polled: Vec<(String, u64)>,
    pub failures: Vec<(Repo, ScopeError)>,
}

/// Polls each due repository on its own. A failing repository keeps its last known runs and
/// is retried on the next refresh; an unauthorized account skips its remaining repositories.
pub(crate) fn refresh_selected<T: Transport>(
    client: &ApiClient<T>,
    repos: &[Repo],
    previous: &[Run],
    poll_at: &BTreeMap<String, u64>,
    history_since: &BTreeMap<String, u64>,
    blocked: &mut BTreeSet<String>,
    now: u64,
) -> RunsRefresh {
    let mut pass = RunsRefresh::default();
    for repo in repos {
        let last = || {
            previous
                .iter()
                .filter(|run| run.repo_id == repo.id)
                .cloned()
        };
        let interval = if last().any(|run| run.status != RunStatus::Completed) {
            15
        } else {
            60
        };
        // A poll time ahead of now means the clock went back: poll now instead of waiting it
        // out, and never open the discovery window in the future.
        let polled_at = poll_at.get(&repo.id).copied().unwrap_or(0);
        let due = now < polled_at || now - polled_at >= interval;
        if !due || blocked.contains(&repo.account_id) {
            pass.runs.extend(last());
            continue;
        }
        let since = history_since.get(&repo.id).map(|since| (*since).min(now));
        match refresh_repo_runs(client, repo, previous, since, now) {
            Ok(runs) => {
                pass.runs.extend(runs);
                pass.polled.push((repo.id.clone(), now));
            }
            Err(error) => {
                if matches!(error, ScopeError::Unauthorized(_)) {
                    blocked.insert(repo.account_id.clone());
                }
                pass.runs.extend(last());
                pass.failures.push((repo.clone(), error));
            }
        }
    }
    pass
}

/// Follows dispatched runs that no repository history lists yet, until they complete.
/// A deleted run (404/410) leaves tracking; any other failure keeps the tracker for the
/// next refresh. Trackers of repositories outside `active` wait without a request.
pub(crate) fn follow_dispatched<T: Transport>(
    client: &ApiClient<T>,
    tracked: &mut BTreeMap<u64, RunTracker>,
    active: &BTreeSet<String>,
    runs: &mut Vec<Run>,
    now: u64,
) {
    tracked.retain(|id, tracker| {
        if !active.contains(&tracker.repo_id) {
            return true;
        }
        if let Some(run) = runs
            .iter()
            .find(|run| run.id == *id && run.repo_id == tracker.repo_id)
        {
            return run.status != RunStatus::Completed;
        }
        // The confirmed run URL was validated on dispatch; a request that cannot be built
        // now can never succeed later.
        let Ok(request) = tracker.request() else {
            return false;
        };
        match client.get(&request, now) {
            Ok(response) if resource_gone(response.status) => false,
            Ok(response) => match tracker.parse(&response) {
                Ok(run) => {
                    let open = run.status != RunStatus::Completed;
                    runs.push(run);
                    open
                }
                Err(_) => true,
            },
            Err(_) => true,
        }
    });
}

#[cfg(test)]
mod tests;
