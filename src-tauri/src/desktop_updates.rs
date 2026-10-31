//! Public, signed updates independent of GitHub account selection.
use repotray_core::updates::{self, UpdateInfo};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
struct Pending {
    update: Option<Update>,
    bytes: Option<Arc<Vec<u8>>>,
}

#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Pending>,
    busy: AtomicBool,
}

struct Busy<'a>(&'a AtomicBool);
impl UpdateState {
    fn begin(&self) -> Result<Busy<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "Eine Update-Aufgabe läuft bereits.")?;
        Ok(Busy(&self.busy))
    }
}
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
    stage: &'static str,
}

#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    if !cfg!(all(windows, target_arch = "x86_64")) {
        return Err("App-Updates stehen für die Windows-x64-Version bereit.".into());
    }
    let key = option_env!("REPOTRAY_UPDATER_PUBLIC_KEY")
        .filter(|key| !key.trim().is_empty())
        .ok_or("Automatische Updates sind für diesen Build noch nicht eingerichtet.")?;
    let state = app.state::<UpdateState>();
    let _busy = state.begin()?;
    {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "Update-Dienst nicht verfügbar.")?;
        if pending.bytes.is_some() {
            return Err("Ein geprüftes Update wartet bereits auf die Installation.".into());
        }
        *pending = Pending::default();
    }
    let updater = app
        .updater_builder()
        .pubkey(key)
        .endpoints(vec![updates::ENDPOINT
            .parse()
            .map_err(|_| "Update-Adresse ungültig.")?])
        .map_err(|_| "Update-Adresse ungültig.")?
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|_| "Update-Dienst nicht verfügbar.")?;
    let mut update = updater.check().await.map_err(|_| {
        "Updates konnten nicht geprüft werden. Prüfe deine Verbindung und versuche es erneut."
            .to_string()
    })?;
    let info = if let Some(update) = &mut update {
        updates::validate_update(
            update.download_url.as_str(),
            &update.version,
            env!("CARGO_PKG_VERSION"),
        )?;
        if update.signature.trim().is_empty() {
            return Err("Für dieses Update fehlt die Signatur. Es wird nicht installiert.".into());
        }
        update.timeout = Some(Duration::from_secs(300));
        Some(UpdateInfo {
            version: update.version.clone(),
            notes: update.body.clone().unwrap_or_default(),
        })
    } else {
        None
    };
    state
        .pending
        .lock()
        .map_err(|_| "Update-Dienst nicht verfügbar.")?
        .update = update;
    Ok(info)
}

#[tauri::command]
pub async fn download_update(
    app: tauri::AppHandle,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    let state = app.state::<UpdateState>();
    let _busy = state.begin()?;
    let update = {
        let pending = state
            .pending
            .lock()
            .map_err(|_| "Update-Dienst nicht verfügbar.")?;
        if pending.bytes.is_some() {
            return Ok(());
        }
        pending.update.clone().ok_or("Prüfe zuerst auf Updates.")?
    };
    let mut downloaded = 0;
    let mut last_event = Instant::now();
    let verify_channel = on_progress.clone();
    let bytes = update.download(
        |length, total| {
            downloaded += length as u64;
            if last_event.elapsed() >= Duration::from_millis(100) || total == Some(downloaded) {
                let _ = on_progress.send(DownloadProgress { downloaded, total, stage: "downloading" });
                last_event = Instant::now();
            }
        },
        || { let _ = verify_channel.send(DownloadProgress { downloaded: 0, total: None, stage: "verifying" }); },
    ).await.map_err(|_| "Download oder Signaturprüfung fehlgeschlagen. Es wurde nichts installiert. Versuche den Download erneut.".to_string())?;
    // download() verifies the complete package before returning installable bytes.
    state
        .pending
        .lock()
        .map_err(|_| "Update-Dienst nicht verfügbar.")?
        .bytes = Some(Arc::new(bytes));
    Ok(())
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<UpdateState>();
    let _busy = state.begin()?;
    let (update, bytes) = {
        let pending = state
            .pending
            .lock()
            .map_err(|_| "Update-Dienst nicht verfügbar.")?;
        (
            pending.update.clone().ok_or("Prüfe zuerst auf Updates.")?,
            pending
                .bytes
                .clone()
                .ok_or("Lade das Update zuerst vollständig herunter.")?,
        )
    };
    tauri::async_runtime::spawn_blocking(move || update.install(bytes.as_ref()))
        .await
        .map_err(|_| "Installation konnte nicht gestartet werden.")?
        .map_err(|_| "Installation konnte nicht gestartet werden. Versuche es erneut.".to_string())
}
