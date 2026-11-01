//! Account commands: connect by token, gh CLI import or browser sign-in, cancel a pending
//! connect, and disconnect. Each connect takes a generation ticket; `cancel_connect` or a
//! newer connect invalidates it.
use crate::desktop::{work, NativeState};
use repotray_core::{
    auth::{DeviceFlowStatus, DevicePollResult, SecretToken},
    browser_auth::{self, NativeOAuthTransport, PollOutcome},
    local_auth::{self, LocalDiscovery, ProcessRunner, Programs},
    Snapshot,
};
use std::sync::atomic::Ordering;
use tauri::Manager;

#[tauri::command]
pub(crate) async fn connect_token(
    app: tauri::AppHandle,
    token: String,
) -> Result<Snapshot, String> {
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
pub(crate) async fn discover_local_auth(app: tauri::AppHandle) -> Result<LocalDiscovery, String> {
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
pub(crate) async fn connect_local_auth(
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
pub(crate) fn cancel_connect(app: tauri::AppHandle) {
    let state = app.state::<NativeState>();
    state.auth_generation.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut flow) = state.browser_flow.lock() {
        flow.1.cancel();
    };
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserReply {
    flow_id: u64,
    status: DeviceFlowStatus,
    message: Option<String>,
    snapshot: Option<Snapshot>,
}
#[tauri::command]
pub(crate) fn browser_auth_config() -> browser_auth::BrowserConfig {
    browser_auth::config()
}
#[tauri::command]
pub(crate) async fn start_browser_auth(app: tauri::AppHandle) -> Result<BrowserReply, String> {
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
pub(crate) fn open_browser_auth(app: tauri::AppHandle, flow_id: u64) -> Result<(), String> {
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
pub(crate) fn open_browser_installation(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(browser_auth::installation_url()?, None::<&str>)
        .map_err(|_| "Browser konnte nicht geöffnet werden.".into())
}
#[tauri::command]
pub(crate) async fn poll_browser_auth(
    app: tauri::AppHandle,
    flow_id: u64,
) -> Result<BrowserReply, String> {
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
pub(crate) async fn disconnect_account(
    app: tauri::AppHandle,
    account_id: String,
) -> Result<Snapshot, String> {
    work(app, move |engine| engine.disconnect(&account_id)).await
}
