//! Account-scoped SQLite storage for public preferences and cached metadata only.
//! Credentials have no column, API, or serialization path in this module.

use crate::models::{DispatchTarget, InputValue, Pin, Snapshot, UncertainStart};
use crate::workflow::{looks_like_credential, sensitive_key, validate_non_secret_inputs};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::fmt;
use std::path::Path;
use std::time::Duration;

const MAX_CACHE_BYTES: usize = 2 * 1024 * 1024;
/// Replaces GitHub-sourced strings that look like credentials in the written cache only.
pub const REDACTED: &str = "[entfernt]";
/// Settings-table row for app-wide preferences; no account can use this ID.
const APP_SETTINGS_KEY: &str = "@app";

type Migration = fn(&Transaction) -> Result<(), CacheError>;
/// Ordered schema migrations; `PRAGMA user_version` is the number already applied.
const MIGRATIONS: &[Migration] = &[migrate_v1_baseline, migrate_v2_claims_without_etags];

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

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountSettings {
    pub selected_repo_ids: Vec<String>,
}

/// App-wide preferences. Unknown fields are tolerated so an older build can read a newer row.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub notifications: bool,
}

/// Result of an explicit release request for one uncertain start.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Release {
    Released,
    /// No claim exists for the target (already released or resolved).
    Missing,
    /// The target holds a claim with another claim time than the one reviewed.
    Replaced,
}

pub struct Cache {
    connection: Connection,
    /// Last written payload per account with `updatedAt` cleared, to skip unchanged writes.
    written: HashMap<String, String>,
}

impl Cache {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, CacheError> {
        Self::from_connection(Connection::open(path)?)
    }

    pub fn in_memory() -> Result<Self, CacheError> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(mut connection: Connection) -> Result<Self, CacheError> {
        connection.busy_timeout(Duration::from_secs(5))?;
        // WAL with NORMAL sync stays consistent after a crash; at worst the last commit is lost.
        connection
            .pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        migrate(&mut connection)?;
        Ok(Self {
            connection,
            written: HashMap::new(),
        })
    }

    pub fn account_ids(&self) -> Result<Vec<String>, CacheError> {
        let mut query = self
            .connection
            .prepare("SELECT account_id FROM snapshots ORDER BY account_id")?;
        let rows = query.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(CacheError::Database)
    }

    /// Written before a dispatch is sent and kept across restarts. `None` means the target
    /// already holds a claim: its last start is unresolved, so nothing may be sent.
    pub fn claim_dispatch(
        &self,
        target: &DispatchTarget,
        claimed_at: &str,
    ) -> Result<Option<UncertainStart>, CacheError> {
        let workflow_id = validate_target(target)?;
        if claimed_at.trim().is_empty()
            || claimed_at.len() > 64
            || claimed_at.chars().any(char::is_control)
        {
            return Err(CacheError::Invalid("Invalid claim time.".into()));
        }
        let inserted = self.connection.execute(
            "INSERT OR IGNORE INTO dispatch_claims
                 (account_id, repo_id, workflow_id, git_ref, claimed_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                target.account_id,
                target.repo_id,
                workflow_id,
                target.git_ref,
                claimed_at
            ],
        )? == 1;
        Ok(inserted.then(|| UncertainStart {
            account_id: target.account_id.clone(),
            repo_id: target.repo_id.clone(),
            workflow_id: target.workflow_id,
            git_ref: target.git_ref.clone(),
            claimed_at: Some(claimed_at.into()),
        }))
    }

    /// Removes a claim after GitHub gave a definite answer (accepted or rejected).
    pub fn resolve_dispatch(&self, target: &DispatchTarget) -> Result<(), CacheError> {
        let workflow_id = validate_target(target)?;
        self.connection.execute(
            "DELETE FROM dispatch_claims
             WHERE account_id=?1 AND repo_id=?2 AND workflow_id=?3 AND git_ref=?4",
            params![
                target.account_id,
                target.repo_id,
                workflow_id,
                target.git_ref
            ],
        )?;
        Ok(())
    }

