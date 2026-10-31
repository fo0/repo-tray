//! Explicit, read-only local account discovery. No startup credential reads, shell, or login.
//! Only gh has a supported API token adapter. GCM's Git helper is deliberately not invoked.
use crate::{auth::SecretToken, workflow::looks_like_credential};
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

const LIMIT: u64 = 64 * 1024;
const TIMEOUT: Duration = Duration::from_secs(20);
const FAILED: &str = "Lokale Quelle nicht prüfbar. Aktuelle gh CLI mit --json und --no-refresh erforderlich; Anmeldung oder Netzwerk prüfen.";
const CANCELLED: &str = "Lokale Prüfung wurde abgebrochen.";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalAccount {
    pub source: String,
    pub host: String,
    pub login: String,
    pub usable: bool,
    pub active: bool,
    pub detail: String,
    pub actions_read: String,
    pub actions_write: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDiscovery {
    pub accounts: Vec<LocalAccount>,
    pub notices: Vec<String>,
}

// Secrets, stderr and raw process output deliberately have no Debug/Serialize implementation.
pub struct Output {
    pub success: bool,
    pub bytes: Vec<u8>,
    stderr: Vec<u8>,
}
impl Drop for Output {
    fn drop(&mut self) {
        self.bytes.fill(0);
        self.stderr.fill(0);
        std::hint::black_box(&mut self.bytes);
        std::hint::black_box(&mut self.stderr);
    }
}
pub trait Runner {
    fn run(
        &self,
        program: &Path,
        args: &[&str],
        current: &dyn Fn() -> bool,
    ) -> Result<Output, String>;
}
pub struct ProcessRunner;
impl Runner for ProcessRunner {
    fn run(
        &self,
        program: &Path,
        args: &[&str],
        current: &dyn Fn() -> bool,
    ) -> Result<Output, String> {
        run_process(program, args, current, TIMEOUT)
    }
}

fn run_process(
    program: &Path,
    args: &[&str],
    current: &dyn Fn() -> bool,
    timeout: Duration,
) -> Result<Output, String> {
    if !program.is_absolute() || !current() {
        return Err(CANCELLED.into());
    }
    let mut command = Command::new(program);
    command
        .args(args)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // No inherited GH_TOKEN/GITHUB_TOKEN, GH_HOST, GH_CONFIG_DIR, GH_DEBUG, GIT_CONFIG_*,
    // askpass, tracing, extension paths, or CI credentials. Use the desktop user's normal store.
    for name in [
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "SystemRoot",
        "WINDIR",
        "TEMP",
        "TMP",
    ] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("GH_NO_EXTENSION_UPDATE_NOTIFIER", "1")
        .env("NO_COLOR", "1")
        .env("GCM_INTERACTIVE", "0")
        .env("GCM_TRACE", "0")
        .env("GCM_TRACE_SECRETS", "0");
    // Never search the app/repository/current directory, even for child utilities.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        if let Some(root) = std::env::var_os("SystemRoot") {
            let system = PathBuf::from(root).join("System32");
            command.env("PATH", &system).current_dir(system);
        } else {
            return Err(FAILED.into());
        }
        // GCM itself locates Git to read configuration. Supply only the validated
        // installed executable directory, never an inherited GIT_EXEC_PATH or PATH.
        if args == ["github", "list", "--url", "https://github.com"] {
            if let Some(git) = Programs::installed().git {
                if let Some(directory) = git.parent() {
                    command.env("GIT_EXEC_PATH", directory);
                }
            }
        }
    }
    #[cfg(not(windows))]
    command.env("PATH", "/usr/bin:/bin").current_dir("/");
    let mut child = command.spawn().map_err(|_| FAILED.to_string())?;
    let stdout = child.stdout.take().ok_or(FAILED)?;
    let stderr = child.stderr.take().ok_or(FAILED)?;
    let (send, receive) = mpsc::sync_channel(2);
    capture(stdout, send.clone(), false);
    capture(stderr, send, true);
    let deadline = Instant::now() + timeout;
    let mut output = None;
    let mut diagnostics = None;
    loop {
        if !current() || Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(if !current() {
                CANCELLED
            } else {
                "Zeitlimit bei lokaler Quelle erreicht."
            }
            .into());
        }
        match receive.try_recv() {
            Ok((false, Some(value))) => output = Some(value),
            Ok((true, Some(value))) => diagnostics = Some(value),
            Ok((_, None)) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(FAILED.into());
            }
            Err(mpsc::TryRecvError::Disconnected) if output.is_none() || diagnostics.is_none() => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(FAILED.into());
            }
            _ => {}
        }
        match child.try_wait() {
            Ok(Some(status)) if output.is_some() && diagnostics.is_some() => {
                let mut value = output.take().ok_or(FAILED)?;
                value.stderr = std::mem::take(&mut diagnostics.take().ok_or(FAILED)?.bytes);
                value.success = status.success();
                return Ok(value);
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(FAILED.into());
            }
            _ => std::thread::sleep(Duration::from_millis(20)),
        }
    }
}

