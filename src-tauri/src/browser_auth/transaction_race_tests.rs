use super::*;
use crate::auth::AuthError;
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
};
#[derive(Default)]
struct Vault(Mutex<BTreeMap<String, SecretToken>>);
impl NativeKeyring for Vault {
    fn read_token(&self, account: &str) -> Result<Option<SecretToken>, AuthError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .get(account)
            .map(|v| v.with_secret(|s| SecretToken::new(s.into()))))
    }
    fn write_token(&self, account: &str, value: &SecretToken) -> Result<(), AuthError> {
        self.0.lock().unwrap().insert(
            account.into(),
            value.with_secret(|s| SecretToken::new(s.into())),
        );
        Ok(())
    }
    fn delete_token(&self, account: &str) -> Result<(), AuthError> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}
struct BlockingVault {
    inner: Vault,
    block_once: AtomicBool,
    entered: mpsc::SyncSender<()>,
    release: Mutex<mpsc::Receiver<()>>,
}
impl NativeKeyring for BlockingVault {
    fn read_token(&self, id: &str) -> Result<Option<SecretToken>, AuthError> {
        self.inner.read_token(id)
    }
    fn write_token(&self, id: &str, token: &SecretToken) -> Result<(), AuthError> {
        if self.block_once.swap(false, Ordering::SeqCst) {
            self.entered.send(()).unwrap();
            self.release.lock().unwrap().recv().unwrap();
        }
        self.inner.write_token(id, token)
    }
    fn delete_token(&self, id: &str) -> Result<(), AuthError> {
        self.inner.delete_token(id)
    }
}
fn record(access: &str) -> BrowserCredential {
    BrowserCredential {
        tokens: BrowserTokens {
            access: SecretToken::new(access.into()),
            refresh: SecretToken::new("synthetic-refresh".into()),
            expires_at: 1,
            refresh_expires_at: 100000,
        },
        client_id: "Iv1.synthetic".into(),
        user_id: 42,
        rotation_pending: false,
    }
}
struct BlockingTransport {
    entered: mpsc::SyncSender<()>,
    release: mpsc::Receiver<()>,
}
impl OAuthTransport for BlockingTransport {
    fn post(&mut self, _: OAuthEndpoint, _: &[(&str, &str)]) -> Result<OAuthResponse, String> {
        self.entered.send(()).unwrap();
        self.release.recv().unwrap();
        Ok(OAuthResponse { status: 200, body: br#"{"access_token":"synthetic-refreshed","refresh_token":"synthetic-rotated","expires_in":28800,"refresh_token_expires_in":15897600,"token_type":"bearer"}"#.to_vec() })
    }
    fn identity(&mut self, _: &SecretToken) -> Result<(u64, String), String> {
        Ok((42, "fixture-user".into()))
    }
}
#[test]
fn cancel_during_blocked_vault_write_rolls_back_without_late_account_commit() {
    for previous in [None, Some("synthetic-old")] {
        let (entered_tx, entered_rx) = mpsc::sync_channel(0);
        let (release_tx, release_rx) = mpsc::sync_channel(0);
        let vault = Arc::new(BlockingVault {
            inner: Vault::default(),
            block_once: AtomicBool::new(true),
            entered: entered_tx,
            release: Mutex::new(release_rx),
        });
        if let Some(value) = previous {
            vault
                .inner
                .write_token("github-device-42", &SecretToken::new(value.into()))
                .unwrap();
        }
        vault
            .inner
            .write_token("github-42", &SecretToken::new("synthetic-pat".into()))
            .unwrap();
        let current = Arc::new(AtomicBool::new(true));
        let account_committed = Arc::new(AtomicBool::new(false));
        let worker = {
            let vault = vault.clone();
            let current = current.clone();
            let account_committed = account_committed.clone();
            thread::spawn(move || {
                let result = commit_credential(
                    vault.as_ref(),
                    "github-device-42",
                    &record("synthetic-new").encode().unwrap(),
                    || current.load(Ordering::SeqCst),
                );
                if result.is_ok() {
                    account_committed.store(true, Ordering::SeqCst);
                }
                result
            })
        };
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        current.store(false, Ordering::SeqCst);
        release_tx.send(()).unwrap();
        assert!(worker.join().unwrap().is_err());
        assert!(!account_committed.load(Ordering::SeqCst));
        assert_eq!(
            vault
                .read_token("github-device-42")
                .unwrap()
                .map(|s| s.with_secret(str::to_owned)),
            previous.map(str::to_owned)
        );
        assert!(vault
            .read_token("github-42")
            .unwrap()
            .unwrap()
            .with_secret(|s| s == "synthetic-pat"));
    }
}
#[test]
fn disconnect_waits_for_inflight_refresh_then_removes_credential_permanently() {
    let vault = Arc::new(Vault::default());
    vault
        .write_token(
            "github-device-42",
            &record("synthetic-old").encode().unwrap(),
        )
        .unwrap();
    let (entered_tx, entered_rx) = mpsc::sync_channel(0);
    let (release_tx, release_rx) = mpsc::sync_channel(0);
    let refresh = {
        let vault = vault.clone();
        thread::spawn(move || {
            let _guard = CREDENTIALS.lock().unwrap();
            rotate(
                vault.as_ref(),
                "github-device-42",
                &mut BlockingTransport {
                    entered: entered_tx,
                    release: release_rx,
                },
                record("synthetic-old"),
                10,
            )
        })
    };
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let (started_tx, started_rx) = mpsc::sync_channel(0);
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let disconnect = {
        let vault = vault.clone();
        thread::spawn(move || {
            started_tx.send(()).unwrap();
            let result = disconnect_credential(vault.as_ref(), "github-device-42");
            done_tx.send(()).unwrap();
            result
        })
    };
    started_rx.recv().unwrap();
    assert!(done_rx.recv_timeout(Duration::from_millis(30)).is_err());
    release_tx.send(()).unwrap();
    refresh.join().unwrap().unwrap();
    disconnect.join().unwrap().unwrap();
    assert!(vault.read_token("github-device-42").unwrap().is_none());
}
#[test]
fn fresh_login_waits_for_old_refresh_and_remains_the_final_vault_owner() {
    let vault = Arc::new(Vault::default());
    let (entered_tx, entered_rx) = mpsc::sync_channel(0);
    let (release_tx, release_rx) = mpsc::sync_channel(0);
    let refresh = {
        let vault = vault.clone();
        thread::spawn(move || {
            let _guard = CREDENTIALS.lock().unwrap();
            rotate(
                vault.as_ref(),
                "github-device-42",
                &mut BlockingTransport {
                    entered: entered_tx,
                    release: release_rx,
                },
                record("synthetic-old"),
                10,
            )
        })
    };
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let (started_tx, started_rx) = mpsc::sync_channel(0);
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let login = {
        let vault = vault.clone();
        thread::spawn(move || {
            started_tx.send(()).unwrap();
            let result = commit_credential(
                vault.as_ref(),
                "github-device-42",
                &record("synthetic-new-login").encode().unwrap(),
                || true,
            );
            done_tx.send(()).unwrap();
            result
        })
    };
    started_rx.recv().unwrap();
    assert!(done_rx.recv_timeout(Duration::from_millis(30)).is_err());
    release_tx.send(()).unwrap();
    refresh.join().unwrap().unwrap();
    login.join().unwrap().unwrap();
    let stored =
        BrowserCredential::decode(&vault.read_token("github-device-42").unwrap().unwrap()).unwrap();
    assert!(stored
        .tokens
        .access
        .with_secret(|s| s == "synthetic-new-login"));
    assert!(!stored.rotation_pending);
}
