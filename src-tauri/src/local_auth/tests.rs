use super::gh::gh_accounts;
use super::*;
use std::sync::Mutex;
const FIXTURE: &[u8] = include_bytes!("../../../fixtures/local-auth.json");
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
            bytes: match (args.get(1), args.last()) {
                (Some(&"status"), Some(&"--help")) => b"--json --no-refresh".to_vec(),
                (Some(&"token"), Some(&"--help")) => b"--user --no-refresh".to_vec(),
                (Some(&"status"), _) => FIXTURE.to_vec(),
                (Some(&"token"), _) => b"fixture-value\r\n".to_vec(),
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

struct CompatibleGh {
    json: bool,
    calls: Mutex<Vec<Vec<String>>>,
}
impl Runner for CompatibleGh {
    fn run(&self, _: &Path, args: &[&str], _: &dyn Fn() -> bool) -> Result<Output, String> {
        self.calls
            .lock()
            .unwrap()
            .push(args.iter().map(|arg| (*arg).into()).collect());
        // Model older official gh: unsupported flags are errors, not silently accepted.
        assert!(!args.contains(&"--no-refresh"));
        let bytes = if args == ["auth", "status", "--help"] {
            if self.json {
                b"--hostname --json".to_vec()
            } else {
                b"--hostname --show-token".to_vec()
            }
        } else if args == ["auth", "token", "--help"] {
            b"--hostname --user".to_vec()
        } else if args.first() == Some(&"api") {
            assert_eq!(
                args,
                ["api", "--hostname", "github.com", "user", "--jq", ".login"]
            );
            b"fixture-sam\n".to_vec()
        } else if args.get(1) == Some(&"status") {
            assert!(self.json);
            FIXTURE.to_vec()
        } else {
            assert_eq!(
                args,
                [
                    "auth",
                    "token",
                    "--hostname",
                    "github.com",
                    "--user",
                    "fixture-sam"
                ]
            );
            b"fixture-legacy-token\n".to_vec()
        };
        Ok(Output {
            success: true,
            bytes,
            stderr: Vec::new(),
        })
    }
}

#[test]
fn json_capable_older_gh_does_not_receive_unsupported_refresh_flags() {
    let runner = CompatibleGh {
        json: true,
        calls: Mutex::new(Vec::new()),
    };
    let programs = Programs {
        gh: programs().gh,
        ..Programs::default()
    };
    let result = discover(&programs, &runner, &|| true).unwrap();
    assert_eq!(
        result
            .accounts
            .iter()
            .filter(|account| account.usable)
            .count(),
        3
    );
    assert!(!runner
        .calls
        .lock()
        .unwrap()
        .iter()
        .any(|args| args.get(1).is_some_and(|arg| arg == "token")));
    let token = selected_token(&programs, &runner, "fixture-sam", &|| true).unwrap();
    token.with_secret(|token| assert_eq!(token, "fixture-legacy-token"));
}

#[test]
fn legacy_gh_without_json_exposes_only_its_verified_active_account() {
    let runner = CompatibleGh {
        json: false,
        calls: Mutex::new(Vec::new()),
    };
    let programs = Programs {
        gh: programs().gh,
        ..Programs::default()
    };
    let result = discover(&programs, &runner, &|| true).unwrap();
    assert_eq!(result.accounts.len(), 1);
    assert_eq!(result.accounts[0].login, "fixture-sam");
    assert!(result.accounts[0].usable && result.accounts[0].active);
    assert!(result
        .notices
        .iter()
        .any(|notice| notice.contains("nur das dort aktive Konto")));
    assert!(!runner
        .calls
        .lock()
        .unwrap()
        .iter()
        .any(|args| args.get(1).is_some_and(|arg| arg == "token")));
    selected_token(&programs, &runner, "fixture-sam", &|| true).unwrap();
    assert!(selected_token(&programs, &runner, "fixture-alex", &|| true).is_err());
}

#[test]
fn a_configuration_path_containing_token_is_still_a_stored_credential() {
    let fixture = String::from_utf8(FIXTURE.to_vec()).unwrap().replace(
        "keyring",
        "C:/Users/token-user/AppData/Roaming/GitHub CLI/hosts.yml",
    );
    let accounts = gh_accounts(fixture.as_bytes()).unwrap();
    assert!(
        accounts
            .iter()
            .find(|account| account.login == "fixture-alex")
            .unwrap()
            .usable
    );
    assert!(
        !accounts
            .iter()
            .find(|account| account.login == "fixture-ci")
            .unwrap()
            .usable
    );
}

#[test]
fn windows_discovery_finds_scoop_winget_and_absolute_path_but_rejects_project_binaries() {
    use std::{collections::BTreeMap, ffi::OsString};
    let root = std::env::temp_dir().join(format!("repotray-cli-paths-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    struct Cleanup(PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _cleanup = Cleanup(root.clone());
    let cwd = root.join("cwd");
    std::fs::create_dir_all(&cwd).unwrap();
    let installed = |suffix: &str| {
        let path = root.join(suffix);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"synthetic executable; never run").unwrap();
        path.canonicalize().unwrap()
    };
    let mut env = BTreeMap::<String, OsString>::new();
    env.insert("USERPROFILE".into(), root.join("user").into());
    let scoop = installed("user/scoop/apps/gh/current/bin/gh.exe");
    assert_eq!(
        windows_programs(|name| env.get(name).cloned(), &cwd).gh,
        Some(scoop)
    );
    env.clear();
    env.insert("LOCALAPPDATA".into(), root.join("local").into());
    let winget = installed("local/Microsoft/WinGet/Links/gh.exe");
    assert_eq!(
        windows_programs(|name| env.get(name).cloned(), &cwd).gh,
        Some(winget)
    );
    env.clear();
    let project = installed("project/bin/gh.exe");
    std::fs::create_dir_all(root.join("project/.git")).unwrap();
    std::fs::write(root.join("project/.git/HEAD"), "ref: refs/heads/main").unwrap();
    let custom = installed("custom/bin/gh.exe");
    installed("cwd/gh.exe");
    env.insert(
        "PATH".into(),
        std::env::join_paths([
            PathBuf::from("relative"),
            cwd.clone(),
            project.parent().unwrap().into(),
            custom.parent().unwrap().into(),
        ])
        .unwrap(),
    );
    assert_eq!(
        windows_programs(|name| env.get(name).cloned(), &cwd).gh,
        Some(custom)
    );
    assert!(safe_executable(project, &cwd).is_none());
    assert!(safe_executable(root.join("cwd/gh.exe"), &cwd).is_none());
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
    assert_eq!(calls.len(), 3);
    assert!(calls[1].iter().any(|a| a == "--no-refresh"));
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
    assert!(failed.notices.iter().any(|n| n.contains("gh auth status")));
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
                stderr: b"fixture-gcm-v3\nwarning: private diagnostic\nnot-an-account!\n".to_vec(),
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
