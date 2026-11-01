//! The gh CLI adapter: auth status in its JSON and legacy forms, and the help probes that
//! decide which flags a gh version supports.
use super::{LocalAccount, Runner, FAILED};
use crate::workflow::looks_like_credential;
use serde::Deserialize;
use std::path::Path;

// New gh versions can rotate expiring credentials; suppress that whenever supported.
// Older versions lack the flag and read stored tokens without automatic refresh.
pub(super) fn gh_help(
    program: &Path,
    command: &str,
    runner: &dyn Runner,
    current: &dyn Fn() -> bool,
) -> Result<String, String> {
    let output = runner.run(program, &["auth", command, "--help"], current)?;
    if !output.success {
        return Err(FAILED.into());
    }
    std::str::from_utf8(&output.bytes)
        .map(str::to_owned)
        .map_err(|_| FAILED.into())
}

pub(super) fn gh_status(
    program: &Path,
    runner: &dyn Runner,
    current: &dyn Fn() -> bool,
) -> Result<(Vec<LocalAccount>, bool), String> {
    let help = gh_help(program, "status", runner, current)?;
    if help.contains("--json") {
        let mut args = vec![
            "auth",
            "status",
            "--hostname",
            "github.com",
            "--json",
            "hosts",
        ];
        if help.contains("--no-refresh") {
            args.push("--no-refresh");
        }
        let output = runner.run(program, &args, current)?;
        if !output.success {
            return Err(FAILED.into());
        }
        Ok((gh_accounts(&output.bytes)?, false))
    } else {
        if help.contains("--no-refresh") {
            return Err("Diese gh-Version stellt keinen kompatiblen Kontostatus bereit. Aktualisiere die GitHub CLI.".into());
        }
        // Legacy gh lacks structured auth status. Ask its read-only /user endpoint for
        // the active identity instead of parsing human output or reading credential files.
        let output = runner.run(
            program,
            &["api", "--hostname", "github.com", "user", "--jq", ".login"],
            current,
        )?;
        if !output.success {
            return Err(FAILED.into());
        }
        let login = std::str::from_utf8(&output.bytes)
            .map_err(|_| FAILED)?
            .trim();
        if !valid_login(login) {
            return Err(FAILED.into());
        }
        Ok((vec![LocalAccount {
            source: "gh".into(), host: "github.com".into(), login: login.into(), usable: true, active: true,
            detail: "Aktives gh-Konto über GitHub bestätigt. Noch nicht mit RepoTray verbunden.".into(),
            actions_read: "Scopes nicht auslesbar; Actions lesen pro Repository ungeprüft.".into(),
            actions_write: "Actions starten: pro Repository ungeprüft; kein Workflow wurde zum Prüfen gestartet.".into(),
        }], true))
    }
}

pub(super) fn valid_login(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 39
        && !value.starts_with('-')
        && !value.ends_with('-')
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        && !looks_like_credential(value)
}
#[derive(Deserialize)]
struct GhStatus {
    hosts: std::collections::BTreeMap<String, Vec<GhAccount>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhAccount {
    host: String,
    login: String,
    state: String,
    #[serde(default)]
    active: bool,
    #[serde(default)]
    scopes: String,
    #[serde(default)]
    token_source: String,
}
pub(super) fn gh_accounts(bytes: &[u8]) -> Result<Vec<LocalAccount>, String> {
    let status: GhStatus = serde_json::from_slice(bytes).map_err(|_| FAILED)?;
    let mut accounts = Vec::new();
    for account in status
        .hosts
        .get("github.com")
        .into_iter()
        .flatten()
        .take(50)
    {
        if account.host != "github.com" || !valid_login(&account.login) {
            continue;
        }
        let usable = account.state == "success"
            && !account
                .token_source
                .to_ascii_uppercase()
                .ends_with("_TOKEN");
        let scopes: Vec<_> = account
            .scopes
            .split([',', ' ', '\''])
            .filter(|s| !s.is_empty())
            .collect();
        let repo = scopes.contains(&"repo");
        accounts.push(LocalAccount {
            source: "gh".into(), host: account.host.clone(), login: account.login.clone(), active: account.active, usable,
            detail: if usable { "GitHub-API-Anmeldung bestätigt · bevorzugte Quelle" } else { "Anmeldung ungültig, abgelaufen oder keine gespeicherte lokale Anmeldung" }.into(),
            actions_read: if repo { "Scope repo vorhanden; private Actions grundsätzlich abgedeckt. Repository-/Org-Zugriff noch ungeprüft." } else if account.scopes.is_empty() { "Scopes nicht auslesbar; Actions lesen pro Repository ungeprüft." } else { "Scope repo fehlt; Zugriff auf private Actions nicht belegt. Feinere Rechte pro Repository ungeprüft." }.into(),
            actions_write: "Actions starten: pro Repository ungeprüft; kein Workflow wurde zum Prüfen gestartet.".into(),
        });
    }
    accounts.sort_by(|a, b| a.login.cmp(&b.login));
    accounts.dedup_by(|a, b| a.login == b.login);
    Ok(accounts)
}
