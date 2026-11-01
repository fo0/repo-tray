//! Ordered SQLite schema migrations, each applied in its own transaction.
use super::CacheError;
use rusqlite::{params, Connection, Transaction};

type Migration = fn(&Transaction) -> Result<(), CacheError>;
/// Ordered schema migrations; `PRAGMA user_version` is the number already applied.
pub(super) const MIGRATIONS: &[Migration] = &[migrate_v1_baseline, migrate_v2_claims_without_etags];

pub(super) fn migrate(connection: &mut Connection) -> Result<(), CacheError> {
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
