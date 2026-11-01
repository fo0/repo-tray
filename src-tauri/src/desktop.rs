use repotray_core::{
    auth::{DeviceFlow, DeviceFlowStatus, DevicePollResult, OsKeyring, SecretToken},
    browser_auth::{self, NativeOAuthTransport, PollOutcome},
    cache::Cache,
    live::LiveStore,
    local_auth::{self, LocalDiscovery, ProcessRunner, Programs},
    DispatchOutcome, DispatchRequest, Pin, RunStatus, Snapshot, UncertainStart,
};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_notification::NotificationExt;
struct NativeState {
    engine: Mutex<LiveStore>,
    notifications: AtomicBool,
    auth_generation: AtomicU64,
    browser_flow: Mutex<(u64, DeviceFlow)>,
}
async fn work<T: Send + 'static>(
    app: tauri::AppHandle,
    operation: impl FnOnce(&mut LiveStore) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<NativeState>();
        let mut engine = state.engine.lock().map_err(|_| "Dienst nicht verfügbar.")?;
        operation(&mut engine)
    })
    .await
    .map_err(|_| "Aufgabe konnte nicht abgeschlossen werden.".to_string())?
}
#[tauri::command]
async fn snapshot(app: tauri::AppHandle) -> Result<Snapshot, String> {
    work(app, |engine| Ok(engine.snapshot())).await
}
#[tauri::command]
async fn refresh_snapshot(app: tauri::AppHandle) -> Result<Snapshot, String> {
    work(app, |engine| Ok(engine.refresh())).await
}
#[tauri::command]
async fn refresh_repositories(app: tauri::AppHandle) -> Result<Snapshot, String> {
    work(app, |engine| Ok(engine.refresh_repositories())).await
}
#[tauri::command]
async fn select_repos(app: tauri::AppHandle, repo_ids: Vec<String>) -> Result<Snapshot, String> {
    work(app, |engine| engine.select_repos(repo_ids)).await
}
#[tauri::command]
async fn save_pin(app: tauri::AppHandle, pin: Pin) -> Result<Snapshot, String> {
    work(app, |engine| engine.save_pin(pin)).await
}
#[tauri::command]
async fn delete_pin(app: tauri::AppHandle, pin_id: String) -> Result<Snapshot, String> {
    work(app, |engine| engine.delete_pin(pin_id)).await
}
#[tauri::command]
async fn dispatch_workflow(
    app: tauri::AppHandle,
    request: DispatchRequest,
) -> Result<DispatchOutcome, String> {
    work(app, |engine| Ok(engine.dispatch(request))).await
}
/// Called only after the user confirmed they checked the runs on GitHub; it never dispatches.
#[tauri::command]
async fn release_uncertain_start(
    app: tauri::AppHandle,
    start: UncertainStart,
) -> Result<Snapshot, String> {
    work(app, |engine| engine.release_uncertain_start(start)).await
}
#[tauri::command]
async fn connect_token(app: tauri::AppHandle, token: String) -> Result<Snapshot, String> {
    let state = app.state::<NativeState>();
    let ticket = state.auth_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();
    work(app, move |engine| {
        engine.connect_token(SecretToken::new(token), || {
            handle
                .state::<NativeState>()
                .auth_generation
                .load(Ordering::SeqCst)
                == ticket
        })
    })
    .await
}
#[tauri::command]
async fn discover_local_auth(app: tauri::AppHandle) -> Result<LocalDiscovery, String> {
    let ticket = app
        .state::<NativeState>()
        .auth_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    tauri::async_runtime::spawn_blocking(move || {
        local_auth::discover(&Programs::installed(), &ProcessRunner, &|| {
            app.state::<NativeState>()
                .auth_generation
                .load(Ordering::SeqCst)
                == ticket
        })
    })
    .await
    .map_err(|_| "Lokale Prüfung konnte nicht abgeschlossen werden.".to_string())?
}
#[tauri::command]
async fn connect_local_auth(
    app: tauri::AppHandle,
    login: String,
    confirm_import: bool,
) -> Result<Snapshot, String> {
    if !confirm_import {
        return Err("Bestätige zuerst die Übernahme in den RepoTray-Tresor.".into());
    }
    let ticket = app
        .state::<NativeState>()
        .auth_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let handle = app.clone();
    work(app, move |engine| {
        let current = || {
            handle
                .state::<NativeState>()
                .auth_generation
                .load(Ordering::SeqCst)
                == ticket
        };
        let token =
            local_auth::selected_token(&Programs::installed(), &ProcessRunner, &login, &current)?;
        engine.connect_local_token(token, &login, current)
    })
    .await
}
#[tauri::command]
fn cancel_connect(app: tauri::AppHandle) {
    let state = app.state::<NativeState>();
    state.auth_generation.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut flow) = state.browser_flow.lock() {
        flow.1.cancel();
    };
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserReply {
    flow_id: u64,
    status: DeviceFlowStatus,
    message: Option<String>,
    snapshot: Option<Snapshot>,
}
#[tauri::command]
fn browser_auth_config() -> browser_auth::BrowserConfig {
    browser_auth::config()
}
#[tauri::command]
async fn start_browser_auth(app: tauri::AppHandle) -> Result<BrowserReply, String> {
    browser_auth::ensure_sign_in_enabled()?;
    let (client_id, _) = browser_auth::publisher()?;
    let ticket = app
        .state::<NativeState>()
        .auth_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    tauri::async_runtime::spawn_blocking(move || {
        let authorization = browser_auth::begin(&mut NativeOAuthTransport::new()?, client_id)?;
        let state = app.state::<NativeState>();
        let mut flow = state
            .browser_flow
            .lock()
            .map_err(|_| "Anmeldedienst nicht verfügbar.")?;
        if state.auth_generation.load(Ordering::SeqCst) != ticket {
            return Err("Anmeldung wurde abgebrochen.".into());
        }
        flow.0 = ticket;
        let status = flow
            .1
            .start_local(authorization, repotray_core::live::now())
            .map_err(|e| e.to_string())?;
        Ok(BrowserReply {
            flow_id: ticket,
            status,
            message: None,
            snapshot: None,
        })
    })
    .await
    .map_err(|_| "Anmeldedienst nicht verfügbar.".to_string())?
}
#[tauri::command]
fn open_browser_auth(app: tauri::AppHandle, flow_id: u64) -> Result<(), String> {
    browser_auth::ensure_sign_in_enabled()?;
    use tauri_plugin_opener::OpenerExt;
    let state = app.state::<NativeState>();
    let mut flow = state
        .browser_flow
        .lock()
        .map_err(|_| "Anmeldedienst nicht verfügbar.")?;
    if state.auth_generation.load(Ordering::SeqCst) != flow_id
        || flow.0 != flow_id
        || !matches!(
            flow.1.status(repotray_core::live::now()),
            DeviceFlowStatus::AwaitingAuthorization { .. }
        )
    {
        return Err("Dieser Code ist nicht mehr aktiv.".into());
    }
    app.opener().open_url(browser_auth::VERIFY_URL, None::<&str>).map_err(|_| "Browser konnte nicht geöffnet werden. Öffne github.com/login/device und gib den angezeigten Code ein.".into())
}
#[tauri::command]
fn open_browser_installation(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(browser_auth::installation_url()?, None::<&str>)
        .map_err(|_| "Browser konnte nicht geöffnet werden.".into())
}
#[tauri::command]
async fn poll_browser_auth(app: tauri::AppHandle, flow_id: u64) -> Result<BrowserReply, String> {
    browser_auth::ensure_sign_in_enabled()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<NativeState>();
        let current = || state.auth_generation.load(Ordering::SeqCst) == flow_id;
        let (ticket, code) = {
            let mut flow = state
                .browser_flow
                .lock()
                .map_err(|_| "Anmeldedienst nicht verfügbar.")?;
            if !current() || flow.0 != flow_id {
                return Err("Anmeldung wurde abgebrochen.".into());
            }
            let status = flow.1.status(repotray_core::live::now());
            if !matches!(status, DeviceFlowStatus::AwaitingAuthorization { .. }) {
                return Ok(BrowserReply {
                    flow_id,
                    status,
                    message: None,
                    snapshot: None,
                });
            }
            let Some(ticket) = flow
                .1
                .next_poll(repotray_core::live::now())
                .map_err(|e| e.to_string())?
            else {
                return Ok(BrowserReply {
                    flow_id,
                    status,
                    message: None,
                    snapshot: None,
                });
            };
            let code = flow
                .1
                .with_device_code(ticket, repotray_core::live::now(), |s| {
                    SecretToken::new(s.to_owned())
                })
                .map_err(|e| e.to_string())?;
            (ticket, code)
        };
        let result = browser_auth::poll(
            &mut NativeOAuthTransport::new()?,
            browser_auth::publisher()?.0,
            &code,
            repotray_core::live::now(),
        );
        let (poll_status, tokens, message) = match result {
            Ok(PollOutcome::Status(status)) => (status, None, None),
            Ok(PollOutcome::Tokens(tokens)) => (DevicePollResult::Authorized, Some(tokens), None),
            Err(message) if browser_auth::is_network_error(&message) => {
                (DevicePollResult::TransportFailure, None, Some(message))
            }
            Err(message) => {
                if let Ok(mut flow) = state.browser_flow.lock() {
                    if flow.0 == flow_id {
                        flow.1.cancel();
                    }
                }
                return Err(message);
            }
        };
        let status = {
            let mut flow = state
                .browser_flow
                .lock()
                .map_err(|_| "Anmeldedienst nicht verfügbar.")?;
            if !current() || flow.0 != flow_id {
                return Err("Anmeldung wurde abgebrochen.".into());
            }
            let now = repotray_core::live::now();
            if flow.1.status(now) == DeviceFlowStatus::Expired {
                return Ok(BrowserReply {
                    flow_id,
                    status: DeviceFlowStatus::Expired,
                    message: None,
                    snapshot: None,
                });
            }
            flow.1
                .apply_poll(ticket, poll_status, now)
                .map_err(|e| e.to_string())?
        };
        let snapshot = if let Some(tokens) = tokens {
            let mut engine = state.engine.lock().map_err(|_| "Dienst nicht verfügbar.")?;
            Some(engine.connect_browser(tokens, current)?)
        } else {
            None
        };
        Ok(BrowserReply {
            flow_id,
            status,
            message,
            snapshot,
        })
    })
    .await
    .map_err(|_| "Anmeldedienst nicht verfügbar.".to_string())?
}
#[tauri::command]
async fn disconnect_account(app: tauri::AppHandle, account_id: String) -> Result<Snapshot, String> {
    work(app, move |engine| engine.disconnect(&account_id)).await
}
#[tauri::command]
fn hide_panel(app: tauri::AppHandle) -> Result<(), String> {
    crate::tray_popup::hide(&app)
}
#[tauri::command]
fn open_run(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let parsed = reqwest::Url::parse(&url).map_err(|_| "GitHub-Link ungültig.")?;
    let segments: Vec<_> = parsed
        .path_segments()
        .ok_or("GitHub-Link ungültig.")?
        .collect();
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
        || parsed.port().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || segments.len() != 5
        || segments[2] != "actions"
        || segments[3] != "runs"
        || segments[4].parse::<u64>().is_err()
    {
        return Err("Nur GitHub-Run-Links sind erlaubt.".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "Browser konnte nicht geöffnet werden.".into())
}
fn tray_image(active: bool, failed: bool) -> tauri::image::Image<'static> {
    let color = if active {
        [197, 237, 139, 255]
    } else if failed {
        [242, 150, 124, 255]
    } else {
        [143, 165, 148, 255]
    };
    let mut pixels = vec![0; 32 * 32 * 4];
    for y in 3..29 {
        for x in 3..29 {
            let offset = (y * 32 + x) * 4;
            let glyph = ((8..12).contains(&x) && (8..25).contains(&y))
                || ((9..24).contains(&x) && (15..19).contains(&y))
                || ((20..24).contains(&x) && (8..18).contains(&y));
            pixels[offset..offset + 4].copy_from_slice(if glyph {
                &[20, 24, 22, 255]
            } else {
                &color
            });
        }
    }
    tauri::image::Image::new_owned(pixels, 32, 32)
}

