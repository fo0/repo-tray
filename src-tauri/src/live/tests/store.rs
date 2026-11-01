use crate::auth::{AuthError, SecretToken};
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
    assert!(live.save_pin(pin).unwrap_err().contains("120"));
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
