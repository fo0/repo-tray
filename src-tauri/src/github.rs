//! HTTP policy and protocol contracts, with an injected transport and no live adapter.
//! The desktop MVP cannot reach GitHub through this module by itself.

use crate::models::{Conclusion, DispatchOutcome, DispatchState, Inputs, Run, RunStatus};
use crate::workflow::{looks_like_credential, sensitive_key};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::sync::Mutex;

pub const API_VERSION: &str = "2026-03-10";
const API_ORIGIN: &str = "https://api.github.com";
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_PAGES: usize = 20;
/// GitHub's primary rate-limit window; a bogus or skewed header cannot pause an account longer.
const MAX_BACKOFF_SECONDS: u64 = 3600;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct ApiUrl(String);

impl ApiUrl {
    /// An exact HTTPS origin, no userinfo, credentials in queries, fragments, or redirects.
    pub fn parse(value: &str) -> Result<Self, ApiError> {
        let path = value
            .strip_prefix("https://api.github.com/")
            .ok_or(ApiError::Policy("Nur https://api.github.com ist erlaubt."))?;
        if value.len() > 2048
            || !value.is_ascii()
            || value.bytes().any(|byte| {
                byte.is_ascii_control() || byte.is_ascii_whitespace() || b"\\#<>\"".contains(&byte)
            })
            || path.starts_with('/')
            || path
                .split('?')
                .next()
                .unwrap_or("")
                .split('/')
                .any(|part| part == "." || part == ".." || part.is_empty())
        {
            return Err(ApiError::Policy("GitHub-API-Adresse ungültig."));
        }
        if let Some((_, query)) = path.split_once('?') {
            for pair in query.split('&') {
                let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
                // Percent-encoded query keys are unnecessary for our API paths and could hide secrets.
                if name.contains('%') || sensitive_key(name) || looks_like_credential(value) {
                    return Err(ApiError::Policy(
                        "Zugangsdaten sind in API-Adressen nicht erlaubt.",
                    ));
                }
            }
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn path(&self) -> &str {
        self.0
            .strip_prefix(API_ORIGIN)
            .unwrap_or("")
            .split('?')
            .next()
            .unwrap_or("")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
}

#[derive(Clone)]
pub struct ApiRequest {
    account_id: String,
    method: Method,
    url: ApiUrl,
    headers: BTreeMap<String, String>,
    body: Option<Vec<u8>>,
}

impl fmt::Debug for ApiRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ApiRequest")
            .field("account_id", &self.account_id)
            .field("method", &self.method)
            .field("url", &self.url)
            .field("body", &self.body.as_ref().map(|_| "[REDACTED]"))
            .finish()
    }
}

impl ApiRequest {
    pub fn get(account_id: &str, url: ApiUrl) -> Result<Self, ApiError> {
        Self::new(account_id, Method::Get, url, None)
    }

    pub fn workflow_dispatch(
        account_id: &str,
        owner: &str,
        repo: &str,
        workflow_id: u64,
        git_ref: &str,
        inputs: &Inputs,
    ) -> Result<Self, ApiError> {
        validate_segment(owner)?;
        validate_segment(repo)?;
        if workflow_id == 0 || git_ref.trim().is_empty() || inputs.len() > 25 {
            return Err(ApiError::Policy("Startdaten des Workflows ungültig."));
        }
        let url = ApiUrl::parse(&format!(
            "{API_ORIGIN}/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches"
        ))?;
        let body = serde_json::to_vec(&serde_json::json!({"ref": git_ref, "inputs": inputs}))
            .map_err(|_| ApiError::InvalidResponse)?;
        if body.len() > 64 * 1024 {
            return Err(ApiError::Policy("Workflow-Eingaben sind zu groß."));
        }
        Self::new(account_id, Method::Post, url, Some(body))
    }

