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
mod native {
    use super::{AuthError, NativeKeyring, SecretToken, CREDENTIAL_SERVICE};
    use std::sync::Mutex;

    // Serialize operations across adapter instances as well as accounts. Native stores can
    // otherwise process concurrent reads/updates of the same entry in an unexpected order.
    static OPERATION_LOCK: Mutex<()> = Mutex::new(());

    trait Entry: Send + Sync {
        fn read(&self) -> Result<Option<SecretToken>, AuthError>;
        fn write(&self, token: &SecretToken) -> Result<(), AuthError>;
        fn delete(&self) -> Result<(), AuthError>;
    }

    trait Backend: Send + Sync {
        fn entry(&self, service: &str, user: &str) -> Result<Box<dyn Entry>, AuthError>;
    }

    struct Store<B> {
        backend: B,
    }

    impl<B: Backend> NativeKeyring for Store<B> {
        fn read_token(&self, account_id: &str) -> Result<Option<SecretToken>, AuthError> {
            let user = account_entry(account_id)?;
            let _guard = OPERATION_LOCK
                .lock()
                .map_err(|_| AuthError::KeyringUnavailable)?;
            self.backend.entry(CREDENTIAL_SERVICE, &user)?.read()
        }

        fn write_token(&self, account_id: &str, token: &SecretToken) -> Result<(), AuthError> {
            let user = account_entry(account_id)?;
            if token.0.is_empty()
                || token.0.len() > 2048
                || token.0.iter().any(u8::is_ascii_control)
            {
                return Err(AuthError::KeyringUnavailable);
            }
            let _guard = OPERATION_LOCK
                .lock()
                .map_err(|_| AuthError::KeyringUnavailable)?;
            self.backend.entry(CREDENTIAL_SERVICE, &user)?.write(token)
        }

        fn delete_token(&self, account_id: &str) -> Result<(), AuthError> {
            let user = account_entry(account_id)?;
            let _guard = OPERATION_LOCK
                .lock()
                .map_err(|_| AuthError::KeyringUnavailable)?;
            self.backend.entry(CREDENTIAL_SERVICE, &user)?.delete()
        }
    }

    fn account_entry(account_id: &str) -> Result<String, AuthError> {
        if account_id.is_empty()
            || account_id.len() > 128
            || !account_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_:.".contains(&byte))
            || crate::workflow::looks_like_credential(account_id)
        {
            return Err(AuthError::KeyringUnavailable);
        }
        // No trimming or case folding: distinct stable IDs must never collapse to one key.
        Ok(format!("account:{account_id}"))
    }

    /// Native OS credential storage. Construction performs no OS-store access.
    ///
    /// The optional keyring `v1` backend uses macOS Keychain, Windows Credential Manager,
    /// or Linux Secret Service with encrypted D-Bus transfer. No file/mock fallback is used.
    /// Run operations on a native worker thread, never the UI thread. Native sign-in
    /// verifies identity before writing; the demo-only Credentials gate stays locked.
    ///
    /// API/backend source: https://docs.rs/keyring/4.2.0/keyring/v1/index.html
    #[cfg(feature = "native-credentials")]
    pub struct OsKeyring {
        store: Store<PlatformBackend>,
    }

    #[cfg(feature = "native-credentials")]
    impl Default for OsKeyring {
        fn default() -> Self {
            Self::new()
        }
    }

    #[cfg(feature = "native-credentials")]
    impl OsKeyring {
        pub fn new() -> Self {
            Self {
                store: Store {
                    backend: PlatformBackend,
                },
            }
        }
    }

