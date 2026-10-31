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

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct ApiUrl(String);

impl ApiUrl {
    /// An exact HTTPS origin, no userinfo, credentials in queries, fragments, or redirects.
    pub fn parse(value: &str) -> Result<Self, ApiError> {
        let path = value
            .strip_prefix("https://api.github.com/")
            .ok_or(ApiError::Policy("Only https://api.github.com is allowed."))?;
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
            return Err(ApiError::Policy("Malformed GitHub API URL."));
        }
        if let Some((_, query)) = path.split_once('?') {
            for pair in query.split('&') {
                let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
                // Percent-encoded query keys are unnecessary for our API paths and could hide secrets.
                if name.contains('%') || sensitive_key(name) || looks_like_credential(value) {
                    return Err(ApiError::Policy("Credentials are not allowed in API URLs."));
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
            return Err(ApiError::Policy("Invalid workflow dispatch metadata."));
        }
        let url = ApiUrl::parse(&format!(
            "{API_ORIGIN}/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches"
        ))?;
        let body = serde_json::to_vec(&serde_json::json!({"ref": git_ref, "inputs": inputs}))
            .map_err(|_| ApiError::InvalidResponse)?;
        if body.len() > 64 * 1024 {
            return Err(ApiError::Policy("Dispatch input payload is too large."));
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
            return Err(ApiError::Policy("An account namespace is required."));
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
            Self::Transport(_) => f.write_str("GitHub transport failed."),
            Self::Http(status) => write!(f, "GitHub returned HTTP {status}."),
            Self::RateLimited { retry_at } => {
                write!(f, "GitHub requests are paused until {retry_at}.")
            }
            Self::InvalidResponse => f.write_str("GitHub returned an invalid response."),
            Self::CacheMiss => f.write_str("A conditional response has no cached page."),
            Self::QueueUnavailable => f.write_str("The request queue is unavailable."),
        }
    }
}

impl std::error::Error for ApiError {}

#[derive(Clone)]
struct CachedPage {
    etag: Option<String>,
    body: Vec<u8>,
    next: Option<ApiUrl>,
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