    fn new(
        account_id: &str,
        method: Method,
        url: ApiUrl,
        body: Option<Vec<u8>>,
    ) -> Result<Self, ApiError> {
        if account_id.trim().is_empty()
            || account_id.len() > 256
            || account_id.chars().any(char::is_control)
            || looks_like_credential(account_id)
        {
            return Err(ApiError::Policy("Ein Konto ist erforderlich."));
        }
        let mut headers = BTreeMap::from([
            ("Accept".into(), "application/vnd.github+json".into()),
            ("X-GitHub-Api-Version".into(), API_VERSION.into()),
        ]);
        if body.is_some() {
            headers.insert("Content-Type".into(), "application/json".into());
        }
        Ok(Self {
            account_id: account_id.into(),
            method,
            url,
            headers,
            body,
        })
    }

    pub fn account_id(&self) -> &str {
        &self.account_id
    }

    pub fn method(&self) -> Method {
        self.method
    }

    pub fn url(&self) -> &ApiUrl {
        &self.url
    }

    pub fn headers(&self) -> &BTreeMap<String, String> {
        &self.headers
    }

    pub fn body(&self) -> Option<&[u8]> {
        self.body.as_deref()
    }
}

#[derive(Clone)]
pub struct ApiResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

impl fmt::Debug for ApiResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ApiResponse")
            .field("status", &self.status)
            .field("body_bytes", &self.body.len())
            .finish()
    }
}

impl ApiResponse {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransportError {
    /// Adapter guarantees that no bytes could have reached GitHub.
    BeforeSend,
    /// Timeout, cancelled connection, or any failure after a POST might have been sent.
    OutcomeUnknown,
}

/// A future native adapter must disable redirects and inject credentials outside these types.
/// No concrete network transport is shipped in the demo.
pub trait Transport: Send {
    fn send(&mut self, request: &ApiRequest) -> Result<ApiResponse, TransportError>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ApiError {
    Policy(&'static str),
    Transport(TransportError),
    Http(u16),
    RateLimited { retry_at: u64 },
    InvalidResponse,
    CacheMiss,
    QueueUnavailable,
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Policy(message) => f.write_str(message),
            Self::Transport(_) => f.write_str("GitHub nicht erreichbar – prüfe deine Verbindung."),
            Self::Http(status) => write!(f, "GitHub-Fehler {status}."),
            Self::RateLimited { retry_at } => write!(
                f,
                "GitHub-Limit erreicht – neuer Versuch um {}.",
                local_time(*retry_at)
            ),
            Self::InvalidResponse => f.write_str("GitHub-Antwort ungültig."),
            Self::CacheMiss => f.write_str("GitHub-Antwort passt nicht zum Zwischenspeicher."),
            Self::QueueUnavailable => f.write_str("Anfragewarteschlange nicht verfügbar."),
        }
    }
}

/// `HH:MM` in the user's local time zone; GitHub reports rate-limit resets as UNIX seconds.
pub(crate) fn local_time(timestamp: u64) -> String {
    i64::try_from(timestamp)
        .ok()
        .and_then(|seconds| chrono::DateTime::from_timestamp(seconds, 0))
        .map(|time| {
            time.with_timezone(&chrono::Local)
                .format("%H:%M")
                .to_string()
        })
        .unwrap_or_else(|| "--:--".into())
}

impl std::error::Error for ApiError {}

#[derive(Clone)]
struct CachedPage {
    etag: Option<String>,
    body: Vec<u8>,
    next: Option<ApiUrl>,
}

/// Bodies of one pagination traversal; `truncated` marks a prefix cut at the page budget.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Pages {
    pub bodies: Vec<Vec<u8>>,
    pub truncated: bool,
}

struct ClientState<T> {
    transport: T,
    pages: BTreeMap<(String, ApiUrl), CachedPage>,
    backoff_until: BTreeMap<String, u64>,
    rate_limit_failures: BTreeMap<String, u32>,
}

/// All operations, including a complete pagination traversal, share one serialized queue.
/// Backoff returns a deadline; it never sleeps a UI thread or automatically retries a POST.
pub struct ApiClient<T: Transport> {
    state: Mutex<ClientState<T>>,
}

impl<T: Transport> ApiClient<T> {
    pub fn new(transport: T) -> Self {
        Self {
            state: Mutex::new(ClientState {
                transport,
                pages: BTreeMap::new(),
                backoff_until: BTreeMap::new(),
                rate_limit_failures: BTreeMap::new(),
            }),
        }
    }