    #[cfg(feature = "native-credentials")]
    impl std::fmt::Debug for OsKeyring {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter
                .debug_struct("OsKeyring")
                .field("service", &CREDENTIAL_SERVICE)
                .finish_non_exhaustive()
        }
    }

    #[cfg(feature = "native-credentials")]
    impl NativeKeyring for OsKeyring {
        fn read_token(&self, account_id: &str) -> Result<Option<SecretToken>, AuthError> {
            self.store.read_token(account_id)
        }

        fn write_token(&self, account_id: &str, token: &SecretToken) -> Result<(), AuthError> {
            self.store.write_token(account_id, token)
        }

        fn delete_token(&self, account_id: &str) -> Result<(), AuthError> {
            self.store.delete_token(account_id)
        }
    }

    #[cfg(feature = "native-credentials")]
    struct PlatformBackend;

    #[cfg(feature = "native-credentials")]
    impl Backend for PlatformBackend {
        fn entry(&self, service: &str, user: &str) -> Result<Box<dyn Entry>, AuthError> {
            // keyring v1 initializes only its native platform store. Missing/locked stores
            // and unsupported platforms fail closed; no in-memory or plaintext substitute.
            let entry = keyring::Entry::new(service, user).map_err(credential_error)?;
            Ok(Box::new(PlatformEntry(entry)))
        }
    }

    #[cfg(feature = "native-credentials")]
    struct PlatformEntry(keyring::Entry);

    #[cfg(feature = "native-credentials")]
    impl Entry for PlatformEntry {
        fn read(&self) -> Result<Option<SecretToken>, AuthError> {
            match self.0.get_secret() {
                Ok(mut bytes) => {
                    if std::str::from_utf8(&bytes).is_err()
                        || bytes.is_empty()
                        || bytes.len() > 2048
                    {
                        bytes.fill(0);
                        std::hint::black_box(&mut bytes);
                        return Err(AuthError::KeyringUnavailable);
                    }
                    Ok(Some(SecretToken(bytes)))
                }
                Err(keyring::Error::NoEntry) => Ok(None),
                // Never format or return platform errors; some may contain credential bytes.
                Err(error) => Err(credential_error(error)),
            }
        }

        fn write(&self, token: &SecretToken) -> Result<(), AuthError> {
            self.0.set_secret(&token.0).map_err(credential_error)
        }

        fn delete(&self) -> Result<(), AuthError> {
            match self.0.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(credential_error(error)),
            }
        }
    }

    #[cfg(feature = "native-credentials")]
    fn credential_error(error: keyring::Error) -> AuthError {
        if let keyring::Error::BadEncoding(mut bytes) = error {
            bytes.fill(0);
            std::hint::black_box(&mut bytes);
        }
        AuthError::KeyringUnavailable
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::collections::BTreeMap;
        use std::sync::Arc;

        #[derive(Default)]
        struct MockState {
            values: BTreeMap<(String, String), String>,
            entries: Vec<(String, String)>,
            fail: bool,
        }

        struct MockBackend(Arc<Mutex<MockState>>);

        struct MockEntry {
            key: (String, String),
            state: Arc<Mutex<MockState>>,
        }

        impl Backend for MockBackend {
            fn entry(&self, service: &str, user: &str) -> Result<Box<dyn Entry>, AuthError> {
                let mut state = self.0.lock().unwrap();
                state.entries.push((service.into(), user.into()));
                if state.fail {
                    return Err(AuthError::KeyringUnavailable);
                }
                Ok(Box::new(MockEntry {
                    key: (service.into(), user.into()),
                    state: self.0.clone(),
                }))
            }
        }

        impl Entry for MockEntry {
            fn read(&self) -> Result<Option<SecretToken>, AuthError> {
                Ok(self
                    .state
                    .lock()
                    .unwrap()
                    .values
                    .get(&self.key)
                    .cloned()
                    .map(SecretToken::new))
            }

            fn write(&self, token: &SecretToken) -> Result<(), AuthError> {
                token.with_secret(|value| {
                    self.state
                        .lock()
                        .unwrap()
                        .values
                        .insert(self.key.clone(), value.into());
                });
                Ok(())
            }

            fn delete(&self) -> Result<(), AuthError> {
                self.state.lock().unwrap().values.remove(&self.key);
                Ok(())
            }
        }

        #[test]
        fn adapter_keeps_account_entries_separate_under_a_stable_service() {
            let state = Arc::new(Mutex::new(MockState::default()));
            let store = Store {
                backend: MockBackend(state.clone()),
            };
            store
                .write_token("github:1", &SecretToken::new("synthetic-personal".into()))
                .unwrap();
            store
                .write_token("github:2", &SecretToken::new("synthetic-work".into()))
                .unwrap();
            assert!(store
                .read_token("github:1")
                .unwrap()
                .unwrap()
                .with_secret(|value| value == "synthetic-personal"));
            assert!(store
                .read_token("github:2")
                .unwrap()
                .unwrap()
                .with_secret(|value| value == "synthetic-work"));
            store.delete_token("github:1").unwrap();
            assert!(store.read_token("github:1").unwrap().is_none());
            assert!(store.read_token("github:2").unwrap().is_some());
            let state = state.lock().unwrap();
            assert!(state
                .entries
                .iter()
                .all(|(service, _)| service == CREDENTIAL_SERVICE));
            assert!(state
                .values
                .contains_key(&(CREDENTIAL_SERVICE.into(), "account:github:2".into())));
            assert_ne!(
                account_entry("Account-A").unwrap(),
                account_entry("account-a").unwrap()
            );
        }

        #[test]
        fn locked_gate_prevents_even_creating_a_backend_entry() {
            let state = Arc::new(Mutex::new(MockState::default()));
            let credentials = super::super::Credentials::locked(Store {
                backend: MockBackend(state.clone()),
            });
            assert!(matches!(
                credentials.read("github:1"),
                Err(AuthError::Locked)
            ));
            assert_eq!(
                credentials.write("github:1", &SecretToken::new("synthetic-token".into())),
                Err(AuthError::Locked)
            );
            assert_eq!(credentials.delete("github:1"), Err(AuthError::Locked));
            assert!(state.lock().unwrap().entries.is_empty());
            assert!(state.lock().unwrap().values.is_empty());
        }

        #[test]
        fn invalid_names_and_credential_metadata_fail_without_backend_access() {
            let state = Arc::new(Mutex::new(MockState::default()));
            let store = Store {
                backend: MockBackend(state.clone()),
            };
            for id in [
                "",
                " account",
                "../other",
                "account\0other",
                "ghp_synthetic",
            ] {
                assert!(matches!(
                    store.read_token(id),
                    Err(AuthError::KeyringUnavailable)
                ));
                assert_eq!(
                    store.write_token(id, &SecretToken::new("synthetic".into())),
                    Err(AuthError::KeyringUnavailable)
                );
                assert_eq!(store.delete_token(id), Err(AuthError::KeyringUnavailable));
            }
            assert_eq!(
                store.write_token("valid-account", &SecretToken::new("".into())),
                Err(AuthError::KeyringUnavailable)
            );
            assert_eq!(
                store.write_token(
                    "valid-account",
                    &SecretToken::new("synthetic\ntoken".into())
                ),
                Err(AuthError::KeyringUnavailable)
            );
            assert!(state.lock().unwrap().entries.is_empty());
        }

        #[test]
        fn unavailable_store_fails_closed_with_no_fallback_or_secret_in_error() {
            let state = Arc::new(Mutex::new(MockState {
                fail: true,
                ..MockState::default()
            }));
            let store = Store {
                backend: MockBackend(state.clone()),
            };
            let token = SecretToken::new("synthetic-private-token".into());
            let error = store.write_token("github:1", &token).unwrap_err();
            assert_eq!(error, AuthError::KeyringUnavailable);
            assert!(!format!("{error:?} {error} {token:?}").contains("synthetic-private-token"));
            assert!(state.lock().unwrap().values.is_empty());
            assert!(matches!(
                store.read_token("github:1"),
                Err(AuthError::KeyringUnavailable)
            ));
            assert_eq!(
                store.delete_token("github:1"),
                Err(AuthError::KeyringUnavailable)
            );
        }

        #[cfg(feature = "native-credentials")]
        #[test]
        fn native_adapter_can_be_constructed_and_gated_without_any_os_entry_access() {
            let adapter = OsKeyring::new();
            assert_eq!(
                format!("{adapter:?}"),
                "OsKeyring { service: \"io.github.fo0.repotray\", .. }"
            );
            let credentials = super::super::Credentials::locked(adapter);
            assert!(matches!(
                credentials.read("synthetic-account"),
                Err(AuthError::Locked)
            ));
            assert_eq!(
                credentials.write(
                    "synthetic-account",
                    &SecretToken::new("synthetic-token".into())
                ),
                Err(AuthError::Locked)
            );
            assert_eq!(
                credentials.delete("synthetic-account"),
                Err(AuthError::Locked)
            );
        }

        #[cfg(feature = "native-credentials")]
        #[test]
        fn platform_errors_with_secret_bytes_are_mapped_to_one_public_error() {
            let error = credential_error(keyring::Error::BadEncoding(
                b"synthetic-private-token".to_vec(),
            ));
            assert_eq!(error, AuthError::KeyringUnavailable);
            assert!(!format!("{error:?} {error}").contains("synthetic-private-token"));
        }
    }
}

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
