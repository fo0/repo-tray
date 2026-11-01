//! The serialized request queue: ETag-cached pagination, rate-limit backoff and the
//! exactly-once dispatch call.
use super::{
    parse_dispatch_confirmation, ApiError, ApiRequest, ApiResponse, ApiUrl, Method, Transport,
    TransportError, MAX_BACKOFF_SECONDS, MAX_PAGES, MAX_RESPONSE_BYTES,
};
use crate::models::{DispatchOutcome, DispatchState};
use crate::workflow::looks_like_credential;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

#[derive(Clone)]
pub(super) struct CachedPage {
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

pub(super) struct ClientState<T> {
    transport: T,
    pub(super) pages: BTreeMap<(String, ApiUrl), CachedPage>,
    backoff_until: BTreeMap<String, u64>,
    rate_limit_failures: BTreeMap<String, u32>,
}

/// All operations, including a complete pagination traversal, share one serialized queue.
/// Backoff returns a deadline; it never sleeps a UI thread or automatically retries a POST.
pub struct ApiClient<T: Transport> {
    pub(super) state: Mutex<ClientState<T>>,
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