    pub fn into_transport(self) -> Result<T, ApiError> {
        self.state
            .into_inner()
            .map(|state| state.transport)
            .map_err(|_| ApiError::QueueUnavailable)
    }

    pub fn execute(&self, request: &ApiRequest, now: u64) -> Result<ApiResponse, ApiError> {
        let mut state = self.state.lock().map_err(|_| ApiError::QueueUnavailable)?;
        send_once(&mut state, request, now)
    }

    /// A GET whose throttling answer (a 403/429 that armed a backoff) surfaces as `RateLimited`,
    /// so callers never mistake a rate limit for missing access. Other statuses stay `Ok`.
    pub fn get(&self, request: &ApiRequest, now: u64) -> Result<ApiResponse, ApiError> {
        if request.method != Method::Get {
            return Err(ApiError::Policy("Nur GET-Anfragen sind hier erlaubt."));
        }
        let mut state = self.state.lock().map_err(|_| ApiError::QueueUnavailable)?;
        let response = send_once(&mut state, request, now)?;
        match throttled(&state, &request.account_id, response.status, now) {
            Some(error) => Err(error),
            None => Ok(response),
        }
    }

    /// Each page has its own account-scoped ETag and cached body, including its next link.
    /// A listing longer than the page budget returns its first pages instead of failing.
    pub fn get_pages(
        &self,
        account_id: &str,
        first: ApiUrl,
        now: u64,
    ) -> Result<Vec<Vec<u8>>, ApiError> {
        self.traverse(account_id, first, now, true, MAX_PAGES)
            .map(|pages| pages.bodies)
    }

    /// `get_pages` with a smaller page budget; `truncated` reports a cut-off listing.
    pub fn get_pages_limited(
        &self,
        account_id: &str,
        first: ApiUrl,
        now: u64,
        max_pages: usize,
    ) -> Result<Pages, ApiError> {
        self.traverse(account_id, first, now, true, max_pages.clamp(1, MAX_PAGES))
    }

    /// Moving discovery windows have unique URLs; retaining their pages would grow without bound.
    #[cfg(feature = "network")]
    pub(crate) fn get_pages_uncached(
        &self,
        account_id: &str,
        first: ApiUrl,
        now: u64,
    ) -> Result<Vec<Vec<u8>>, ApiError> {
        self.traverse(account_id, first, now, false, MAX_PAGES)
            .map(|pages| pages.bodies)
    }

    fn traverse(
        &self,
        account_id: &str,
        first: ApiUrl,
        now: u64,
        cache: bool,
        max_pages: usize,
    ) -> Result<Pages, ApiError> {
        let mut state = self.state.lock().map_err(|_| ApiError::QueueUnavailable)?;
        let first_path = first.path().to_owned();
        let mut next = Some(first);
        let mut seen = BTreeSet::new();
        let mut pages = Pages::default();
        while let Some(url) = next {
            if pages.bodies.len() >= max_pages {
                pages.truncated = true;
                break;
            }
            if !seen.insert(url.clone()) || url.path() != first_path {
                return Err(ApiError::Policy(
                    "GitHub-Seitenfolge verlässt die angefragte Ressource.",
                ));
            }
            let key = (account_id.to_owned(), url.clone());
            let cached = if cache {
                state.pages.get(&key).cloned()
            } else {
                None
            };
            let mut request = ApiRequest::get(account_id, url)?;
            if let Some(etag) = cached.as_ref().and_then(|cached| cached.etag.as_ref()) {
                request.headers.insert("If-None-Match".into(), etag.clone());
            }
            let response = send_once(&mut state, &request, now)?;
            let page = match response.status {
                200 => CachedPage {
                    etag: checked_etag(response.header("etag"))?,
                    next: next_page(response.header("link"))?,
                    body: response.body,
                },
                304 => {
                    let mut page = cached.ok_or(ApiError::CacheMiss)?;
                    if let Some(link) = response.header("link") {
                        page.next = next_page(Some(link))?;
                    }
                    if response.header("etag").is_some() {
                        page.etag = checked_etag(response.header("etag"))?;
                    }
                    page
                }
                status => {
                    return Err(throttled(&state, account_id, status, now)
                        .unwrap_or(ApiError::Http(status)))
                }
            };
            if page
                .next
                .as_ref()
                .is_some_and(|next| next.path() != first_path)
            {
                return Err(ApiError::Policy(
                    "GitHub-Seitenfolge wechselt die Ressource.",
                ));
            }
            next = page.next.clone();
            pages.bodies.push(page.body.clone());
            if cache {
                state.pages.insert(key, page);
            }
        }
        Ok(pages)
    }

