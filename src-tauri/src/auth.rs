//! Native credential adapters and device authorization state machine.
//! The native services verify the account before writing the OS keyring.
//! `browser_auth` performs device-flow HTTP only when publisher configuration is present.

use serde::Serialize;
use std::fmt;

/// Stable app namespace, shared by browser authorization and an optional token sign-in path.
/// The user/entry identifier is derived from the stable account ID, never its display name.
pub const CREDENTIAL_SERVICE: &str = "io.github.fo0.repotray";

#[cfg(feature = "native-credentials")]
pub use native::OsKeyring;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthGate {
    Locked,
}

impl AuthGate {
    pub fn ensure_live_access(self) -> Result<(), AuthError> {
        match self {
            Self::Locked => Err(AuthError::Locked),
        }
    }

    pub fn begin_device_flow(self) -> Result<(), AuthError> {
        self.ensure_live_access()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthError {
    Locked,
    KeyringUnavailable,
    InvalidAuthorization,
    StalePoll,
    NotPending,
}

impl fmt::Display for AuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Locked => "Live authentication is locked in this demo.",
            Self::KeyringUnavailable => "The native credential store is unavailable.",
            Self::InvalidAuthorization => "Device authorization metadata is invalid.",
            Self::StalePoll => {
                "The device authorization response belongs to a cancelled or previous flow."
            }
            Self::NotPending => "There is no active device authorization flow.",
        })
    }
}

impl std::error::Error for AuthError {}

pub const MISSING_CREDENTIAL: &str =
    "Zugang fehlt im Tresor – verbinde das Konto neu oder trenne es.";
pub const VAULT_UNAVAILABLE: &str = "Betriebssystem-Tresor nicht verfügbar.";

/// Why an account's stored credential cannot be used. A missing entry and an unreadable
/// vault are kept apart from each other and from network failures, so neither is retried
/// or labelled as a connection problem.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CredentialError {
    /// The vault answered and holds no entry for the account.
    Missing,
    /// The vault itself could not be read; fail closed.
    VaultUnavailable,
    /// The entry exists but cannot be used; user-facing German text.
    Unusable(String),
}

impl fmt::Display for CredentialError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing => f.write_str(MISSING_CREDENTIAL),
            Self::VaultUnavailable => f.write_str(VAULT_UNAVAILABLE),
            Self::Unusable(text) => f.write_str(text),
        }
    }
}

impl From<String> for CredentialError {
    fn from(text: String) -> Self {
        Self::Unusable(text)
    }
}

impl From<&str> for CredentialError {
    fn from(text: &str) -> Self {
        Self::Unusable(text.into())
    }
}

/// A deliberately non-serializable, non-cloneable secret. Debug never prints its contents.
/// Bytes are overwritten on drop; native adapters must also avoid intermediate log strings.
pub struct SecretToken(Vec<u8>);

impl SecretToken {
    pub fn new(value: String) -> Self {
        Self(value.into_bytes())
    }

    pub fn with_secret<T>(&self, use_secret: impl FnOnce(&str) -> T) -> T {
        use_secret(std::str::from_utf8(&self.0).expect("secret was constructed from a String"))
    }
}

impl fmt::Debug for SecretToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretToken([REDACTED])")
    }
}

impl Drop for SecretToken {
    fn drop(&mut self) {
        self.0.fill(0);
        // Keep the overwrite observable to the optimizer. This is not a substitute for an OS keyring.
        std::hint::black_box(&mut self.0);
    }
}

/// Native Keychain / Credential Manager adapter boundary. Never implement this with SQLite.
pub trait NativeKeyring: Send + Sync {
    fn read_token(&self, account_id: &str) -> Result<Option<SecretToken>, AuthError>;
    fn write_token(&self, account_id: &str, token: &SecretToken) -> Result<(), AuthError>;
    fn delete_token(&self, account_id: &str) -> Result<(), AuthError>;
}

/// Fail closed when no native backend is installed. No in-memory fallback is used in production.
pub struct UnavailableKeyring;

