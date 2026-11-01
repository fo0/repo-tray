use super::migrations::MIGRATIONS;
use super::*;
use crate::demo::DemoStore;
use crate::models::{InputSpec, InputType, InputValue};
use std::collections::BTreeSet;

fn temp_db(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "repotray-{name}-{}-{}.db",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

fn remove_db(path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }
}

fn target(account_id: &str) -> DispatchTarget {
    DispatchTarget {
        account_id: account_id.into(),
        repo_id: format!("{account_id}:7"),
        workflow_id: 101,
        git_ref: "main".into(),
    }
}

fn raw_payload(cache: &Cache, account_id: &str) -> String {
    cache
        .connection
        .query_row(
            "SELECT payload FROM snapshots WHERE account_id=?1",
            [account_id],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn uncertain_claims_survive_restart_with_claim_time_and_stay_target_scoped() {
    let path = temp_db("claims");
    let first = "2026-11-01T10:00:00+00:00";
    {
        let cache = Cache::open(&path).unwrap();
        let mode: String = cache
            .connection
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
        let claimed = cache.claim_dispatch(&target("account-a"), first).unwrap();
        assert_eq!(claimed.unwrap().claimed_at.as_deref(), Some(first));
    }
    {
        let cache = Cache::open(&path).unwrap();
        let starts = cache.uncertain_starts().unwrap();
        assert_eq!(starts.len(), 1);
        assert_eq!(starts[0].target(), target("account-a"));
        assert_eq!(starts[0].claimed_at.as_deref(), Some(first));
        assert!(cache
            .claim_dispatch(&target("account-a"), "2026-11-01T10:05:00+00:00")
            .unwrap()
            .is_none());
        assert!(cache
            .claim_dispatch(&target("account-b"), first)
            .unwrap()
            .is_some());
        cache.resolve_dispatch(&target("account-a")).unwrap();
        assert!(cache
            .claim_dispatch(&target("account-a"), first)
            .unwrap()
            .is_some());
    }
    remove_db(&path);
}

#[test]
fn release_removes_only_the_reviewed_claim() {
    let cache = Cache::in_memory().unwrap();
    let start = cache
        .claim_dispatch(&target("account-a"), "2026-11-01T10:00:00+00:00")
        .unwrap()
        .unwrap();
    let mut outdated = start.clone();
    outdated.claimed_at = Some("2026-11-01T09:00:00+00:00".into());
    assert_eq!(
        cache.release_uncertain_start(&outdated).unwrap(),
        Release::Replaced
    );
    assert_eq!(cache.uncertain_starts().unwrap(), vec![start.clone()]);
    // A panel-only session lock carries no time; it must never release a timed claim.
    let untimed = UncertainStart {
        claimed_at: None,
        ..start.clone()
    };
    assert_eq!(
        cache.release_uncertain_start(&untimed).unwrap(),
        Release::Replaced
    );
    assert_eq!(cache.uncertain_starts().unwrap(), vec![start.clone()]);
    assert_eq!(
        cache.release_uncertain_start(&start).unwrap(),
        Release::Released
    );
    assert!(cache.uncertain_starts().unwrap().is_empty());
    assert_eq!(
        cache.release_uncertain_start(&start).unwrap(),
        Release::Missing
    );
    assert!(cache
        .claim_dispatch(&target("account-a"), "2026-11-01T11:00:00+00:00")
        .unwrap()
        .is_some());
}

#[test]
fn deleting_an_account_removes_its_claims_only() {
    let mut cache = Cache::in_memory().unwrap();
    let time = "2026-11-01T10:00:00+00:00";
    cache
        .claim_dispatch(&target("demo-personal"), time)
        .unwrap();
    cache.claim_dispatch(&target("demo-work"), time).unwrap();
    cache.delete_account("demo-personal").unwrap();
    let starts = cache.uncertain_starts().unwrap();
    assert_eq!(starts.len(), 1);
    assert_eq!(starts[0].account_id, "demo-work");
    assert!(cache
        .claim_dispatch(&target("demo-personal"), time)
        .unwrap()
        .is_some());
}

#[test]
fn snapshot_pins_and_settings_are_account_isolated() {
    let mut cache = Cache::in_memory().unwrap();
    let snapshot = DemoStore::new().snapshot();
    cache.save_pin("demo-personal", &snapshot.pins[0]).unwrap();
    cache.save_snapshot("demo-personal", &snapshot).unwrap();
    cache.save_snapshot("demo-work", &snapshot).unwrap();
    let personal = cache.load_snapshot("demo-personal").unwrap().unwrap();
    let work = cache.load_snapshot("demo-work").unwrap().unwrap();
    assert!(personal.stale);
    assert_eq!(personal.accounts.len(), 1);
    assert_eq!(personal.pins, snapshot.pins);
    assert!(personal
        .repos
        .iter()
        .all(|repo| repo.account_id == "demo-personal"));
    assert!(work.pins.is_empty());
    let personal_ids: BTreeSet<_> = personal.repos.iter().map(|repo| &repo.id).collect();
    assert!(personal
        .runs
        .iter()
        .all(|run| personal_ids.contains(&run.repo_id)));
    cache.delete_account("demo-personal").unwrap();
    assert!(cache.load_snapshot("demo-personal").unwrap().is_none());
    assert!(cache.load_pins("demo-personal").unwrap().is_empty());
    assert!(cache.load_snapshot("demo-work").unwrap().is_some());
    // A reconnect with identical content is written again after the account was deleted.
    cache.save_snapshot("demo-personal", &snapshot).unwrap();
    assert!(cache.load_snapshot("demo-personal").unwrap().is_some());
}

#[test]
fn an_oversized_pin_is_too_large_rather_than_invalid() {
    let cache = Cache::in_memory().unwrap();
    let mut pin = DemoStore::new().snapshot().pins.remove(0);
    pin.inputs.insert(
        "notes".into(),
        InputValue::String("x".repeat(MAX_CACHE_BYTES)),
    );
    assert!(matches!(
        cache.save_pin(&pin.account_id.clone(), &pin),
        Err(CacheError::TooLarge)
    ));
    assert!(cache.load_pins(&pin.account_id).unwrap().is_empty());
}

#[test]
fn pins_reject_secrets_and_snapshots_never_write_pins() {
    let mut cache = Cache::in_memory().unwrap();
    let mut snapshot = DemoStore::new().snapshot();
    assert!(cache.save_pin("demo-work", &snapshot.pins[0]).is_err());
    snapshot.pins[0]
        .inputs
        .insert("clientSecret".into(), InputValue::String("hidden".into()));
    assert!(cache.save_pin("demo-personal", &snapshot.pins[0]).is_err());
    let mut pasted = DemoStore::new().snapshot().pins.remove(0);
    pasted.label = "ghp_pastedByMistake".into();
    assert!(cache.save_pin("demo-personal", &pasted).is_err());
    cache.save_snapshot("demo-personal", &snapshot).unwrap();
    let payload = raw_payload(&cache, "demo-personal");
    assert!(!payload.contains("clientSecret") && !payload.contains("hidden"));
    assert!(cache.load_pins("demo-personal").unwrap().is_empty());
}

#[test]
fn credential_looking_github_metadata_is_redacted_instead_of_failing() {
    let mut cache = Cache::in_memory().unwrap();
    let mut snapshot = DemoStore::new().snapshot();
    let workflow = &mut snapshot.workflows[0];
    workflow.inputs.push(InputSpec {
        name: "tokenizer_model".into(),
        label: "Bearer token scope for the model registry".into(),
        r#type: InputType::String,
        required: false,
        default: Some(InputValue::String("gpt2-small".into())),
        options: vec![],
        note: None,
    });
    workflow.inputs[0]
        .options
        .push("ghp_lookalikeOption".into());
    workflow.inputs[1].default = Some(InputValue::String("github_pat_lookalike".into()));
    snapshot.runs[0].name = "Bearer abc release".into();
    cache.save_snapshot("demo-personal", &snapshot).unwrap();
    let payload = raw_payload(&cache, "demo-personal");
    for leaked in ["Bearer", "ghp_", "github_pat_", "gpt2-small"] {
        assert!(!payload.contains(leaked), "{leaked} reached the cache");
    }
    let loaded = cache.load_snapshot("demo-personal").unwrap().unwrap();
    let inputs = &loaded.workflows[0].inputs;
    let tokenizer = inputs.iter().find(|i| i.name == "tokenizer_model").unwrap();
    assert_eq!(tokenizer.default, None);
    assert_eq!(tokenizer.label, REDACTED);
    assert_eq!(
        inputs[0].options,
        vec!["windows-x64", "linux-x64", "macos-arm64"]
    );
    assert_eq!(inputs[1].default, None);
    assert_eq!(loaded.runs[0].name, REDACTED);
}

#[test]
fn pins_survive_when_their_repository_leaves_the_catalog() {
    let mut cache = Cache::in_memory().unwrap();
    let mut snapshot = DemoStore::new().snapshot();
    let pin = snapshot.pins[0].clone();
    cache.save_pin("demo-personal", &pin).unwrap();
    cache.save_snapshot("demo-personal", &snapshot).unwrap();
    // SSO lapse or removed access: the repository is missing from the next catalog.
    snapshot.repos.retain(|repo| repo.id != pin.repo_id);
    snapshot.pins.clear();
    cache.save_snapshot("demo-personal", &snapshot).unwrap();
    let loaded = cache.load_snapshot("demo-personal").unwrap().unwrap();
    assert!(loaded.repos.iter().all(|repo| repo.id != pin.repo_id));
    assert_eq!(loaded.pins, vec![pin.clone()]);
    cache.delete_pin("demo-personal", &pin.id).unwrap();
    assert!(cache.load_pins("demo-personal").unwrap().is_empty());
}

#[test]
fn unchanged_snapshot_payloads_are_not_rewritten() {
    let mut cache = Cache::in_memory().unwrap();
    let mut snapshot = DemoStore::new().snapshot();
    cache.save_snapshot("demo-personal", &snapshot).unwrap();
    cache
        .connection
        .execute("UPDATE snapshots SET payload='marker'", [])
        .unwrap();
    snapshot.updated_at = "2026-11-01T12:00:00+00:00".into();
    cache.save_snapshot("demo-personal", &snapshot).unwrap();
    assert_eq!(raw_payload(&cache, "demo-personal"), "marker");
    snapshot.runs[0].name = "Changed".into();
    cache.save_snapshot("demo-personal", &snapshot).unwrap();
    let loaded = cache.load_snapshot("demo-personal").unwrap().unwrap();
    assert_eq!(loaded.runs[0].name, "Changed");
    assert_eq!(loaded.updated_at, snapshot.updated_at);
}

#[test]
fn migrates_an_unversioned_database_and_refuses_a_newer_schema() {
    let path = temp_db("legacy");
    let snapshot = DemoStore::new().snapshot();
    let pin = snapshot.pins[0].clone();
    {
        // The exact schema unversioned builds created, with user_version still 0.
        let legacy = Connection::open(&path).unwrap();
        legacy
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS dispatch_claims (target TEXT PRIMARY KEY NOT NULL);
                     CREATE TABLE IF NOT EXISTS snapshots (
                         account_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, etag TEXT);
                     CREATE TABLE IF NOT EXISTS pins (account_id TEXT NOT NULL,
                         pin_id TEXT NOT NULL, payload TEXT NOT NULL,
                         PRIMARY KEY (account_id, pin_id));
                     CREATE TABLE IF NOT EXISTS settings (
                         account_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
                     CREATE TABLE IF NOT EXISTS etags (account_id TEXT NOT NULL,
                         resource TEXT NOT NULL, value TEXT NOT NULL,
                         PRIMARY KEY (account_id, resource));",
            )
            .unwrap();
        let claim =
            serde_json::to_string(&("demo-personal", "demo-personal-kit", 101, "main")).unwrap();
        for target in [claim.as_str(), "not-a-claim"] {
            legacy
                .execute("INSERT INTO dispatch_claims (target) VALUES (?1)", [target])
                .unwrap();
        }
        legacy
            .execute(
                "INSERT INTO snapshots (account_id, payload, etag) VALUES (?1, ?2, '\"e\"')",
                params!["demo-personal", serde_json::to_string(&snapshot).unwrap()],
            )
            .unwrap();
        legacy
            .execute(
                "INSERT INTO pins (account_id, pin_id, payload) VALUES (?1, ?2, ?3)",
                params![
                    "demo-personal",
                    pin.id,
                    serde_json::to_string(&pin).unwrap()
                ],
            )
            .unwrap();
        legacy
            .execute(
                "INSERT INTO etags VALUES ('demo-personal', 'https://api.github.com/user', 'x')",
                [],
            )
            .unwrap();
    }
    {
        let cache = Cache::open(&path).unwrap();
        let version: i64 = cache
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
        let loaded = cache.load_snapshot("demo-personal").unwrap().unwrap();
        assert_eq!(loaded.pins, vec![pin]);
        let starts = cache.uncertain_starts().unwrap();
        assert_eq!(starts.len(), 1);
        assert_eq!(starts[0].repo_id, "demo-personal-kit");
        assert_eq!(starts[0].claimed_at, None);
        let etags: i64 = cache
            .connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='etags'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(etags, 0);
        cache
            .connection
            .pragma_update(None, "user_version", 99)
            .unwrap();
    }
    assert!(Cache::open(&path).is_err());
    remove_db(&path);
}

#[test]
fn a_failing_migration_rolls_back_and_keeps_the_legacy_data() {
    let path = temp_db("rollback");
    let claim =
        serde_json::to_string(&("demo-personal", "demo-personal-kit", 101, "main")).unwrap();
    {
        let legacy = Connection::open(&path).unwrap();
        legacy
            .execute_batch(
                "CREATE TABLE dispatch_claims (target TEXT PRIMARY KEY NOT NULL);
                     CREATE TABLE snapshots (
                         account_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, etag TEXT);
                     CREATE TABLE etags (account_id TEXT NOT NULL, resource TEXT NOT NULL,
                         value TEXT NOT NULL, PRIMARY KEY (account_id, resource));
                     -- A leftover table the v2 migration also wants to create.
                     CREATE TABLE snapshots_v2 (conflict TEXT);",
            )
            .unwrap();
        legacy
            .execute("INSERT INTO dispatch_claims (target) VALUES (?1)", [&claim])
            .unwrap();
        legacy
            .execute(
                "INSERT INTO snapshots (account_id, payload, etag) VALUES ('demo-personal', 'legacy', '\"e\"')",
                [],
            )
            .unwrap();
    }
    assert!(Cache::open(&path).is_err());
    let after = Connection::open(&path).unwrap();
    let version: i64 = after
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 1, "v1 committed, v2 rolled back");
    let count = |sql: &str| -> i64 { after.query_row(sql, [], |row| row.get(0)).unwrap() };
    assert_eq!(
        count("SELECT COUNT(*) FROM sqlite_master WHERE name='etags'"),
        1
    );
    assert_eq!(
        count("SELECT COUNT(*) FROM sqlite_master WHERE name='dispatch_claims_v2'"),
        0
    );
    let target: String = after
        .query_row("SELECT target FROM dispatch_claims", [], |row| row.get(0))
        .unwrap();
    assert_eq!(target, claim);
    let (payload, etag): (String, String) = after
        .query_row("SELECT payload, etag FROM snapshots", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .unwrap();
    assert_eq!((payload.as_str(), etag.as_str()), ("legacy", "\"e\""));
    drop(after);
    remove_db(&path);
}

#[test]
fn deleting_a_snapshot_row_keeps_pins_settings_and_claims() {
    let mut cache = Cache::in_memory().unwrap();
    let snapshot = DemoStore::new().snapshot();
    cache.save_pin("demo-personal", &snapshot.pins[0]).unwrap();
    cache.save_snapshot("demo-personal", &snapshot).unwrap();
    cache
        .claim_dispatch(&target("demo-personal"), "2026-11-01T10:00:00+00:00")
        .unwrap();
    cache.delete_snapshot("demo-personal").unwrap();
    assert!(cache.account_ids().unwrap().is_empty());
    assert_eq!(cache.load_pins("demo-personal").unwrap().len(), 1);
    assert_eq!(cache.uncertain_starts().unwrap().len(), 1);
    // The written-payload memory is cleared, so the same payload is stored again.
    cache.save_snapshot("demo-personal", &snapshot).unwrap();
    assert_eq!(cache.account_ids().unwrap(), vec!["demo-personal"]);
}

#[test]
fn app_settings_persist_and_the_reserved_key_is_not_an_account() {
    let path = temp_db("settings");
    {
        let cache = Cache::open(&path).unwrap();
        assert!(!cache.load_app_settings().unwrap().notifications);
        cache
            .save_app_settings(&AppSettings {
                notifications: true,
            })
            .unwrap();
    }
    let mut cache = Cache::open(&path).unwrap();
    assert!(cache.load_app_settings().unwrap().notifications);
    assert!(cache.delete_account(APP_SETTINGS_KEY).is_err());
    assert!(cache.load_app_settings().unwrap().notifications);
    drop(cache);
    remove_db(&path);
}

#[test]
fn deleting_one_accounts_pin_does_not_delete_another_accounts_same_id() {
    let cache = Cache::in_memory().unwrap();
    let pin = DemoStore::new().snapshot().pins.remove(0);
    cache.save_pin("demo-personal", &pin).unwrap();
    let mut other = pin.clone();
    other.account_id = "demo-work".into();
    other.repo_id = "demo-team-tools".into();
    cache.save_pin("demo-work", &other).unwrap();
    cache.delete_pin("demo-personal", &pin.id).unwrap();
    assert!(cache.load_pins("demo-personal").unwrap().is_empty());
    assert_eq!(cache.load_pins("demo-work").unwrap().len(), 1);
}

#[test]
fn a_file_cache_uses_wal_with_full_sync_so_a_dispatch_claim_survives_power_loss() {
    let path = temp_db("durability");
    let cache = Cache::open(&path).unwrap();
    let journal: String = cache
        .connection
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .unwrap();
    // 2 = FULL. WAL with NORMAL may roll back the claim committed right before the POST.
    let synchronous: i64 = cache
        .connection
        .query_row("PRAGMA synchronous", [], |row| row.get(0))
        .unwrap();
    assert_eq!(journal, "wal");
    assert_eq!(synchronous, 2);
    drop(cache);
    remove_db(&path);
}