    /// The caller validates workflow eligibility and inputs before constructing this request.
    /// Exactly one transport call is permitted. A lost response is never treated as success.
    pub fn dispatch(
        &self,
        request: &ApiRequest,
        owner: &str,
        repo: &str,
        now: u64,
    ) -> DispatchOutcome {
        if request.method != Method::Post {
            return DispatchOutcome::rejected("Ein Start braucht eine POST-Anfrage.");
        }
        match self.execute(request, now) {
            Ok(response) => match parse_dispatch_confirmation(&response, owner, repo) {
                Ok(confirmation) => DispatchOutcome {
                    state: DispatchState::Accepted,
                    run_id: Some(confirmation.workflow_run_id),
                    html_url: Some(confirmation.html_url),
                    message: format!(
                        "GitHub hat den Start angenommen (Run #{}). Das ist keine Build-Erfolgsmeldung.",
                        confirmation.workflow_run_id
                    ),
                },
                Err(_) if matches!(response.status, 400 | 401 | 403 | 404 | 422 | 429) => {
                    DispatchOutcome::rejected(format!(
                        "GitHub hat den Start abgelehnt (HTTP {}). Es wurde nichts gestartet.",
                        response.status
                    ))
                }
                Err(_) => DispatchOutcome::uncertain(
                    "GitHub hat keine Run-ID bestätigt. Prüfe die Runs auf GitHub, bevor du erneut startest.",
                ),
            },
            Err(ApiError::Transport(TransportError::OutcomeUnknown)) => DispatchOutcome::uncertain(
                "Der Start hat GitHub möglicherweise erreicht. Prüfe die Runs auf GitHub, bevor du es erneut versuchst.",
            ),
            Err(ApiError::InvalidResponse) => DispatchOutcome::uncertain(
                "Die Antwort auf den Start ließ sich nicht prüfen. Es gibt keinen automatischen neuen Versuch.",
            ),
            Err(error) => DispatchOutcome::rejected(error.to_string()),
        }
    }
}

fn send_once<T: Transport>(
    state: &mut ClientState<T>,
    request: &ApiRequest,
    now: u64,
) -> Result<ApiResponse, ApiError> {
    if let Some(retry_at) = state.backoff_until.get(&request.account_id) {
        if *retry_at > now {
            return Err(ApiError::RateLimited {
                retry_at: *retry_at,
            });
        }
    }
    let response = state.transport.send(request).map_err(ApiError::Transport)?;
    if response.body.len() > MAX_RESPONSE_BYTES {
        return Err(ApiError::InvalidResponse);
    }
    let primary_exhausted = response.header("x-ratelimit-remaining") == Some("0");
    let secondary = response.status == 429
        || (response.status == 403
            && (response.header("retry-after").is_some()
                || String::from_utf8_lossy(&response.body)
                    .to_ascii_lowercase()
                    .contains("secondary rate limit")));
    // An absolute deadline at or before `now` (a local clock ahead of GitHub's) falls back to
    // the escalating delay; a deadline of now+1 would meet the exhausted quota on every refresh.
    let retry_after = response.header("retry-after").and_then(|value| {
        value
            .trim()
            .parse::<u64>()
            .ok()
            .map(|seconds| now.saturating_add(seconds))
            .or_else(|| {
                chrono::DateTime::parse_from_rfc2822(value)
                    .ok()
                    .and_then(|time| u64::try_from(time.timestamp()).ok())
                    .filter(|deadline| *deadline > now)
            })
    });
    let reset = response
        .header("x-ratelimit-reset")
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|reset| *reset > now);
    let succeeded = (200..300).contains(&response.status) || response.status == 304;
    if primary_exhausted || secondary || retry_after.is_some() {
        // Only failed requests escalate the fallback; a 2xx that spent the last unit does not.
        let failures = if succeeded {
            state.rate_limit_failures.remove(&request.account_id);
            0
        } else {
            let failures = state
                .rate_limit_failures
                .entry(request.account_id.clone())
                .or_default();
            let previous = *failures;
            *failures = failures.saturating_add(1);
            previous
        };
        let fallback = now.saturating_add(60u64.saturating_mul(1 << failures.min(4)));
        let until = retry_after
            .into_iter()
            .chain(primary_exhausted.then_some(reset).flatten())
            .max()
            .unwrap_or(fallback)
            .max(now.saturating_add(1))
            .min(now.saturating_add(MAX_BACKOFF_SECONDS));
        state
            .backoff_until
            .insert(request.account_id.clone(), until);
    } else if succeeded {
        state.rate_limit_failures.remove(&request.account_id);
        state.backoff_until.remove(&request.account_id);
    }
    Ok(response)
}