fn capture(
    stream: impl Read + Send + 'static,
    send: mpsc::SyncSender<(bool, Option<Output>)>,
    stderr: bool,
) {
    std::thread::spawn(move || {
        let mut output = Output {
            success: false,
            bytes: Vec::new(),
            stderr: Vec::new(),
        };
        let result = stream.take(LIMIT + 1).read_to_end(&mut output.bytes);
        let _ = send.send((
            stderr,
            if result.is_ok() && output.bytes.len() <= LIMIT as usize {
                Some(output)
            } else {
                None
            },
        ));
    });
}

#[derive(Default)]
pub struct Programs {
    pub gh: Option<PathBuf>,
    pub gcm: Option<PathBuf>,
    pub git: Option<PathBuf>,
}
impl Programs {
    /// Windows install locations only; no PATH lookup, shell aliases, .cmd files or repo binaries.
    pub fn installed() -> Self {
        #[cfg(windows)]
        {
            let roots: Vec<_> = ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"]
                .iter()
                .filter_map(std::env::var_os)
                .map(PathBuf::from)
                .filter(|p| p.is_absolute())
                .collect();
            let first = |suffix: &str| {
                roots
                    .iter()
                    .map(|r| r.join(suffix))
                    .find_map(safe_executable)
            };
            let gh = first("GitHub CLI/gh.exe").or_else(|| {
                std::env::var_os("LOCALAPPDATA")
                    .map(PathBuf::from)
                    .filter(|p| p.is_absolute())
                    .and_then(|r| safe_executable(r.join("Programs/GitHub CLI/gh.exe")))
            });
            Self {
                gh,
                gcm: first("Git Credential Manager/git-credential-manager.exe")
                    .or_else(|| first("Git/mingw64/bin/git-credential-manager.exe")),
                git: first("Git/cmd/git.exe"),
            }
        }
        #[cfg(not(windows))]
        Self::default()
    }
}
#[cfg(windows)]
fn safe_executable(path: PathBuf) -> Option<PathBuf> {
    if !path.is_absolute() || !path.is_file() || path.extension()?.to_str()? != "exe" {
        return None;
    }
    path.canonicalize().ok()
}

