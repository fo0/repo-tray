use crate::auth::{AuthError, SecretToken};
use crate::github::{ApiRequest, TransportError};
use crate::live::*;

/// Synthetic vault: holds nothing, so no test can read or write a real credential.
struct EmptyVault;
impl NativeKeyring for EmptyVault {
    fn read_token(&self, _: &str) -> Result<Option<SecretToken>, AuthError> {
        Ok(None)
    }
    fn write_token(&self, _: &str, _: &SecretToken) -> Result<(), AuthError> {
        Ok(())
    }
    fn delete_token(&self, _: &str) -> Result<(), AuthError> {
        Ok(())
    }
}

/// Synthetic vault that cannot be read, as when the OS vault is locked or unavailable.
struct BrokenVault;
impl NativeKeyring for BrokenVault {
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

fn store(cache: Cache) -> LiveStore {
    LiveStore::new(cache, Arc::new(EmptyVault)).unwrap()
}

fn account(id: &str) -> Account {
    Account {
        id: id.into(),
        login: format!("fixture-{id}"),
        label: "GitHub · Token".into(),
    }
}

#[test]
fn claims_survive_restart_release_explicitly_and_leave_with_their_account() {
    let path = std::env::temp_dir().join(format!(
        "repotray-live-claims-{}-{}.db",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    {
        let mut cache = Cache::open(&path).unwrap();
        let mut snapshot = empty_snapshot();
        snapshot.accounts = vec![account("github-1"), account("github-2")];
        for id in ["github-1", "github-2"] {
            cache.save_snapshot(id, &snapshot).unwrap();
            let target = DispatchTarget {
                account_id: id.into(),
                repo_id: format!("{id}:7"),
                workflow_id: 9,
                git_ref: "main".into(),
            };
            cache
                .claim_dispatch(&target, "2026-11-01T10:00:00+00:00")
                .unwrap();
        }
    }
    let mut live = store(Cache::open(&path).unwrap());
    let starts = live.snapshot().uncertain_starts;
    assert_eq!(starts.len(), 2);
    let released = live.release_uncertain_start(starts[0].clone()).unwrap();
    assert_eq!(released.uncertain_starts, vec![starts[1].clone()]);
    live.disconnect("github-2").unwrap();
    assert!(live.snapshot().uncertain_starts.is_empty());
    drop(live);
    assert!(store(Cache::open(&path).unwrap())
        .snapshot()
        .uncertain_starts
        .is_empty());
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }
}

#[test]
fn invalid_input_is_refused_and_the_outcome_ledger_is_bounded() {
    let mut live = store(Cache::in_memory().unwrap());
    let mut request = DispatchRequest {
        account_id: "github-1".into(),
        repo_id: "github-1:7".into(),
        workflow_id: 9,
        git_ref: "main".into(),
        inputs: Inputs::new(),
        request_id: "x".repeat(MAX_REQUEST_ID_CHARS + 1),
    };
    assert_eq!(
        live.dispatch(request.clone()).state,
        DispatchState::Rejected
    );
    assert!(live.outcomes.is_empty());
    // Unknown repositories are rejected before any network call.
    for index in 0..MAX_RECORDED_OUTCOMES + 44 {
        request.request_id = format!("start-{index}");
        live.dispatch(request.clone());
    }
    assert_eq!(live.outcomes.len(), MAX_RECORDED_OUTCOMES);
    assert!(live.outcomes.get(&"start-0".to_string()).is_none());
    let pin = Pin {
        id: "pin-1".into(),
        label: "x".repeat(MAX_PIN_LABEL_CHARS + 1),
        account_id: "github-1".into(),
        repo_id: "github-1:7".into(),
        workflow_id: 9,
        git_ref: "main".into(),
        inputs: Inputs::new(),
        quick_start: false,
    };
    assert!(live.save_pin(pin.clone()).unwrap_err().contains("120"));
    let named = |id: String, git_ref: &str| Pin {
        id,
        label: "Fixture pin".into(),
        git_ref: git_ref.into(),
        ..pin.clone()
    };
    assert_eq!(
        live.save_pin(named("pin-1".into(), "-delete")).unwrap_err(),
        "Branch oder Tag des Favoriten ist ungültig."
    );
    live.data.pins = (0..MAX_PINS)
        .map(|index| named(format!("pin-{index}"), "main"))
        .collect();
    assert!(live
        .save_pin(named("pin-new".into(), "main"))
        .unwrap_err()
        .contains("100"));
}

#[test]
fn a_failed_cache_write_is_a_notice_and_never_marks_live_data_stale() {
    let mut live = store(Cache::in_memory().unwrap());
    // An account ID the cache refuses to store forces the write to fail.
    live.data.accounts = vec![account("ghp_unstorable")];
    live.data.stale = false;
    live.data.connectivity = Connectivity::Online;
    live.data.message = None;
    live.persist();
    live.persist();
    assert!(!live.data.stale);
    assert_eq!(live.data.connectivity, Connectivity::Online);
    assert_eq!(live.data.message.as_deref(), Some(CACHE_NOTICE));
}

#[test]
fn a_missing_or_unreadable_credential_fails_before_sending_and_is_not_a_network_error() {
    let request = ApiRequest::get("github-1", url(&["user"], &[]).unwrap()).unwrap();
    for (vault, expected) in [
        (
            Arc::new(EmptyVault) as Arc<dyn NativeKeyring>,
            TransportError::NoCredential,
        ),
        (Arc::new(BrokenVault), TransportError::VaultUnavailable),
    ] {
        let mut transport = HttpTransport::new(vault).unwrap();
        assert_eq!(transport.send(&request).unwrap_err(), expected);
    }
}

#[test]
fn a_refused_favorite_write_is_reported_in_german() {
    let path = std::env::temp_dir().join(format!(
        "repotray-live-pin-errors-{}-{}.db",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let mut live = store(Cache::open(&path).unwrap());
    live.data.accounts = vec![account("github-1")];
    live.data.repos = vec![Repo {
        id: "github-1:7".into(),
        account_id: "github-1".into(),
        owner: "fixture-owner".into(),
        name: "fixture-repo".into(),
        default_branch: "main".into(),
        selected: true,
        permission: Permission::Write,
    }];
    live.data.workflows = vec![Workflow {
        id: 9,
        repo_id: "github-1:7".into(),
        name: "Fixture".into(),
        path: ".github/workflows/fixture.yml".into(),
        dispatch: true,
        inputs: vec![],
        refs: vec!["main".into()],
    }];
    let pin = Pin {
        id: "pin-1".into(),
        // Synthetic credential-looking label, never a real token.
        label: "ghp_FIXTURE".into(),
        account_id: "github-1".into(),
        repo_id: "github-1:7".into(),
        workflow_id: 9,
        git_ref: "main".into(),
        inputs: Inputs::new(),
        quick_start: false,
    };
    assert_eq!(
        live.save_pin(pin.clone()).unwrap_err(),
        "Namen oder Werte, die wie Zugangsdaten aussehen, werden nicht gespeichert."
    );
    // An oversized favorite is refused by its input limits, never as a credential.
    let oversized = Pin {
        label: "Fixture pin".into(),
        inputs: Inputs::from([(
            "notes".into(),
            InputValue::String("x".repeat(3 * 1024 * 1024)),
        )]),
        ..pin.clone()
    };
    assert_eq!(
        live.save_pin(oversized).unwrap_err(),
        "Eingabewerte eines Favoriten dürfen höchstens 8000 Zeichen lang sein."
    );
    // Should an entry still exceed the cache limit, it is named as too large.
    assert_eq!(
        pin_save_error(CacheError::TooLarge),
        "Favorit ist zu groß zum Speichern – kürze seine Eingaben."
    );
    rusqlite::Connection::open(&path)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER refuse_pin BEFORE INSERT ON pins
                 BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END;",
        )
        .unwrap();
    let named = Pin {
        label: "Fixture pin".into(),
        ..pin
    };
    assert_eq!(
        live.save_pin(named).unwrap_err(),
        "Favorit konnte nicht lokal gespeichert werden. Versuche es erneut."
    );
    assert!(live.data.pins.is_empty());
    drop(live);
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }
}