/// A 403/429 that armed this account's backoff is throttling, not an access decision.
fn throttled<T>(
    state: &ClientState<T>,
    account_id: &str,
    status: u16,
    now: u64,
) -> Option<ApiError> {
    if !matches!(status, 403 | 429) {
        return None;
    }
    state
        .backoff_until
        .get(account_id)
        .filter(|retry_at| **retry_at > now)
        .map(|retry_at| ApiError::RateLimited {
            retry_at: *retry_at,
        })
}

fn checked_etag(value: Option<&str>) -> Result<Option<String>, ApiError> {
    if value.is_some_and(|value| {
        value.len() > 512 || value.chars().any(char::is_control) || looks_like_credential(value)
    }) {
        return Err(ApiError::InvalidResponse);
    }
    Ok(value.map(str::to_owned))
}

fn next_page(link: Option<&str>) -> Result<Option<ApiUrl>, ApiError> {
    let mut next = None;
    for part in link.unwrap_or("").split(',') {
        let Some((target, parameters)) = part.trim().split_once(';') else {
            continue;
        };
        let is_next = parameters.split(';').any(|parameter| {
            parameter.trim().strip_prefix("rel=").is_some_and(|rel| {
                rel.trim_matches('"')
                    .split_ascii_whitespace()
                    .any(|rel| rel == "next")
            })
        });
        if is_next {
            if next.is_some() {
                return Err(ApiError::InvalidResponse);
            }
            let url = target
                .trim()
                .strip_prefix('<')
                .and_then(|url| url.strip_suffix('>'))
                .ok_or(ApiError::InvalidResponse)?;
            next = Some(ApiUrl::parse(url)?);
        }
    }
    Ok(next)
}

fn validate_segment(value: &str) -> Result<(), ApiError> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.len() > 100
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
    {
        return Err(ApiError::Policy("Owner oder Repository-Name ungültig."));
    }
    Ok(())
}

/// GitHub's API 2026-03-10 contract: HTTP 200 with an explicit run ID and both URLs.
/// Source: https://docs.github.com/en/rest/actions/workflows?apiVersion=2026-03-10#create-a-workflow-dispatch-event
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DispatchConfirmation {
    pub workflow_run_id: u64,
    pub run_url: ApiUrl,
    pub html_url: String,
}

