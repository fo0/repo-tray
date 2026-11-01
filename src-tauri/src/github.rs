//! HTTP policy and protocol contracts, with an injected transport and no live adapter.
//! The desktop MVP cannot reach GitHub through this module by itself.

use crate::auth::{MISSING_CREDENTIAL, VAULT_UNAVAILABLE};
use crate::models::Inputs;
use crate::workflow::{looks_like_credential, sensitive_key};
use std::collections::BTreeMap;
use std::fmt;

mod client;
mod wire;

pub use client::{ApiClient, Pages};
pub use wire::{
    parse_dispatch_confirmation, resource_gone, run_from_wire, DispatchConfirmation, RunTracker,
};

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
    /// Nothing was sent: the vault holds no credential for the account.
    NoCredential,
    /// Nothing was sent: the vault could not be read.
    VaultUnavailable,
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
    RateLimited {
        retry_at: u64,
    },
    InvalidResponse,
    CacheMiss,
    QueueUnavailable,
    /// The listing has more pages than the page budget; a prefix could hide entries.
    Truncated,
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Policy(message) => f.write_str(message),
            Self::Transport(TransportError::NoCredential) => f.write_str(MISSING_CREDENTIAL),
            Self::Transport(TransportError::VaultUnavailable) => write!(
                f,
                "{VAULT_UNAVAILABLE} Der Zugang kann nicht gelesen werden."
            ),
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
            Self::Truncated => f.write_str("GitHub-Liste unvollständig – zu viele Einträge."),
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
#[cfg(test)]
mod tests;