    pub fn uncertain_starts(&self) -> Result<Vec<UncertainStart>, CacheError> {
        let mut query = self.connection.prepare(
            "SELECT account_id, repo_id, workflow_id, git_ref, claimed_at FROM dispatch_claims
             ORDER BY claimed_at, account_id, repo_id, workflow_id, git_ref",
        )?;
        let rows = query.query_map([], |row| {
            Ok(UncertainStart {
                account_id: row.get(0)?,
                repo_id: row.get(1)?,
                workflow_id: row.get::<_, i64>(2)?.max(0) as u64,
                git_ref: row.get(3)?,
                claimed_at: row.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(CacheError::Database)
    }

    /// Releases exactly the claim the user reviewed on GitHub. Only an explicit user command
    /// may call this; there is no automatic release.
    pub fn release_uncertain_start(&self, start: &UncertainStart) -> Result<Release, CacheError> {
        let target = start.target();
        let workflow_id = validate_target(&target)?;
        let released = self.connection.execute(
            "DELETE FROM dispatch_claims
             WHERE account_id=?1 AND repo_id=?2 AND workflow_id=?3 AND git_ref=?4
               AND claimed_at IS ?5",
            params![
                target.account_id,
                target.repo_id,
                workflow_id,
                target.git_ref,
                start.claimed_at
            ],
        )?;
        if released == 1 {
            return Ok(Release::Released);
        }
        let other: Option<i64> = self
            .connection
            .query_row(
                "SELECT 1 FROM dispatch_claims
                 WHERE account_id=?1 AND repo_id=?2 AND workflow_id=?3 AND git_ref=?4",
                params![
                    target.account_id,
                    target.repo_id,
                    workflow_id,
                    target.git_ref
                ],
                |row| row.get(0),
            )
            .optional()?;
        Ok(if other.is_some() {
            Release::Replaced
        } else {
            Release::Missing
        })
    }

    /// Stores GitHub metadata for one account. Pins and claims live in their own tables and
    /// are never written or deleted here. An unchanged payload (ignoring `updatedAt`) is not
    /// rewritten, so a cached `updatedAt` may be older than the last successful refresh.
    pub fn save_snapshot(
        &mut self,
        account_id: &str,
        snapshot: &Snapshot,
    ) -> Result<(), CacheError> {
        validate_account_id(account_id)?;
        let mut scoped = public_snapshot(account_id, snapshot)?;
        // Defense in depth: redaction must have left no credential-looking string behind.
        reject_credential_strings(&serde_json::to_value(&scoped)?)?;
        let updated_at = std::mem::take(&mut scoped.updated_at);
        let comparable = encode(&scoped)?;
        if self.written.get(account_id) == Some(&comparable) {
            return Ok(());
        }
        scoped.updated_at = updated_at;
        self.connection.execute(
            "INSERT INTO snapshots (account_id, payload) VALUES (?1, ?2)
             ON CONFLICT(account_id) DO UPDATE SET payload=excluded.payload",
            params![account_id, encode(&scoped)?],
        )?;
        self.written.insert(account_id.into(), comparable);
        Ok(())
    }

    pub fn load_snapshot(&self, account_id: &str) -> Result<Option<Snapshot>, CacheError> {
        validate_account_id(account_id)?;
        let payload: Option<String> = self
            .connection
            .query_row(
                "SELECT payload FROM snapshots WHERE account_id=?1",
                [account_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(payload) = payload else {
            return Ok(None);
        };
        let original: Snapshot = decode(&payload)?;
        let mut snapshot = public_snapshot(account_id, &original)?;
        snapshot.pins = self.load_pins(account_id)?;
        snapshot.stale = true;
        Ok(Some(snapshot))
    }

    pub fn save_pin(&self, account_id: &str, pin: &Pin) -> Result<(), CacheError> {
        validate_account_id(account_id)?;
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
        validate_account_id(account_id)?;
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
        validate_account_id(account_id)?;
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
        validate_account_id(account_id)?;
        for id in &settings.selected_repo_ids {
            validate_identifier(id)?;
        }
        self.write_settings_row(account_id, &encode(settings)?)
    }

    pub fn load_settings(&self, account_id: &str) -> Result<AccountSettings, CacheError> {
        validate_account_id(account_id)?;
        match self.read_settings_row(account_id)? {
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

    pub fn save_app_settings(&self, settings: &AppSettings) -> Result<(), CacheError> {
        self.write_settings_row(APP_SETTINGS_KEY, &encode(settings)?)
    }

    pub fn load_app_settings(&self) -> Result<AppSettings, CacheError> {
        match self.read_settings_row(APP_SETTINGS_KEY)? {
            Some(payload) => decode(&payload),
            None => Ok(AppSettings::default()),
        }
    }

    fn write_settings_row(&self, key: &str, payload: &str) -> Result<(), CacheError> {
        self.connection.execute(
            "INSERT INTO settings (account_id, payload) VALUES (?1, ?2)
             ON CONFLICT(account_id) DO UPDATE SET payload=excluded.payload",
            params![key, payload],
        )?;
        Ok(())
    }

    fn read_settings_row(&self, key: &str) -> Result<Option<String>, CacheError> {
        Ok(self
            .connection
            .query_row(
                "SELECT payload FROM settings WHERE account_id=?1",
                [key],
                |row| row.get(0),
            )
            .optional()?)
    }

    /// Removes only an account's snapshot row, for a connect whose credential was never
    /// stored. Pins, settings and claims stay: a claim is released only by an explicit user
    /// command.
    pub fn delete_snapshot(&mut self, account_id: &str) -> Result<(), CacheError> {
        validate_account_id(account_id)?;
        self.connection
            .execute("DELETE FROM snapshots WHERE account_id=?1", [account_id])?;
        self.written.remove(account_id);
        Ok(())
    }

    /// Removes everything stored for an account, including its uncertain-start claims.
    pub fn delete_account(&mut self, account_id: &str) -> Result<(), CacheError> {
        validate_account_id(account_id)?;
        let transaction = self.connection.transaction()?;
        for sql in [
            "DELETE FROM snapshots WHERE account_id=?1",
            "DELETE FROM pins WHERE account_id=?1",
            "DELETE FROM settings WHERE account_id=?1",
            "DELETE FROM dispatch_claims WHERE account_id=?1",
        ] {
            transaction.execute(sql, [account_id])?;
        }
        transaction.commit()?;
        self.written.remove(account_id);
        Ok(())
    }
}

fn migrate(connection: &mut Connection) -> Result<(), CacheError> {
    let applied: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let applied = usize::try_from(applied).unwrap_or(usize::MAX);
    if applied > MIGRATIONS.len() {
        return Err(CacheError::Invalid(
            "The local cache was written by a newer RepoTray version.".into(),
        ));
    }
    for (index, migration) in MIGRATIONS.iter().enumerate().skip(applied) {
        let transaction = connection.transaction()?;
        migration(&transaction)?;
        transaction.pragma_update(None, "user_version", index as i64 + 1)?;
        transaction.commit()?;
    }
    Ok(())
}

/// The unversioned schema of earlier builds; a no-op for their existing databases.
fn migrate_v1_baseline(transaction: &Transaction) -> Result<(), CacheError> {
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS dispatch_claims (target TEXT PRIMARY KEY NOT NULL);
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
    Ok(())
}

/// Structured claims with a claim time; the never-read ETag storage is dropped.
fn migrate_v2_claims_without_etags(transaction: &Transaction) -> Result<(), CacheError> {
    transaction.execute_batch(
        "DROP TABLE etags;
         CREATE TABLE snapshots_v2 (
             account_id TEXT PRIMARY KEY NOT NULL,
             payload TEXT NOT NULL
         );
         INSERT INTO snapshots_v2 (account_id, payload) SELECT account_id, payload FROM snapshots;
         DROP TABLE snapshots;
         ALTER TABLE snapshots_v2 RENAME TO snapshots;
         CREATE TABLE dispatch_claims_v2 (
             account_id TEXT NOT NULL,
             repo_id TEXT NOT NULL,
             workflow_id INTEGER NOT NULL,
             git_ref TEXT NOT NULL,
             claimed_at TEXT,
             PRIMARY KEY (account_id, repo_id, workflow_id, git_ref)
         );",
    )?;
    let legacy: Vec<String> = {
        let mut query = transaction.prepare("SELECT target FROM dispatch_claims")?;
        let rows = query.query_map([], |row| row.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    for target in legacy {
        // Earlier builds always wrote `[accountId, repoId, workflowId, ref]` as JSON, so a row
        // in any other shape never matched a claim and never locked a target.
        if let Ok((account_id, repo_id, workflow_id, git_ref)) =
            serde_json::from_str::<(String, String, i64, String)>(&target)
        {
            transaction.execute(
                "INSERT OR IGNORE INTO dispatch_claims_v2
                     (account_id, repo_id, workflow_id, git_ref, claimed_at)
                 VALUES (?1, ?2, ?3, ?4, NULL)",
                params![account_id, repo_id, workflow_id, git_ref],
            )?;
        }
    }
    transaction.execute_batch(
        "DROP TABLE dispatch_claims;
         ALTER TABLE dispatch_claims_v2 RENAME TO dispatch_claims;",
    )?;
    Ok(())
}

/// Scopes a snapshot to one account and makes it safe to store. Pins and claims are left out
/// (they have their own tables). GitHub-sourced strings that look like credentials are
/// redacted instead of failing the write: a workflow input named `tokenizer_model` or a
/// description starting with "Bearer " must not break refresh for every repository.
fn public_snapshot(account_id: &str, snapshot: &Snapshot) -> Result<Snapshot, CacheError> {
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
    scoped.pins.clear();
    scoped.uncertain_starts.clear();
    for input in scoped
        .workflows
        .iter_mut()
        .flat_map(|workflow| &mut workflow.inputs)
    {
        let secret_default = matches!(
            &input.default,
            Some(InputValue::String(value)) if looks_like_credential(value)
        );
        if sensitive_key(&input.name) || secret_default {
            input.default = None;
        }
        input
            .options
            .retain(|option| !looks_like_credential(option));
    }
    let mut value = serde_json::to_value(&scoped)?;
    redact_credential_strings(&mut value);
    Ok(serde_json::from_value(value)?)
}

fn redact_credential_strings(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::String(text) if looks_like_credential(text) => {
            *text = REDACTED.into();
        }
        serde_json::Value::Array(values) => values.iter_mut().for_each(redact_credential_strings),
        serde_json::Value::Object(values) => {
            values.values_mut().for_each(redact_credential_strings)
        }
        _ => {}
    }
}

/// Pins are user-written, so a credential-looking value is rejected rather than redacted.
fn validate_pin(pin: &Pin) -> Result<(), CacheError> {
    validate_account_id(&pin.account_id)?;
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

/// Returns the workflow ID as stored by SQLite.
fn validate_target(target: &DispatchTarget) -> Result<i64, CacheError> {
    validate_account_id(&target.account_id)?;
    validate_identifier(&target.repo_id)?;
    validate_identifier(&target.git_ref)?;
    i64::try_from(target.workflow_id)
        .ok()
        .filter(|id| *id > 0)
        .ok_or_else(|| CacheError::Invalid("Invalid workflow ID.".into()))
}

fn validate_account_id(value: &str) -> Result<(), CacheError> {
    validate_identifier(value)?;
    if value == APP_SETTINGS_KEY {
        return Err(CacheError::Invalid(
            "Invalid public cache identifier.".into(),
        ));
    }
    Ok(())
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
mod tests;