    /// Each page has its own account-scoped ETag and cached body, including its next link.
    pub fn get_pages(
        &self,
        account_id: &str,
        first: ApiUrl,
        now: u64,
    ) -> Result<Vec<Vec<u8>>, ApiError> {
        let mut state = self.state.lock().map_err(|_| ApiError::QueueUnavailable)?;
        let first_path = first.path().to_owned();
        let mut next = Some(first);
        let mut seen = BTreeSet::new();
        let mut pages = vec![];
        while let Some(url) = next {
            if pages.len() >= MAX_PAGES || !seen.insert(url.clone()) || url.path() != first_path {
                return Err(ApiError::Policy(
                    "Pagination exceeded its bounded resource scope.",
                ));
            }
            let key = (account_id.to_owned(), url.clone());
            let cached = state.pages.get(&key).cloned();
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
                status => return Err(ApiError::Http(status)),
            };
            if page
                .next
                .as_ref()
                .is_some_and(|next| next.path() != first_path)
            {
                return Err(ApiError::Policy(
                    "Pagination changed the requested resource.",
                ));
            }
            next = page.next.clone();
            pages.push(page.body.clone());
            state.pages.insert(key, page);
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
            return DispatchOutcome::rejected("A dispatch requires a POST request.");
        }
        match self.execute(request, now) {
            Ok(response) => match parse_dispatch_confirmation(&response, owner, repo) {
                Ok(confirmation) => DispatchOutcome {
                    state: DispatchState::Accepted,
                    run_id: Some(confirmation.workflow_run_id),
                    html_url: Some(confirmation.html_url),
                    message: "GitHub confirmed the workflow run ID.".into(),
                },
                Err(_) if matches!(response.status, 400 | 401 | 403 | 404 | 422 | 429) => {
                    DispatchOutcome::rejected(format!(
                        "GitHub rejected the start (HTTP {}).",
                        response.status
                    ))
                }
                Err(_) => DispatchOutcome::uncertain(
                    "GitHub did not confirm a run ID. Check the run before sending another start.",
                ),
            },
            Err(ApiError::Transport(TransportError::OutcomeUnknown)) => DispatchOutcome::uncertain(
                "The start may have reached GitHub. Check the run before trying again.",
            ),
            Err(ApiError::InvalidResponse) => DispatchOutcome::uncertain(
                "The start response could not be verified. Do not retry automatically.",
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
            })
    });
    let reset = response
        .header("x-ratelimit-reset")
        .and_then(|value| value.parse::<u64>().ok());
    if primary_exhausted || secondary || retry_after.is_some() {
        let failures = state
            .rate_limit_failures
            .entry(request.account_id.clone())
            .or_default();
        let fallback = now.saturating_add(60u64.saturating_mul(1 << (*failures).min(4)));
        *failures = failures.saturating_add(1);
        let until = retry_after
            .into_iter()
            .chain(primary_exhausted.then_some(reset).flatten())
            .max()
            .unwrap_or(fallback)
            .max(now.saturating_add(1));
        state
            .backoff_until
            .insert(request.account_id.clone(), until);
    } else if response.status == 200 || response.status == 304 {
        state.rate_limit_failures.remove(&request.account_id);
        state.backoff_until.remove(&request.account_id);
    }
    Ok(response)
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
        return Err(ApiError::Policy("Invalid repository owner or name."));
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
        #[derive(Deserialize)]
        struct WireRun {
            id: u64,
            workflow_id: u64,
            name: String,
            head_branch: String,
            status: String,
            conclusion: Option<String>,
            created_at: String,
            updated_at: String,
            html_url: String,
        }
        if response.status != 200 || response.body.len() > MAX_RESPONSE_BYTES {
            return Err(ApiError::InvalidResponse);
        }
        let wire: WireRun =
            serde_json::from_slice(&response.body).map_err(|_| ApiError::InvalidResponse)?;
        if wire.id != self.confirmation.workflow_run_id
            || wire.workflow_id != self.workflow_id
            || wire.html_url != self.confirmation.html_url
            || chrono::DateTime::parse_from_rfc3339(&wire.created_at).is_err()
            || chrono::DateTime::parse_from_rfc3339(&wire.updated_at).is_err()
        {
            return Err(ApiError::InvalidResponse);
        }
        let status = match wire.status.as_str() {
            "queued" | "requested" | "pending" => RunStatus::Queued,
            "in_progress" => RunStatus::InProgress,
            "waiting" => RunStatus::Waiting,
            "completed" => RunStatus::Completed,
            _ => return Err(ApiError::InvalidResponse),
        };
        let conclusion = match wire.conclusion.as_deref() {
            None => None,
            Some("success") => Some(Conclusion::Success),
            Some("failure") => Some(Conclusion::Failure),
            Some("cancelled") => Some(Conclusion::Cancelled),
            // A future adapter may extend the UI contract; unknown outcomes stay unclassified.
            Some(_) => return Err(ApiError::InvalidResponse),
        };
        if status != RunStatus::Completed && conclusion.is_some() {
            return Err(ApiError::InvalidResponse);
        }
        Ok(Run {
            id: wire.id,
            repo_id: self.repo_id.clone(),
            workflow_id: wire.workflow_id,
            name: wire.name,
            branch: wire.head_branch,
            status,
            conclusion,
            created_at: wire.created_at,
            updated_at: wire.updated_at,
            html_url: wire.html_url,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    struct FakeTransport {
        responses: VecDeque<Result<ApiResponse, TransportError>>,
        requests: Arc<Mutex<Vec<ApiRequest>>>,
    }

    impl Transport for FakeTransport {
        fn send(&mut self, request: &ApiRequest) -> Result<ApiResponse, TransportError> {
            self.requests.lock().unwrap().push(request.clone());
            self.responses
                .pop_front()
                .expect("unexpected automatic retry")
        }
    }

    fn response(status: u16, headers: &[(&str, &str)], body: &str) -> ApiResponse {
        ApiResponse {
            status,
            headers: headers
                .iter()
                .map(|(name, value)| (name.to_string(), value.to_string()))
                .collect(),
            body: body.as_bytes().to_vec(),
        }
    }

    fn client(
        responses: Vec<Result<ApiResponse, TransportError>>,
    ) -> (ApiClient<FakeTransport>, Arc<Mutex<Vec<ApiRequest>>>) {
        let requests = Arc::new(Mutex::new(vec![]));
        (
            ApiClient::new(FakeTransport {
                responses: responses.into(),
                requests: requests.clone(),
            }),
            requests,
        )
    }

    fn dispatch_request() -> ApiRequest {
        ApiRequest::workflow_dispatch("personal", "octo", "demo", 42, "main", &Inputs::new())
            .unwrap()
    }

    #[test]
    fn rejects_off_origin_urls_and_credentials_without_transport() {
        for value in [
            "http://api.github.com/user",
            "https://api.github.com.evil.example/user",
            "https://api.github.com@evil.example/user",
            "https://api.github.com:443/user",
            "https://api.github.com//evil.example/user",
            "https://api.github.com/user?access_token=hidden",
            "https://api.github.com/user?%74oken=hidden",
            "https://api.github.com/user#fragment",
            "https://api.github.com/repos/../user",
        ] {
            assert!(ApiUrl::parse(value).is_err(), "{value}");
        }
    }

    #[test]
    fn paginates_with_independent_etags_and_reuses_cached_pages_on_304() {
        let first = "https://api.github.com/user/repos?page=1";
        let next = "<https://api.github.com/user/repos?page=2>; rel=\"next\"";
        let (client, sent) = client(vec![
            Ok(response(
                200,
                &[("ETag", "\"page1\""), ("Link", next)],
                "[1]",
            )),
            Ok(response(200, &[("ETag", "\"page2\"")], "[2]")),
            Ok(response(304, &[], "")),
            Ok(response(304, &[], "")),
            Ok(response(200, &[], "[9]")),
        ]);
        let pages = client
            .get_pages("personal", ApiUrl::parse(first).unwrap(), 100)
            .unwrap();
        assert_eq!(pages, vec![b"[1]".to_vec(), b"[2]".to_vec()]);
        assert_eq!(
            client
                .get_pages("personal", ApiUrl::parse(first).unwrap(), 101)
                .unwrap(),
            pages
        );
        client
            .get_pages("work", ApiUrl::parse(first).unwrap(), 102)
            .unwrap();
        let sent = sent.lock().unwrap();
        assert_eq!(sent[2].headers()["If-None-Match"], "\"page1\"");
        assert_eq!(sent[3].headers()["If-None-Match"], "\"page2\"");
        assert!(!sent[4].headers().contains_key("If-None-Match"));
        assert_eq!(sent[0].headers()["X-GitHub-Api-Version"], API_VERSION);
    }

    #[test]
    fn app_installations_and_installation_repositories_follow_all_pages_independently() {
        let (client, sent) = client(vec![
            Ok(response(200, &[("Link", "<https://api.github.com/user/installations?page=2>; rel=\"next\"")], r#"{"installations":[{"id":1}]}"#)),
            Ok(response(200, &[], r#"{"installations":[{"id":2}]}"#)),
            Ok(response(200, &[("Link", "<https://api.github.com/user/installations/1/repositories?page=2>; rel=\"next\"")], r#"{"repositories":[{"id":10}]}"#)),
            Ok(response(200, &[], r#"{"repositories":[{"id":11}]}"#)),
        ]);
        assert_eq!(
            client
                .get_pages(
                    "github-device-42",
                    ApiUrl::parse("https://api.github.com/user/installations?page=1").unwrap(),
                    0
                )
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            client
                .get_pages(
                    "github-device-42",
                    ApiUrl::parse(
                        "https://api.github.com/user/installations/1/repositories?page=1"
                    )
                    .unwrap(),
                    0
                )
                .unwrap()
                .len(),
            2
        );
        assert_eq!(sent.lock().unwrap().len(), 4);
    }

    #[test]
    fn pagination_rejects_foreign_hosts_changed_resources_and_cycles() {
        for link in [
            "<https://evil.example/page2>; rel=\"next\"",
            "<https://api.github.com/user/keys>; rel=\"next\"",
            "<https://api.github.com/user/repos?page=1>; rel=\"next\"",
        ] {
            let (client, sent) = client(vec![Ok(response(200, &[("Link", link)], "[]"))]);
            assert!(client
                .get_pages(
                    "personal",
                    ApiUrl::parse("https://api.github.com/user/repos?page=1").unwrap(),
                    0
                )
                .is_err());
            assert_eq!(sent.lock().unwrap().len(), 1);
        }
    }

    #[test]
    fn rate_limit_backoff_honors_retry_after_and_reset_without_retrying_post() {
        let (client, sent) = client(vec![
            Ok(response(429, &[("Retry-After", "30")], "{}")),
            Ok(response(
                200,
                &[("X-RateLimit-Remaining", "0"), ("X-RateLimit-Reset", "200")],
                "[]",
            )),
            Ok(response(200, &[], "[]")),
        ]);
        assert_eq!(
            client
                .dispatch(&dispatch_request(), "octo", "demo", 100)
                .state,
            DispatchState::Rejected
        );
        let get = ApiRequest::get(
            "personal",
            ApiUrl::parse("https://api.github.com/user").unwrap(),
        )
        .unwrap();
        assert_eq!(
            client.execute(&get, 110).unwrap_err(),
            ApiError::RateLimited { retry_at: 130 }
        );
        assert_eq!(sent.lock().unwrap().len(), 1);
        client.execute(&get, 130).unwrap();
        assert_eq!(
            client.execute(&get, 199).unwrap_err(),
            ApiError::RateLimited { retry_at: 200 }
        );
        client.execute(&get, 200).unwrap();
        assert_eq!(sent.lock().unwrap().len(), 3);
    }

    #[test]
    fn secondary_limit_and_http_date_backoff_differ_from_forbidden_permissions() {
        let http_date = "Sat, 31 Oct 2026 10:01:00 GMT";
        let start = chrono::DateTime::parse_from_rfc2822("Sat, 31 Oct 2026 10:00:00 GMT")
            .unwrap()
            .timestamp() as u64;
        let (client, sent) = client(vec![
            Ok(response(403, &[], r#"{"message":"Forbidden"}"#)),
            Ok(response(
                403,
                &[],
                r#"{"message":"You have exceeded a secondary rate limit."}"#,
            )),
            Ok(response(429, &[("Retry-After", http_date)], "{}")),
        ]);
        let request = ApiRequest::get(
            "personal",
            ApiUrl::parse("https://api.github.com/user").unwrap(),
        )
        .unwrap();
        assert_eq!(client.execute(&request, start).unwrap().status, 403);
        // Ordinary permission denial does not prevent a separate request for the account.
        assert_eq!(client.execute(&request, start).unwrap().status, 403);
        assert_eq!(
            client.execute(&request, start + 1).unwrap_err(),
            ApiError::RateLimited {
                retry_at: start + 60
            }
        );
        let other = ApiRequest::get(
            "work",
            ApiUrl::parse("https://api.github.com/user").unwrap(),
        )
        .unwrap();
        assert_eq!(client.execute(&other, start).unwrap().status, 429);
        assert_eq!(
            client.execute(&other, start + 1).unwrap_err(),
            ApiError::RateLimited {
                retry_at: start + 60
            }
        );
        assert_eq!(sent.lock().unwrap().len(), 3);
    }

    #[test]
    fn accepts_2026_dispatch_response_and_tracks_only_that_run() {
        let confirmation_response = response(
            200,
            &[],
            r#"{"workflow_run_id":77,"run_url":"https://api.github.com/repos/octo/demo/actions/runs/77","html_url":"https://github.com/octo/demo/actions/runs/77"}"#,
        );
        let confirmation =
            parse_dispatch_confirmation(&confirmation_response, "octo", "demo").unwrap();
        let tracker = RunTracker {
            account_id: "personal".into(),
            repo_id: "repo-id".into(),
            workflow_id: 42,
            confirmation,
        };
        assert_eq!(
            tracker.request().unwrap().url().as_str(),
            "https://api.github.com/repos/octo/demo/actions/runs/77"
        );
        let run_response = response(
            200,
            &[],
            r#"{"id":77,"workflow_id":42,"name":"Build","head_branch":"main","status":"completed","conclusion":"success","created_at":"2026-10-31T09:00:00Z","updated_at":"2026-10-31T09:01:00Z","html_url":"https://github.com/octo/demo/actions/runs/77"}"#,
        );
        let run = tracker.parse(&run_response).unwrap();
        assert_eq!(run.id, 77);
        assert_eq!(run.repo_id, "repo-id");
        assert_eq!(run.conclusion, Some(Conclusion::Success));
        let mut wrong = run_response;
        wrong.body = String::from_utf8(wrong.body)
            .unwrap()
            .replace("\"id\":77", "\"id\":78")
            .into_bytes();
        assert!(tracker.parse(&wrong).is_err());
        let (client, sent) = client(vec![Ok(confirmation_response)]);
        assert_eq!(
            client
                .dispatch(&dispatch_request(), "octo", "demo", 0)
                .state,
            DispatchState::Accepted
        );
        assert_eq!(sent.lock().unwrap().len(), 1);
    }

    #[test]
    fn legacy_204_timeout_server_error_and_malformed_200_are_uncertain_never_retried() {
        for result in [
            Ok(response(204, &[], "")),
            Err(TransportError::OutcomeUnknown),
            Ok(response(500, &[], "{}")),
            Ok(response(200, &[], "{}")),
        ] {
            let (client, sent) = client(vec![result]);
            assert_eq!(
                client
                    .dispatch(&dispatch_request(), "octo", "demo", 0)
                    .state,
                DispatchState::Uncertain
            );
            assert_eq!(sent.lock().unwrap().len(), 1);
        }
        let (client, _) = client(vec![Err(TransportError::BeforeSend)]);
        assert_eq!(
            client
                .dispatch(&dispatch_request(), "octo", "demo", 0)
                .state,
            DispatchState::Rejected
        );
    }

    #[test]
    fn central_queue_never_sends_concurrent_requests() {
        struct ConcurrencyTransport {
            active: Arc<AtomicUsize>,
            maximum: Arc<AtomicUsize>,
        }
        impl Transport for ConcurrencyTransport {
            fn send(&mut self, _: &ApiRequest) -> Result<ApiResponse, TransportError> {
                let count = self.active.fetch_add(1, Ordering::SeqCst) + 1;
                self.maximum.fetch_max(count, Ordering::SeqCst);
                std::thread::yield_now();
                self.active.fetch_sub(1, Ordering::SeqCst);
                Ok(response(200, &[], "[]"))
            }
        }
        let maximum = Arc::new(AtomicUsize::new(0));
        let client = Arc::new(ApiClient::new(ConcurrencyTransport {
            active: Arc::new(AtomicUsize::new(0)),
            maximum: maximum.clone(),
        }));
        let threads: Vec<_> = (0..8)
            .map(|index| {
                let client = client.clone();
                std::thread::spawn(move || {
                    let request = ApiRequest::get(
                        &format!("account-{index}"),
                        ApiUrl::parse("https://api.github.com/user").unwrap(),
                    )
                    .unwrap();
                    client.execute(&request, 0).unwrap();
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        assert_eq!(maximum.load(Ordering::SeqCst), 1);
    }
}