fn valid_login(value: &str) -> bool {
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
fn gh_accounts(bytes: &[u8]) -> Result<Vec<LocalAccount>, String> {
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
            && !account.token_source.to_ascii_uppercase().contains("TOKEN");
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

pub fn discover(
    programs: &Programs,
    runner: &dyn Runner,
    current: &dyn Fn() -> bool,
) -> Result<LocalDiscovery, String> {
    if !current() {
        return Err(CANCELLED.into());
    }
    let mut result = LocalDiscovery {
        accounts: Vec::new(),
        notices: Vec::new(),
    };
    if let Some(gh) = &programs.gh {
        match runner
            .run(
                gh,
                &[
                    "auth",
                    "status",
                    "--hostname",
                    "github.com",
                    "--json",
                    "hosts",
                    "--no-refresh",
                ],
                current,
            )
            .and_then(|out| {
                if out.success {
                    gh_accounts(&out.bytes)
                } else {
                    Err(FAILED.into())
                }
            }) {
            Ok(accounts) => {
                if accounts.is_empty() {
                    result
                        .notices
                        .push("gh CLI: keine gespeicherte GitHub.com-Anmeldung gefunden.".into());
                }
                result.accounts.extend(accounts);
            }
            Err(error) => result.notices.push(error),
        }
    } else {
        result
            .notices
            .push("gh CLI: an unterstützten Windows-Installationsorten nicht gefunden.".into());
    }
    if let Some(gcm) = &programs.gcm {
        match runner.run(
            gcm,
            &["github", "list", "--url", "https://github.com"],
            current,
        ) {
            Ok(out) if out.success => {
                // GCM v2 writes names to stdout; v3's ConsoleService uses stderr.
                // Only valid GitHub handles from a successful fixed list command leave
                // this boundary. Never return diagnostic text or process errors.
                let names = std::str::from_utf8(&out.bytes).unwrap_or("");
                let names_v3 = std::str::from_utf8(&out.stderr).unwrap_or("");
                let before = result.accounts.len();
                for login in names
                    .lines()
                    .chain(names_v3.lines())
                    .map(str::trim)
                    .filter(|v| valid_login(v))
                    .take(50)
                {
                    result.accounts.push(LocalAccount { source: "gcm".into(), host: "github.com".into(), login: login.into(), usable: false, active: false,
                        detail: "Git Credential Manager: gespeichertes Git-Konto; API-Übernahme hier nicht unterstützt.".into(),
                        actions_read: "Git-Anmeldung belegt keine Actions-API-Rechte.".into(), actions_write: "Actions starten: nicht nachgewiesen.".into() });
                }
                result.notices.push(if result.accounts.len() == before {
                    "GCM erkannt; keine lesbaren Account-Namen verfügbar. Keine API-Anmeldung nachgewiesen. Nutze gh CLI oder einen API-Token."
                } else { "GCM erkannt. Nur Account-Namen geprüft; Git-Credentials werden nicht exportiert. Nutze gh CLI oder einen API-Token." }.into());
            }
            _ => result.notices.push(
                "GCM erkannt; Account-Liste nicht verfügbar. Keine API-Anmeldung nachgewiesen."
                    .into(),
            ),
        }
    } else {
        result.notices.push(
            "Git Credential Manager: an unterstützten Installationsorten nicht gefunden.".into(),
        );
    }
    result.notices.push(if programs.git.is_some() { "Git erkannt. Binary, Remote und SSH-Anmeldung belegen keine GitHub-API-Anmeldung." } else { "Git: an unterstützten Installationsorten nicht gefunden. Git allein ist keine API-Anmeldequelle." }.into());
    if !current() {
        return Err(CANCELLED.into());
    }
    Ok(result)
}

/// Called only after explicit selection and confirmation of OS-keyring import in the UI.
pub fn selected_token(
    programs: &Programs,
    runner: &dyn Runner,
    login: &str,
    current: &dyn Fn() -> bool,
) -> Result<SecretToken, String> {
    if !valid_login(login) {
        return Err("Lokales Konto ungültig.".into());
    }
    if !current() {
        return Err(CANCELLED.into());
    }
    let gh = programs.gh.as_deref().ok_or(FAILED)?;
    let status = runner.run(
        gh,
        &[
            "auth",
            "status",
            "--hostname",
            "github.com",
            "--json",
            "hosts",
            "--no-refresh",
        ],
        current,
    )?;
    if !status.success {
        return Err(FAILED.into());
    }
    if !gh_accounts(&status.bytes)?
        .iter()
        .any(|a| a.source == "gh" && a.login == login && a.usable)
    {
        return Err("Gewählte lokale Anmeldung ist nicht mehr verfügbar. Erneut prüfen.".into());
    }
    if !current() {
        return Err(CANCELLED.into());
    }
    let out = runner.run(
        gh,
        &[
            "auth",
            "token",
            "--hostname",
            "github.com",
            "--user",
            login,
            "--no-refresh",
        ],
        current,
    )?;
    if !out.success || !current() {
        return Err(FAILED.into());
    }
    let token = std::str::from_utf8(&out.bytes)
        .map_err(|_| FAILED)?
        .trim_end_matches(['\r', '\n']);
    if token.is_empty()
        || token.len() > 2048
        || token
            .bytes()
            .any(|b| b.is_ascii_whitespace() || b.is_ascii_control())
    {
        return Err(FAILED.into());
    }
    Ok(SecretToken::new(token.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    const FIXTURE: &[u8] = include_bytes!("../../fixtures/local-auth.json");
    struct Mock {
        calls: Mutex<Vec<Vec<String>>>,
        success: bool,
    }
    impl Runner for Mock {
        fn run(&self, _: &Path, args: &[&str], _: &dyn Fn() -> bool) -> Result<Output, String> {
            self.calls
                .lock()
                .unwrap()
                .push(args.iter().map(|s| s.to_string()).collect());
            Ok(Output {
                success: self.success,
                stderr: Vec::new(),
                bytes: match args.get(1) {
                    Some(&"status") => FIXTURE.to_vec(),
                    Some(&"token") => b"fixture-value\r\n".to_vec(),
                    _ => b"fixture-gcm\ninvalid diagnostic with spaces\n--bad\n".to_vec(),
                },
            })
        }
    }
    fn mock(success: bool) -> Mock {
        Mock {
            calls: Mutex::new(Vec::new()),
            success,
        }
    }
    fn programs() -> Programs {
        Programs {
            gh: Some("/fixtures/gh.exe".into()),
            gcm: Some("/fixtures/gcm.exe".into()),
            git: Some("/fixtures/git.exe".into()),
        }
    }

    #[test]
    fn discovers_accounts_without_claiming_git_or_push_is_api_authorization() {
        let runner = mock(true);
        let result = discover(&programs(), &runner, &|| true).unwrap();
        assert_eq!(result.accounts.iter().filter(|a| a.usable).count(), 3);
        let alex = result
            .accounts
            .iter()
            .find(|a| a.login == "fixture-alex")
            .unwrap();
        assert!(alex.actions_read.contains("repo vorhanden"));
        assert!(alex.actions_write.contains("ungeprüft"));
        assert!(result
            .accounts
            .iter()
            .find(|a| a.login == "fixture-sam")
            .unwrap()
            .actions_read
            .contains("nicht auslesbar"));
        assert!(result
            .accounts
            .iter()
            .find(|a| a.login == "fixture-public")
            .unwrap()
            .actions_read
            .contains("repo fehlt"));
        assert!(
            !result
                .accounts
                .iter()
                .find(|a| a.login == "fixture-expired")
                .unwrap()
                .usable
        );
        assert!(
            !result
                .accounts
                .iter()
                .find(|a| a.login == "fixture-ci")
                .unwrap()
                .usable
        );
        assert!(
            !result
                .accounts
                .iter()
                .find(|a| a.source == "gcm")
                .unwrap()
                .usable
        );
        let json = serde_json::to_string(&result).unwrap();
        assert!(!json.contains("untrusted diagnostic"));
        assert!(!json.contains("GH_TOKEN"));
        assert!(!json.contains("--malicious"));
        assert!(!json.contains("enterprise.example"));
        let calls = runner.calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert!(calls[0].iter().any(|a| a == "--no-refresh"));
        assert!(!calls
            .iter()
            .flatten()
            .any(|a| ["token", "get", "fill", "login", "switch", "refresh"].contains(&a.as_str())));
    }
    #[test]
    fn missing_and_unsupported_sources_fail_honestly_without_fallback() {
        let runner = mock(false);
        let empty = discover(&Programs::default(), &runner, &|| true).unwrap();
        assert!(empty.accounts.is_empty());
        assert!(runner.calls.lock().unwrap().is_empty());
        let failed = discover(&programs(), &runner, &|| true).unwrap();
        assert!(failed.accounts.is_empty());
        assert!(failed.notices.iter().any(|n| n.contains("--no-refresh")));
    }
    #[test]
    fn only_explicit_valid_account_gets_an_exact_non_refreshing_token_request() {
        let runner = mock(true);
        let token = selected_token(&programs(), &runner, "fixture-sam", &|| true).unwrap();
        token.with_secret(|value| assert_eq!(value, "fixture-value"));
        let calls = runner.calls.lock().unwrap();
        assert_eq!(
            calls.last().unwrap(),
            &[
                "auth",
                "token",
                "--hostname",
                "github.com",
                "--user",
                "fixture-sam",
                "--no-refresh"
            ]
        );
        assert!(!format!("{token:?}").contains("fixture-value"));
    }
    #[test]
    fn selection_tampering_and_cancel_never_read_credentials() {
        let runner = mock(true);
        for login in [
            "--help",
            "a;whoami",
            "a\nb",
            "fixture-gcm",
            "fixture-expired",
            "fixture-ci",
            "unknown",
        ] {
            assert!(selected_token(&programs(), &runner, login, &|| true).is_err());
        }
        assert!(!runner
            .calls
            .lock()
            .unwrap()
            .iter()
            .flatten()
            .any(|arg| arg == "token"));
        let before = runner.calls.lock().unwrap().len();
        assert!(selected_token(&programs(), &runner, "fixture-sam", &|| false).is_err());
        assert_eq!(runner.calls.lock().unwrap().len(), before);
    }
    #[test]
    fn gcm_v3_metadata_on_stderr_is_filtered_and_never_returned_as_a_diagnostic() {
        struct V3;
        impl Runner for V3 {
            fn run(&self, _: &Path, _: &[&str], _: &dyn Fn() -> bool) -> Result<Output, String> {
                Ok(Output {
                    success: true,
                    bytes: Vec::new(),
                    stderr: b"fixture-gcm-v3\nwarning: private diagnostic\nnot-an-account!\n"
                        .to_vec(),
                })
            }
        }
        let result = discover(
            &Programs {
                gcm: Some("/fixtures/gcm.exe".into()),
                ..Programs::default()
            },
            &V3,
            &|| true,
        )
        .unwrap();
        assert_eq!(result.accounts.len(), 1);
        assert_eq!(result.accounts[0].login, "fixture-gcm-v3");
        assert!(!result.accounts[0].usable);
        let json = serde_json::to_string(&result).unwrap();
        assert!(!json.contains("private diagnostic"));
        assert!(!json.contains("not-an-account!"));
    }
    #[cfg(unix)]
    #[test]
    fn mock_processes_bound_time_output_and_stderr_without_inheriting_auth() {
        // Executes only synthetic programs. Never invokes the developer machine's gh/Git/GCM.
        let python = Path::new("/usr/bin/python3");
        let out = run_process(python, &["-c", "import os,sys; assert 'GH_TOKEN' not in os.environ and 'GITHUB_TOKEN' not in os.environ and 'GH_DEBUG' not in os.environ; print('fixture-output'); print('private-diagnostic',file=sys.stderr)"], &|| true, Duration::from_secs(2)).unwrap();
        assert_eq!(out.bytes, b"fixture-output\n");
        assert!(!out.bytes.windows(7).any(|v| v == b"private"));
        assert!(run_process(
            python,
            &["-c", "print('x'*70000)"],
            &|| true,
            Duration::from_secs(2)
        )
        .is_err());
        assert!(run_process(
            python,
            &["-c", "import sys; sys.stderr.write('x'*70000)"],
            &|| true,
            Duration::from_secs(2)
        )
        .is_err());
        let start = Instant::now();
        assert!(run_process(
            python,
            &["-c", "import time; time.sleep(10)"],
            &|| true,
            Duration::from_millis(80)
        )
        .is_err());
        assert!(start.elapsed() < Duration::from_secs(2));
        assert!(run_process(
            python,
            &["-c", "import time; time.sleep(10)"],
            &|| start.elapsed() < Duration::from_millis(180),
            Duration::from_secs(2)
        )
        .is_err());
        assert!(run_process(Path::new("gh.exe"), &[], &|| true, TIMEOUT).is_err());
    }
}
