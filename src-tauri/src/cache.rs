//! Account-scoped SQLite storage for public preferences and cached metadata only.
//! Credentials have no column, API, or serialization path in this module.

use crate::models::{Pin, Snapshot};
use crate::workflow::{looks_like_credential, validate_non_secret_inputs};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fmt;
use std::path::Path;

const MAX_CACHE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug)]
pub enum CacheError {
    Database(rusqlite::Error),
    Serialization(serde_json::Error),
    Invalid(String),
}

impl fmt::Display for CacheError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Database(_) => f.write_str("The local cache could not be read or written."),
            Self::Serialization(_) => f.write_str("The local cache contains invalid data."),
            Self::Invalid(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for CacheError {}

impl From<rusqlite::Error> for CacheError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error)
    }
}

impl From<serde_json::Error> for CacheError {
    fn from(error: serde_json::Error) -> Self {
        Self::Serialization(error)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct CachedSnapshot {
    pub snapshot: Snapshot,
    pub etag: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountSettings {
    pub selected_repo_ids: Vec<String>,
}

pub struct Cache {
    connection: Connection,
}

impl Cache {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, CacheError> {
        Self::from_connection(Connection::open(path)?)
    }

    pub fn in_memory() -> Result<Self, CacheError> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(connection: Connection) -> Result<Self, CacheError> {
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS dispatch_claims (target TEXT PRIMARY KEY NOT NULL);
             CREATE TABLE IF NOT EXISTS snapshots (
                 account_id TEXT PRIMARY KEY NOT NULL,
                 payload TEXT NOT NULL,
                 etag TEXT
             );
             CREATE TABLE IF NOT EXISTS pins (
                 account_id TEXT NOT NULL,
                 pin_id TEXT NOT NULL,
                 payload TEXT NOT NULL,
                 PRIMARY KEY (account_id, pin_id)
             );
             CREATE TABLE IF NOT EXISTS settings (
                 account_id TEXT PRIMARY KEY NOT NULL,
                 payload TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS etags (
                 account_id TEXT NOT NULL,
                 resource TEXT NOT NULL,
                 value TEXT NOT NULL,
                 PRIMARY KEY (account_id, resource)
             );",
        )?;
        Ok(Self { connection })
    }

    pub fn account_ids(&self) -> Result<Vec<String>, CacheError> {
        let mut query = self
            .connection
            .prepare("SELECT account_id FROM snapshots ORDER BY account_id")?;
        let rows = query.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(CacheError::Database)
    }

    /// A claim is written before sending a dispatch and survives a process restart.
    pub fn claim_dispatch(&self, target: &str) -> Result<bool, CacheError> {
        Ok(self.connection.execute(
            "INSERT OR IGNORE INTO dispatch_claims (target) VALUES (?1)",
            [target],
        )? == 1)
    }

    pub fn resolve_dispatch(&self, target: &str) -> Result<(), CacheError> {
        self.connection
            .execute("DELETE FROM dispatch_claims WHERE target=?1", [target])?;
        Ok(())
    }

    pub fn save_snapshot(
        &mut self,
        account_id: &str,
        snapshot: &Snapshot,
        etag: Option<&str>,
    ) -> Result<(), CacheError> {
        validate_identifier(account_id)?;
        validate_etag(etag)?;
        let scoped = account_snapshot(account_id, snapshot)?;
        validate_public_snapshot(&scoped)?;
        let payload = encode(&scoped)?;
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO snapshots (account_id, payload, etag) VALUES (?1, ?2, ?3)
             ON CONFLICT(account_id) DO UPDATE SET payload=excluded.payload, etag=excluded.etag",
            params![account_id, payload, etag],
        )?;
        transaction.execute("DELETE FROM pins WHERE account_id=?1", [account_id])?;
        for pin in &scoped.pins {
            transaction.execute(
                "INSERT INTO pins (account_id, pin_id, payload) VALUES (?1, ?2, ?3)",
                params![account_id, pin.id, encode(pin)?],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn load_snapshot(&self, account_id: &str) -> Result<Option<CachedSnapshot>, CacheError> {
        validate_identifier(account_id)?;
        let row: Option<(String, Option<String>)> = self
            .connection
            .query_row(
                "SELECT payload, etag FROM snapshots WHERE account_id=?1",
                [account_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((payload, etag)) = row else {
            return Ok(None);
        };
        let original: Snapshot = decode(&payload)?;
        let mut snapshot = account_snapshot(account_id, &original)?;
        snapshot.pins = self.load_pins(account_id)?;
        validate_public_snapshot(&snapshot)?;
        validate_etag(etag.as_deref())?;
        snapshot.stale = true;
        Ok(Some(CachedSnapshot { snapshot, etag }))
    }

    pub fn save_pin(&self, account_id: &str, pin: &Pin) -> Result<(), CacheError> {
        validate_identifier(account_id)?;
        if pin.account_id != account_id {
            return Err(CacheError::Invalid(
                "Pin belongs to another account.".into(),
            ));
        }
        validate_pin(pin)?;
        self.connection.execute(
            "INSERT INTO pins (account_id, pin_id, payload) VALUES (?1, ?2, ?3)
             ON CONFLICT(account_id, pin_id) DO UPDATE SET payload=excluded.payload",
            params![account_id, pin.id, encode(pin)?],
        )?;
        Ok(())
    }

    pub fn load_pins(&self, account_id: &str) -> Result<Vec<Pin>, CacheError> {
        validate_identifier(account_id)?;
        let mut statement = self
            .connection
            .prepare("SELECT payload FROM pins WHERE account_id=?1 ORDER BY pin_id")?;
        let rows = statement.query_map([account_id], |row| row.get::<_, String>(0))?;
        let mut pins = vec![];
        for row in rows {
            let pin: Pin = decode(&row?)?;
            if pin.account_id != account_id {
                return Err(CacheError::Invalid("Cached pin account mismatch.".into()));
            }
            validate_pin(&pin)?;
            pins.push(pin);
        }
        Ok(pins)
    }

    pub fn delete_pin(&self, account_id: &str, pin_id: &str) -> Result<(), CacheError> {
        validate_identifier(account_id)?;
        self.connection.execute(
            "DELETE FROM pins WHERE account_id=?1 AND pin_id=?2",
            params![account_id, pin_id],
        )?;
        Ok(())
    }

    pub fn save_settings(
        &self,
        account_id: &str,
        settings: &AccountSettings,
    ) -> Result<(), CacheError> {
        validate_identifier(account_id)?;
        for id in &settings.selected_repo_ids {
            validate_identifier(id)?;
        }
        self.connection.execute(
            "INSERT INTO settings (account_id, payload) VALUES (?1, ?2)
             ON CONFLICT(account_id) DO UPDATE SET payload=excluded.payload",
            params![account_id, encode(settings)?],
        )?;
        Ok(())
    }

    pub fn load_settings(&self, account_id: &str) -> Result<AccountSettings, CacheError> {
        validate_identifier(account_id)?;
        let payload: Option<String> = self
            .connection
            .query_row(
                "SELECT payload FROM settings WHERE account_id=?1",
                [account_id],
                |row| row.get(0),
            )
            .optional()?;
        match payload {
            Some(payload) => {
                let settings: AccountSettings = decode(&payload)?;
                for id in &settings.selected_repo_ids {
                    validate_identifier(id)?;
                }
                Ok(settings)
            }
            None => Ok(AccountSettings::default()),
        }
    }

    pub fn save_etag(
        &self,
        account_id: &str,
        resource: &str,
        etag: &str,
    ) -> Result<(), CacheError> {
        validate_identifier(account_id)?;
        validate_resource(resource)?;
        validate_etag(Some(etag))?;
        self.connection.execute(
            "INSERT INTO etags (account_id, resource, value) VALUES (?1, ?2, ?3)
             ON CONFLICT(account_id, resource) DO UPDATE SET value=excluded.value",
            params![account_id, resource, etag],
        )?;
        Ok(())
    }

    pub fn load_etag(
        &self,
        account_id: &str,
        resource: &str,
    ) -> Result<Option<String>, CacheError> {
        validate_identifier(account_id)?;
        validate_resource(resource)?;
        let value: Option<String> = self
            .connection
            .query_row(
                "SELECT value FROM etags WHERE account_id=?1 AND resource=?2",
                params![account_id, resource],
                |row| row.get(0),
            )
            .optional()?;
        validate_etag(value.as_deref())?;
        Ok(value)
    }

    pub fn delete_account(&mut self, account_id: &str) -> Result<(), CacheError> {
        validate_identifier(account_id)?;
        let transaction = self.connection.transaction()?;
        for sql in [
            "DELETE FROM snapshots WHERE account_id=?1",
            "DELETE FROM pins WHERE account_id=?1",
            "DELETE FROM settings WHERE account_id=?1",
            "DELETE FROM etags WHERE account_id=?1",
        ] {
            transaction.execute(sql, [account_id])?;
        }
        transaction.commit()?;
        Ok(())
    }
}

fn account_snapshot(account_id: &str, snapshot: &Snapshot) -> Result<Snapshot, CacheError> {
    let account = snapshot
        .accounts
        .iter()
        .find(|account| account.id == account_id)
        .ok_or_else(|| CacheError::Invalid("Unknown cache account.".into()))?;
    let mut scoped = snapshot.clone();
    scoped.accounts = vec![account.clone()];
    scoped.repos.retain(|repo| repo.account_id == account_id);
    let repo_ids: BTreeSet<_> = scoped.repos.iter().map(|repo| repo.id.clone()).collect();
    scoped
        .workflows
        .retain(|workflow| repo_ids.contains(&workflow.repo_id));
    scoped.runs.retain(|run| repo_ids.contains(&run.repo_id));
    scoped
        .pins
        .retain(|pin| pin.account_id == account_id && repo_ids.contains(&pin.repo_id));
    Ok(scoped)
}

fn validate_public_snapshot(snapshot: &Snapshot) -> Result<(), CacheError> {
    for pin in &snapshot.pins {
        validate_pin(pin)?;
    }
    for workflow in &snapshot.workflows {
        for input in &workflow.inputs {
            if let Some(default) = &input.default {
                validate_non_secret_inputs(&[(input.name.clone(), default.clone())].into())
                    .map_err(|error| CacheError::Invalid(error.to_string()))?;
            }
        }
    }
    reject_credential_strings(&serde_json::to_value(snapshot)?)
}

fn validate_pin(pin: &Pin) -> Result<(), CacheError> {
    validate_identifier(&pin.account_id)?;
    validate_identifier(&pin.id)?;
    validate_non_secret_inputs(&pin.inputs)
        .map_err(|error| CacheError::Invalid(error.to_string()))?;
    // Check all public pin strings, including a credential accidentally pasted as its label.
    reject_credential_strings(&serde_json::to_value(pin)?)
}

fn reject_credential_strings(value: &serde_json::Value) -> Result<(), CacheError> {
    match value {
        serde_json::Value::String(value) if looks_like_credential(value) => {
            Err(CacheError::Invalid(
                "Credential-looking values cannot be stored in the local cache.".into(),
            ))
        }
        serde_json::Value::Array(values) => values.iter().try_for_each(reject_credential_strings),
        serde_json::Value::Object(values) => {
            values.values().try_for_each(reject_credential_strings)
        }
        _ => Ok(()),
    }
}

fn validate_identifier(value: &str) -> Result<(), CacheError> {
    if value.trim().is_empty()
        || value.len() > 256
        || value.chars().any(char::is_control)
        || looks_like_credential(value)
    {
        return Err(CacheError::Invalid(
            "Invalid public cache identifier.".into(),
        ));
    }
    Ok(())
}

fn validate_resource(value: &str) -> Result<(), CacheError> {
    if value.len() > 2048 || crate::github::ApiUrl::parse(value).is_err() {
        return Err(CacheError::Invalid(
            "ETag resource must use the GitHub API scope.".into(),
        ));
    }
    Ok(())
}

fn validate_etag(value: Option<&str>) -> Result<(), CacheError> {
    if value.is_some_and(|value| {
        value.len() > 512 || value.chars().any(char::is_control) || looks_like_credential(value)
    }) {
        return Err(CacheError::Invalid("Invalid public ETag.".into()));
    }
    Ok(())
}

fn encode<T: Serialize>(value: &T) -> Result<String, CacheError> {
    let payload = serde_json::to_string(value)?;
    if payload.len() > MAX_CACHE_BYTES {
        return Err(CacheError::Invalid(
            "Cache entry exceeds the safety limit.".into(),
        ));
    }
    Ok(payload)
}

fn decode<T: serde::de::DeserializeOwned>(payload: &str) -> Result<T, CacheError> {
    if payload.len() > MAX_CACHE_BYTES {
        return Err(CacheError::Invalid(
            "Cache entry exceeds the safety limit.".into(),
        ));
    }
    Ok(serde_json::from_str(payload)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::demo::DemoStore;
    use crate::models::InputValue;

    #[test]
    fn uncertain_dispatch_claim_survives_restart_and_stays_target_scoped() {
        let path = std::env::temp_dir().join(format!(
            "repotray-claims-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let cache = Cache::open(&path).unwrap();
            assert!(cache
                .claim_dispatch("account-a/repo/workflow/main")
                .unwrap());
        }
        {
            let cache = Cache::open(&path).unwrap();
            assert!(!cache
                .claim_dispatch("account-a/repo/workflow/main")
                .unwrap());
            assert!(cache
                .claim_dispatch("account-b/repo/workflow/main")
                .unwrap());
            cache
                .resolve_dispatch("account-a/repo/workflow/main")
                .unwrap();
            assert!(cache
                .claim_dispatch("account-a/repo/workflow/main")
                .unwrap());
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn snapshot_pins_settings_and_etags_are_account_isolated() {
        let mut cache = Cache::in_memory().unwrap();
        let snapshot = DemoStore::new().snapshot();
        cache
            .save_snapshot("demo-personal", &snapshot, Some("\"personal\""))
            .unwrap();
        cache
            .save_snapshot("demo-work", &snapshot, Some("\"work\""))
            .unwrap();
        let personal = cache.load_snapshot("demo-personal").unwrap().unwrap();
        let work = cache.load_snapshot("demo-work").unwrap().unwrap();
        assert!(personal.snapshot.stale);
        assert_eq!(personal.snapshot.accounts.len(), 1);
        assert_eq!(personal.etag.as_deref(), Some("\"personal\""));
        assert!(personal
            .snapshot
            .repos
            .iter()
            .all(|repo| repo.account_id == "demo-personal"));
        assert!(work.snapshot.pins.is_empty());
        let personal_ids: BTreeSet<_> = personal
            .snapshot
            .repos
            .iter()
            .map(|repo| &repo.id)
            .collect();
        assert!(personal
            .snapshot
            .runs
            .iter()
            .all(|run| personal_ids.contains(&run.repo_id)));
        cache
            .save_settings(
                "demo-personal",
                &AccountSettings {
                    selected_repo_ids: vec!["demo-personal-kit".into()],
                },
            )
            .unwrap();
        assert!(cache
            .load_settings("demo-work")
            .unwrap()
            .selected_repo_ids
            .is_empty());
        let resource = "https://api.github.com/user/repos?per_page=100&page=1";
        cache
            .save_etag("demo-personal", resource, "\"etag-one\"")
            .unwrap();
        assert_eq!(cache.load_etag("demo-work", resource).unwrap(), None);
        cache.delete_account("demo-personal").unwrap();
        assert!(cache.load_snapshot("demo-personal").unwrap().is_none());
        assert!(cache.load_snapshot("demo-work").unwrap().is_some());
    }

    #[test]
    fn prevents_cross_account_pin_writes_and_secret_storage() {
        let mut cache = Cache::in_memory().unwrap();
        let mut snapshot = DemoStore::new().snapshot();
        let pin = &snapshot.pins[0];
        assert!(cache.save_pin("demo-work", pin).is_err());
        snapshot.pins[0]
            .inputs
            .insert("clientSecret".into(), InputValue::String("hidden".into()));
        assert!(cache
            .save_snapshot("demo-personal", &snapshot, None)
            .is_err());
        // Transaction has not partially written a snapshot or any pins.
        assert!(cache.load_snapshot("demo-personal").unwrap().is_none());
        assert!(cache.load_pins("demo-personal").unwrap().is_empty());
        assert!(cache
            .save_etag("demo-personal", "https://evil.example/", "etag")
            .is_err());
        assert!(cache
            .save_etag(
                "demo-personal",
                "https://api.github.com/user",
                "etag\r\nAuthorization: x"
            )
            .is_err());
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
}