impl NativeKeyring for UnavailableKeyring {
    fn read_token(&self, _: &str) -> Result<Option<SecretToken>, AuthError> {
        Err(AuthError::KeyringUnavailable)
    }

    fn write_token(&self, _: &str, _: &SecretToken) -> Result<(), AuthError> {
        Err(AuthError::KeyringUnavailable)
    }

    fn delete_token(&self, _: &str) -> Result<(), AuthError> {
        Err(AuthError::KeyringUnavailable)
    }
}

pub struct Credentials<K: NativeKeyring> {
    gate: AuthGate,
    backend: K,
}

impl<K: NativeKeyring> Credentials<K> {
    pub fn locked(backend: K) -> Self {
        Self {
            gate: AuthGate::Locked,
            backend,
        }
    }

    pub fn read(&self, account_id: &str) -> Result<Option<SecretToken>, AuthError> {
        self.gate.ensure_live_access()?;
        self.backend.read_token(account_id)
    }

    pub fn write(&self, account_id: &str, token: &SecretToken) -> Result<(), AuthError> {
        self.gate.ensure_live_access()?;
        self.backend.write_token(account_id, token)
    }

    pub fn delete(&self, account_id: &str) -> Result<(), AuthError> {
        self.gate.ensure_live_access()?;
        self.backend.delete_token(account_id)
    }
}

// Compile the same adapter logic against mock entries in core tests. The platform-specific
// dependency and all OS calls remain absent unless native-credentials is explicitly enabled.
#[cfg(any(feature = "native-credentials", test))]
mod native;

/// Pure protocol input. A caller may use synthetic values for tests; it performs no network I/O.
pub struct DeviceAuthorization {
    pub device_code: SecretToken,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum DeviceFlowStatus {
    Idle,
    AwaitingAuthorization {
        #[serde(rename = "userCode")]
        user_code: String,
        #[serde(rename = "verificationUri")]
        verification_uri: String,
        #[serde(rename = "expiresAt")]
        expires_at: u64,
        #[serde(rename = "nextPollAt")]
        next_poll_at: u64,
    },
    Completed,
    Cancelled,
    Expired,
    Denied,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DevicePollResult {
    AuthorizationPending,
    SlowDown,
    Authorized,
    AccessDenied,
    ExpiredToken,
    TransportFailure,
}

/// Opaque identity prevents a late response from reviving a cancelled or replaced flow.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PollTicket {
    generation: u64,
    sequence: u64,
}

struct PendingFlow {
    device_code: SecretToken,
    interval: u64,
    in_flight: Option<PollTicket>,
}

pub struct DeviceFlow {
    status: DeviceFlowStatus,
    pending: Option<PendingFlow>,
    generation: u64,
    sequence: u64,
}

impl Default for DeviceFlow {
    fn default() -> Self {
        Self::new()
    }
}

impl DeviceFlow {
    pub fn new() -> Self {
        Self {
            status: DeviceFlowStatus::Idle,
            pending: None,
            generation: 0,
            sequence: 0,
        }
    }

    /// Load native authorization metadata (or a fixture) into the state machine.
    pub fn start_local(
        &mut self,
        authorization: DeviceAuthorization,
        now: u64,
    ) -> Result<DeviceFlowStatus, AuthError> {
        if authorization.verification_uri != "https://github.com/login/device"
            || authorization.user_code.is_empty()
            || authorization.user_code.len() > 32
            || !authorization
                .user_code
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            || authorization.expires_in == 0
            || authorization.expires_in > 3600
            || authorization.interval == 0
            || authorization.interval > 600
        {
            return Err(AuthError::InvalidAuthorization);
        }
        self.generation = self.generation.wrapping_add(1);
        self.status = DeviceFlowStatus::AwaitingAuthorization {
            user_code: authorization.user_code,
            verification_uri: authorization.verification_uri,
            expires_at: now.saturating_add(authorization.expires_in),
            next_poll_at: now.saturating_add(authorization.interval),
        };
        self.pending = Some(PendingFlow {
            device_code: authorization.device_code,
            interval: authorization.interval,
            in_flight: None,
        });
        Ok(self.status.clone())
    }

