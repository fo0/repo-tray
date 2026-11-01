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
        if token.0.is_empty() || token.0.len() > 2048 || token.0.iter().any(u8::is_ascii_control) {
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
                if std::str::from_utf8(&bytes).is_err() || bytes.is_empty() || bytes.len() > 2048 {
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