pub fn parse_dispatch_confirmation(
    response: &ApiResponse,
    owner: &str,
    repo: &str,
) -> Result<DispatchConfirmation, ApiError> {
    validate_segment(owner)?;
    validate_segment(repo)?;
    if response.status != 200 || response.body.len() > MAX_RESPONSE_BYTES {
        return Err(ApiError::InvalidResponse);
    }
    #[derive(Deserialize)]
    struct WireConfirmation {
        workflow_run_id: u64,
        run_url: String,
        html_url: String,
    }
    let wire: WireConfirmation =
        serde_json::from_slice(&response.body).map_err(|_| ApiError::InvalidResponse)?;
    let expected_path = format!(
        "/repos/{owner}/{repo}/actions/runs/{}",
        wire.workflow_run_id
    );
    let run_url = ApiUrl::parse(&wire.run_url)?;
    if wire.workflow_run_id == 0
        || run_url.as_str() != format!("{API_ORIGIN}{expected_path}")
        || wire.html_url
            != format!(
                "https://github.com/{owner}/{repo}/actions/runs/{}",
                wire.workflow_run_id
            )
    {
        return Err(ApiError::InvalidResponse);
    }
    Ok(DispatchConfirmation {
        workflow_run_id: wire.workflow_run_id,
        run_url,
        html_url: wire.html_url,
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunTracker {
    pub account_id: String,
    pub repo_id: String,
    pub workflow_id: u64,
    pub confirmation: DispatchConfirmation,
}

impl RunTracker {
    pub fn request(&self) -> Result<ApiRequest, ApiError> {
        ApiRequest::get(&self.account_id, self.confirmation.run_url.clone())
    }

    pub fn parse(&self, response: &ApiResponse) -> Result<Run, ApiError> {
        if response.status != 200 || response.body.len() > MAX_RESPONSE_BYTES {
            return Err(ApiError::InvalidResponse);
        }
        let value: serde_json::Value =
            serde_json::from_slice(&response.body).map_err(|_| ApiError::InvalidResponse)?;
        let run = run_from_wire(&self.repo_id, &value)?;
        if run.id != self.confirmation.workflow_run_id
            || run.workflow_id != self.workflow_id
            || run.html_url != self.confirmation.html_url
        {
            return Err(ApiError::InvalidResponse);
        }
        Ok(run)
    }
}

/// A single-resource lookup that GitHub answers with "not found" or "gone": the run was
/// deleted (retention, cleanup) and can never complete, so it leaves tracking.
pub fn resource_gone(status: u16) -> bool {
    matches!(status, 404 | 410)
}

/// The one wire-to-`Run` conversion for run lists, history resolution and dispatch tracking.
/// Future wire values never fail a refresh or keep a finished run open: a conclusion makes
/// the run terminal even under an unknown status, and an unknown conclusion still completes
/// the run, unclassified. An unknown status without a conclusion stays open (queued).
pub fn run_from_wire(repo_id: &str, value: &serde_json::Value) -> Result<Run, ApiError> {
    let id = value["id"].as_u64().filter(|id| *id > 0);
    let workflow_id = value["workflow_id"].as_u64().filter(|id| *id > 0);
    let (Some(id), Some(workflow_id)) = (id, workflow_id) else {
        return Err(ApiError::InvalidResponse);
    };
    let text = |key: &str| value[key].as_str().ok_or(ApiError::InvalidResponse);
    let (created_at, updated_at, html_url) =
        (text("created_at")?, text("updated_at")?, text("html_url")?);
    if chrono::DateTime::parse_from_rfc3339(created_at).is_err()
        || chrono::DateTime::parse_from_rfc3339(updated_at).is_err()
    {
        return Err(ApiError::InvalidResponse);
    }
    let concluded = value["conclusion"].as_str();
    let status = match value["status"].as_str() {
        Some("completed") => RunStatus::Completed,
        Some("in_progress") => RunStatus::InProgress,
        // Requested runs are about to enter the queue.
        Some("queued" | "requested") => RunStatus::Queued,
        // Pending waits for a concurrency group, waiting for a protection rule.
        Some("waiting" | "pending") => RunStatus::Waiting,
        _ if concluded.is_some() => RunStatus::Completed,
        _ => RunStatus::Queued,
    };
    let conclusion = match concluded.filter(|_| status == RunStatus::Completed) {
        Some("success") => Some(Conclusion::Success),
        Some("failure" | "timed_out" | "action_required" | "startup_failure") => {
            Some(Conclusion::Failure)
        }
        Some("cancelled" | "skipped" | "neutral" | "stale") => Some(Conclusion::Cancelled),
        _ => None,
    };
    Ok(Run {
        id,
        repo_id: repo_id.into(),
        workflow_id,
        // The REST schema allows a null run name; the commit title is the next best label.
        name: value["name"]
            .as_str()
            .or_else(|| value["display_title"].as_str())
            .unwrap_or_default()
            .into(),
        branch: value["head_branch"].as_str().unwrap_or_default().into(),
        status,
        conclusion,
        created_at: created_at.into(),
        updated_at: updated_at.into(),
        html_url: html_url.into(),
    })
}

#[cfg(test)]
mod tests;