    pub fn status(&mut self, now: u64) -> DeviceFlowStatus {
        self.expire(now);
        self.status.clone()
    }

    pub fn cancel(&mut self) -> DeviceFlowStatus {
        self.generation = self.generation.wrapping_add(1);
        self.pending = None;
        self.status = DeviceFlowStatus::Cancelled;
        self.status.clone()
    }

    /// A due poll returns one ticket. Repeated calls while in flight produce no extra poll.
    pub fn next_poll(&mut self, now: u64) -> Result<Option<PollTicket>, AuthError> {
        self.expire(now);
        let DeviceFlowStatus::AwaitingAuthorization { next_poll_at, .. } = &mut self.status else {
            return Err(AuthError::NotPending);
        };
        let pending = self.pending.as_mut().ok_or(AuthError::NotPending)?;
        if pending.in_flight.is_some() || now < *next_poll_at {
            return Ok(None);
        }
        self.sequence = self.sequence.wrapping_add(1);
        let ticket = PollTicket {
            generation: self.generation,
            sequence: self.sequence,
        };
        pending.in_flight = Some(ticket);
        *next_poll_at = now.saturating_add(pending.interval);
        Ok(Some(ticket))
    }

    /// Device codes only cross a native adapter callback, never a serializable status object.
    pub fn with_device_code<T>(
        &mut self,
        ticket: PollTicket,
        now: u64,
        use_code: impl FnOnce(&str) -> T,
    ) -> Result<T, AuthError> {
        self.expire(now);
        let pending = self.pending.as_ref().ok_or(AuthError::StalePoll)?;
        if ticket.generation != self.generation || pending.in_flight != Some(ticket) {
            return Err(AuthError::StalePoll);
        }
        Ok(pending.device_code.with_secret(use_code))
    }

    pub fn apply_poll(
        &mut self,
        ticket: PollTicket,
        result: DevicePollResult,
        now: u64,
    ) -> Result<DeviceFlowStatus, AuthError> {
        self.expire(now);
        let pending = self.pending.as_mut().ok_or(AuthError::StalePoll)?;
        if ticket.generation != self.generation || pending.in_flight != Some(ticket) {
            return Err(AuthError::StalePoll);
        }
        pending.in_flight = None;
        match result {
            DevicePollResult::TransportFailure => {
                pending.interval = pending.interval.saturating_mul(2);
                if let DeviceFlowStatus::AwaitingAuthorization { next_poll_at, .. } =
                    &mut self.status
                {
                    *next_poll_at = now.saturating_add(pending.interval);
                }
            }
            DevicePollResult::AuthorizationPending => {
                if let DeviceFlowStatus::AwaitingAuthorization { next_poll_at, .. } =
                    &mut self.status
                {
                    *next_poll_at = now.saturating_add(pending.interval);
                }
            }
            DevicePollResult::SlowDown => {
                pending.interval = pending.interval.saturating_add(5);
                if let DeviceFlowStatus::AwaitingAuthorization { next_poll_at, .. } =
                    &mut self.status
                {
                    *next_poll_at = now.saturating_add(pending.interval);
                }
            }
            DevicePollResult::Authorized => self.finish(DeviceFlowStatus::Completed),
            DevicePollResult::AccessDenied => self.finish(DeviceFlowStatus::Denied),
            DevicePollResult::ExpiredToken => self.finish(DeviceFlowStatus::Expired),
        }
        Ok(self.status.clone())
    }

    fn finish(&mut self, status: DeviceFlowStatus) {
        self.pending = None;
        self.status = status;
    }

    fn expire(&mut self, now: u64) {
        if matches!(self.status, DeviceFlowStatus::AwaitingAuthorization { expires_at, .. } if now >= expires_at)
        {
            self.finish(DeviceFlowStatus::Expired);
        }
    }
}

#[cfg(test)]
mod tests;
