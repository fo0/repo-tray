//! Public updates independent of GitHub account selection: signed in-app installation when an
//! updater key is compiled in, otherwise notify-only via the public release page.
use repotray_core::updates::{self, UpdateInfo, UpdateMode};
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
    let Some(key) = updater_key() else {
        return check_release(&app).await;
    };
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
    let mut update = updater.check().await.map_err(|error| match error {
        // A missing manifest (404) is a publishing gap, not a connection problem.
        tauri_plugin_updater::Error::ReleaseNotFound => updates::NO_SIGNED_FEED.to_string(),
        _ => "Updates konnten nicht geprüft werden. Prüfe deine Verbindung und versuche es erneut."
            .to_string(),
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
            mode: UpdateMode::Install,
            version: update.version.clone(),
            notes: update.body.clone().unwrap_or_default(),
            date: update
                .date
                .and_then(|date| updates::format_date(date.unix_timestamp())),
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

fn updater_key() -> Option<&'static str> {
    option_env!("REPOTRAY_UPDATER_PUBLIC_KEY").filter(|key| !key.trim().is_empty())
}

/// Notify-only check for unsigned builds: public release metadata, never a download.
async fn check_release(app: &tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let state = app.state::<UpdateState>();
    let _busy = state.begin()?;
    let info = tauri::async_runtime::spawn_blocking(|| {
        updates::fetch_latest_release(env!("CARGO_PKG_VERSION"))
    })
    .await
    .map_err(|_| "Updates konnten nicht geprüft werden.".to_string())??;
    Ok(info)
}

/// Opens only the tag page of a validated, newer stable release; nothing is downloaded.
#[tauri::command]
pub fn open_release_page(app: tauri::AppHandle, version: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let url = updates::release_page_url(&version, env!("CARGO_PKG_VERSION"))?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "Browser konnte nicht geöffnet werden.".into())
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
