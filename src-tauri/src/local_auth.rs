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
const FAILED: &str = "gh CLI konnte nicht geprüft werden. Prüfe im Terminal mit gh auth status, ob du bei github.com angemeldet bist; prüfe auch Verbindung und gh-Version.";
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
    // No inherited GH_TOKEN/GITHUB_TOKEN, GH_HOST, GH_DEBUG, GIT_CONFIG_*,
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
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
    ] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    // Honor the user's explicitly configured gh store; never substitute a different account store.
    if let Some(directory) = std::env::var_os("GH_CONFIG_DIR") {
        if !Path::new(&directory).is_absolute() {
            return Err(
                "GH_CONFIG_DIR muss ein absoluter Pfad sein. Prüfe die gh-Konfiguration.".into(),
            );
        }
        command.env("GH_CONFIG_DIR", directory);
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
    pub fn installed() -> Self {
        #[cfg(windows)]
        {
            windows_programs(
                |name| std::env::var_os(name),
                &std::env::current_dir().unwrap_or_default(),
            )
        }
        #[cfg(not(windows))]
        Self::default()
    }
}

#[cfg(any(windows, test))]
fn windows_programs(get: impl Fn(&str) -> Option<std::ffi::OsString>, cwd: &Path) -> Programs {
    let roots: Vec<_> = ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|name| get(name))
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .collect();
    let mut gh: Vec<_> = roots
        .iter()
        .map(|root| root.join("GitHub CLI/gh.exe"))
        .collect();
    let mut git: Vec<_> = roots
        .iter()
        .map(|root| root.join("Git/cmd/git.exe"))
        .collect();
    let mut gcm: Vec<_> = roots
        .iter()
        .flat_map(|root| {
            [
                root.join("Git Credential Manager/git-credential-manager.exe"),
                root.join("Git/mingw64/bin/git-credential-manager.exe"),
            ]
        })
        .collect();
    if let Some(local) = get("LOCALAPPDATA")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
    {
        gh.extend([
            local.join("Programs/GitHub CLI/gh.exe"),
            local.join("Microsoft/WinGet/Links/gh.exe"),
        ]);
        git.push(local.join("Programs/Git/cmd/git.exe"));
        gcm.push(local.join("Programs/Git/mingw64/bin/git-credential-manager.exe"));
    }
    let mut scoop_roots = Vec::new();
    if let Some(home) = get("USERPROFILE")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
    {
        scoop_roots.push(home.join("scoop"));
    }
    if let Some(data) = get("ProgramData")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
    {
        scoop_roots.push(data.join("scoop"));
    }
    for name in ["SCOOP", "SCOOP_GLOBAL"] {
        if let Some(root) = get(name).map(PathBuf::from).filter(|p| p.is_absolute()) {
            scoop_roots.push(root);
        }
    }
    gh.extend(
        scoop_roots
            .iter()
            .map(|root| root.join("apps/gh/current/bin/gh.exe")),
    );
    if let Some(root) = get("ChocolateyInstall")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
    {
        gh.extend([
            root.join("bin/gh.exe"),
            root.join("lib/gh/tools/bin/gh.exe"),
        ]);
    }
    // Resolve only absolute PATH entries to real .exe files. Never execute a project-local
    // binary, the working directory's gh.exe, a shell alias, or a .cmd wrapper.
    if let Some(path) = get("PATH") {
        for directory in std::env::split_paths(&path).filter(|p| p.is_absolute()) {
            gh.push(directory.join("gh.exe"));
            git.push(directory.join("git.exe"));
            gcm.push(directory.join("git-credential-manager.exe"));
        }
    }
    let first = |paths: Vec<PathBuf>| {
        paths
            .into_iter()
            .find_map(|path| safe_executable(path, cwd))
    };
    Programs {
        gh: first(gh),
        git: first(git),
        gcm: first(gcm),
    }
}

#[cfg(any(windows, test))]
fn safe_executable(path: PathBuf, cwd: &Path) -> Option<PathBuf> {
    if !path.is_absolute()
        || !path.is_file()
        || !path.extension()?.to_str()?.eq_ignore_ascii_case("exe")
    {
        return None;
    }
    let real = path.canonicalize().ok()?;
    let working = cwd.canonicalize().ok();
    if path
        .parent()
        .and_then(|parent| parent.canonicalize().ok())
        .as_ref()
        == working.as_ref()
        || real.parent() == working.as_deref()
        || real.ancestors().any(|parent| {
            let git = parent.join(".git");
            git.is_file() || git.join("HEAD").is_file()
        })
    {
        return None;
    }
    Some(real)
}

// New gh versions can rotate expiring credentials; suppress that whenever supported.
// Older versions lack the flag and read stored tokens without automatic refresh.
fn gh_help(
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

fn gh_status(
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
        result
            .notices
            .push("gh CLI gefunden. Erkennung verbindet noch kein Konto mit RepoTray.".into());
        match gh_status(gh, runner, current) {
            Ok((accounts, legacy)) => {
                if legacy {
                    result.notices.push("Diese gh-Version zeigt nur das dort aktive Konto. Für die Auswahl aller gespeicherten gh-Konten aktualisiere die GitHub CLI.".into());
                }
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
            .push("gh CLI nicht gefunden. Installiere GitHub CLI (gh), starte RepoTray danach neu und prüfe im Terminal gh auth status. Git allein reicht nicht.".into());
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
    if !gh_status(gh, runner, current)?
        .0
        .iter()
        .any(|a| a.login == login && a.usable)
    {
        return Err("Gewählte lokale Anmeldung ist nicht mehr verfügbar. Erneut prüfen.".into());
    }
    if !current() {
        return Err(CANCELLED.into());
    }
    let help = gh_help(gh, "token", runner, current)?;
    if !help.contains("--user") {
        return Err(
            "Diese gh-Version unterstützt keine sichere Kontoauswahl. Aktualisiere die GitHub CLI."
                .into(),
        );
    }
    let mut args = vec!["auth", "token", "--hostname", "github.com", "--user", login];
    if help.contains("--no-refresh") {
        args.push("--no-refresh");
    }
    let out = runner.run(gh, &args, current)?;
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
mod tests;