pub fn run() {
    let show_panel = repotray_core::startup::show_on_launch(std::env::args_os());
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            // A duplicate login launch must neither show nor hide the existing panel.
            if repotray_core::startup::show_on_launch(args) {
                if let Err(error) = crate::tray_popup::show(app) {
                    eprintln!("RepoTray popup: {error}");
                }
            }
        }))
        .manage(crate::desktop_startup::StartupState::default())
        .manage(crate::tray_popup::Popup::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(crate::desktop_updates::UpdateState::default())
        .setup(move |app| {
            let cache_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&cache_dir)?;
            let cache = Cache::open(cache_dir.join("repotray-live.db"))?;
            let store =
                LiveStore::new(cache, Arc::new(OsKeyring::new())).map_err(std::io::Error::other)?;
            let baseline = store.snapshot();
            let notify = store.notifications_enabled();
            app.manage(NativeState {
                engine: Mutex::new(store),
                notifications: AtomicBool::new(notify),
                auth_generation: AtomicU64::new(0),
                browser_flow: Mutex::new((0, DeviceFlow::new())),
            });
            let show = MenuItem::with_id(
                app,
                "toggle",
                "RepoTray öffnen / ausblenden",
                true,
                None::<&str>,
            )?;
            let notifications = CheckMenuItem::with_id(
                app,
                "notifications",
                "Run-Benachrichtigungen",
                true,
                notify,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "RepoTray beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &notifications, &quit])?;
            TrayIconBuilder::with_id("repotray")
                .icon(tray_image(false, false))
                .tooltip("RepoTray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "toggle" => crate::tray_popup::toggle(app),
                    "quit" => app.exit(0),
                    "notifications" => {
                        if let Some(state) = app.try_state::<NativeState>() {
                            let enabled = !state.notifications.load(Ordering::Relaxed);
                            state.notifications.store(enabled, Ordering::Relaxed);
                            let _ = notifications.set_checked(enabled);
                            // Persist off the UI thread; the engine lock may be held by a refresh.
                            // The value is read under the lock, so the last write wins.
                            let handle = app.clone();
                            tauri::async_runtime::spawn_blocking(move || {
                                let Some(state) = handle.try_state::<NativeState>() else {
                                    return;
                                };
                                if let Ok(mut engine) = state.engine.lock() {
                                    // Best effort: the toggle still applies to this session.
                                    let _ = engine.set_notifications_enabled(
                                        state.notifications.load(Ordering::Relaxed),
                                    );
                                }
                            });
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    crate::tray_popup::tray_event(tray.app_handle(), event);
                })
                .build(app)?;
            // Keep visible:false throughout a login launch; there is no show/hide flash.
            if show_panel {
                crate::tray_popup::show(app.handle()).map_err(std::io::Error::other)?;
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut previous: HashMap<_, _> = baseline
                    .runs
                    .iter()
                    .map(|run| (run.id, run.status))
                    .collect();
                loop {
                    // One serialized worker; active repositories poll faster than idle ones.
                    std::thread::sleep(Duration::from_secs(
                        if previous
                            .values()
                            .any(|status| *status != RunStatus::Completed)
                        {
                            15
                        } else {
                            60
                        },
                    ));
                    let Some(state) = handle.try_state::<NativeState>() else {
                        break;
                    };
                    let value = {
                        let Ok(mut engine) = state.engine.lock() else {
                            break;
                        };
                        engine.refresh()
                    };
                    let selected = |repo_id: &str| {
                        value
                            .repos
                            .iter()
                            .any(|repo| repo.id == repo_id && repo.selected)
                    };
                    let active = value
                        .runs
                        .iter()
                        .any(|run| selected(&run.repo_id) && run.status != RunStatus::Completed);
                    let failed = value.runs.iter().any(|run| {
                        selected(&run.repo_id)
                            && run.conclusion == Some(repotray_core::Conclusion::Failure)
                    });
                    if let Some(tray) = handle.tray_by_id("repotray") {
                        let _ = tray.set_icon(Some(tray_image(active, failed)));
                        let _ = tray.set_tooltip(Some(if active {
                            "RepoTray · Actions laufen"
                        } else if failed {
                            "RepoTray · Fehler"
                        } else {
                            "RepoTray · bereit"
                        }));
                    }
                    for run in &value.runs {
                        if selected(&run.repo_id)
                            && run.status == RunStatus::Completed
                            && previous
                                .get(&run.id)
                                .is_some_and(|status| *status != RunStatus::Completed)
                            && state.notifications.load(Ordering::Relaxed)
                        {
                            let _ = handle
                                .notification()
                                .builder()
                                .title("RepoTray")
                                .body(format!("{}: Lauf beendet.", run.name))
                                .show();
                        }
                    }
                    previous = value.runs.iter().map(|run| (run.id, run.status)).collect();
                    let _ = handle.emit("repotray:snapshot", value);
                }
            });
            Ok(())
        })
        .on_window_event(crate::tray_popup::window_event)
        .invoke_handler(tauri::generate_handler![
            snapshot,
            refresh_snapshot,
            refresh_repositories,
            select_repos,
            save_pin,
            delete_pin,
            dispatch_workflow,
            release_uncertain_start,
            connect_token,
            browser_auth_config,
            start_browser_auth,
            poll_browser_auth,
            open_browser_auth,
            open_browser_installation,
            discover_local_auth,
            connect_local_auth,
            cancel_connect,
            disconnect_account,
            crate::desktop_startup::autostart_status,
            crate::desktop_startup::set_autostart,
            crate::desktop_startup::open_startup_settings,
            crate::desktop_updates::check_update,
            crate::desktop_updates::download_update,
            crate::desktop_updates::install_update,
            open_run,
            hide_panel
        ])
        .run(tauri::generate_context!())
        .expect("RepoTray konnte nicht gestartet werden");
}
