use repotray_core::{
    auth::{DeviceFlow, OsKeyring},
    cache::Cache,
    live::LiveStore,
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
pub(crate) struct NativeState {
    pub(crate) engine: Mutex<LiveStore>,
    notifications: AtomicBool,
    pub(crate) auth_generation: AtomicU64,
    pub(crate) browser_flow: Mutex<(u64, DeviceFlow)>,
}
pub(crate) async fn work<T: Send + 'static>(
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
fn hide_panel(app: tauri::AppHandle) -> Result<(), String> {
    crate::tray_popup::hide(&app)
}
#[tauri::command]
fn open_run(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    // Open only the parser's canonical form, never the raw IPC string.
    let url = repotray_core::run_link::canonical_run_url(&url)
        .ok_or("Nur GitHub-Run-Links sind erlaubt.")?;
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
                                // A `let` binding drops the guard before `state`; a trailing
                                // `if let` expression would outlive it (E0597).
                                let Ok(mut engine) = state.engine.lock() else {
                                    return;
                                };
                                // Best effort: the toggle still applies to this session.
                                let _ = engine.set_notifications_enabled(
                                    state.notifications.load(Ordering::Relaxed),
                                );
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
                            "RepoTray · Workflows laufen"
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
                                .body(format!("{}: Run beendet.", run.name))
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
            save_pin,
            delete_pin,
            dispatch_workflow,
            release_uncertain_start,
            crate::desktop_auth::connect_token,
            crate::desktop_auth::browser_auth_config,
            crate::desktop_auth::start_browser_auth,
            crate::desktop_auth::poll_browser_auth,
            crate::desktop_auth::open_browser_auth,
            crate::desktop_auth::open_browser_installation,
            crate::desktop_auth::discover_local_auth,
            crate::desktop_auth::connect_local_auth,
            crate::desktop_auth::cancel_connect,
            crate::desktop_auth::disconnect_account,
            crate::desktop_startup::autostart_status,
            crate::desktop_startup::set_autostart,
            crate::desktop_startup::open_startup_settings,
            crate::desktop_updates::check_update,
            crate::desktop_updates::install_update,
            open_run,
            hide_panel
        ])
        .run(tauri::generate_context!())
        .expect("RepoTray konnte nicht gestartet werden");
}
