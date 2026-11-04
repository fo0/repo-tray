//! In-app updates independent of GitHub account selection. Standard unsigned builds install
//! the release's NSIS EXE after verifying its published size and SHA-256; builds with a
//! compiled-in updater key install Tauri-signed packages instead. Either way one
//! `install_update` call downloads, verifies and starts the installer, then RepoWatch exits.
use repowatch_core::i18n::tr;
use repowatch_core::updates::{self, check_failed, installer, Installer, UpdateInfo};
use serde::Serialize;
use std::{
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// What the last successful check found; `install_update` installs only this.
#[derive(Clone)]
enum Candidate {
    Signed(Box<Update>),
    Release(Installer),
}

#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Candidate>>,
    busy: AtomicBool,
}

struct Busy<'a>(&'a AtomicBool);
impl UpdateState {
    fn begin(&self) -> Result<Busy<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| {
                tr(
                    "Eine Update-Aufgabe läuft bereits.",
                    "An update task is already running.",
                )
            })?;
        Ok(Busy(&self.busy))
    }
    fn set(&self, candidate: Option<Candidate>) -> Result<(), String> {
        *self.pending.lock().map_err(|_| service_unavailable())? = candidate;
        Ok(())
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
impl DownloadProgress {
    fn stage(stage: &'static str) -> Self {
        Self {
            downloaded: 0,
            total: None,
            stage,
        }
    }
}

fn service_unavailable() -> &'static str {
    tr(
        "Update-Dienst nicht verfügbar.",
        "Update service unavailable.",
    )
}
fn start_failed() -> &'static str {
    tr(
        "Installation konnte nicht gestartet werden.",
        "Installation could not be started.",
    )
}

fn invalid_address() -> &'static str {
    tr("Update-Adresse ungültig.", "Invalid update address.")
}

fn supported() -> Result<(), String> {
    if cfg!(all(windows, target_arch = "x86_64")) {
        Ok(())
    } else {
        Err(tr(
            "App-Updates stehen für die Windows-x64-Version bereit.",
            "App updates are available for the Windows x64 version.",
        )
        .into())
    }
}

#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    supported()?;
    let state = app.state::<UpdateState>();
    let _busy = state.begin()?;
    // A failed check never leaves an older candidate installable.
    state.set(None)?;
    let (info, candidate) = match updater_key() {
        Some(key) => check_signed(&app, key).await?,
        None => {
            let release = tauri::async_runtime::spawn_blocking(|| {
                updates::fetch_latest_release(env!("CARGO_PKG_VERSION"))
            })
            .await
            .map_err(|_| check_failed().to_string())??;
            match release {
                Some(release) => (
                    Some(release.info),
                    Some(Candidate::Release(release.installer)),
                ),
                None => (None, None),
            }
        }
    };
    state.set(candidate)?;
    Ok(info)
}

fn updater_key() -> Option<&'static str> {
    option_env!("REPOWATCH_UPDATER_PUBLIC_KEY").filter(|key| !key.trim().is_empty())
}

/// Signed feed of builds with a compiled-in updater key.
async fn check_signed(
    app: &tauri::AppHandle,
    key: &str,
) -> Result<(Option<UpdateInfo>, Option<Candidate>), String> {
    let updater = app
        .updater_builder()
        .pubkey(key)
        .endpoints(vec![updates::ENDPOINT
            .parse()
            .map_err(|_| invalid_address())?])
        .map_err(|_| invalid_address())?
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|_| service_unavailable())?;
    let update = updater.check().await.map_err(|error| match error {
        // A missing manifest (404) is a publishing gap, not a connection problem.
        tauri_plugin_updater::Error::ReleaseNotFound => updates::no_signed_feed().to_string(),
        _ => check_failed().to_string(),
    })?;
    let Some(mut update) = update else {
        return Ok((None, None));
    };
    updates::validate_update(
        update.download_url.as_str(),
        &update.version,
        env!("CARGO_PKG_VERSION"),
    )?;
    if update.signature.trim().is_empty() {
        return Err(tr(
            "Signatur fehlt – Update wird nicht installiert.",
            "Signature missing – the update is not installed.",
        )
        .into());
    }
    update.timeout = Some(Duration::from_secs(300));
    let info = UpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
        date: update
            .date
            .and_then(|date| updates::format_date(date.unix_timestamp())),
    };
    Ok((Some(info), Some(Candidate::Signed(Box::new(update)))))
}

/// Downloads and verifies the checked update, starts its installer and exits RepoWatch so
/// the installer can replace the EXE; the installer relaunches the app.
#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    supported()?;
    let state = app.state::<UpdateState>();
    let _busy = state.begin()?;
    let candidate = state
        .pending
        .lock()
        .map_err(|_| service_unavailable())?
        .clone()
        .ok_or(tr("Prüfe zuerst auf Updates.", "Check for updates first."))?;
    match candidate {
        Candidate::Release(asset) => install_release(&app, asset, on_progress).await,
        Candidate::Signed(update) => install_signed(*update, on_progress).await,
    }
}

async fn install_release(
    app: &tauri::AppHandle,
    asset: Installer,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    let total = asset.size;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = installer::download(&asset, |downloaded| {
            let _ = on_progress.send(DownloadProgress {
                downloaded,
                total: Some(total),
                stage: "downloading",
            });
            // The last chunk is in; size and SHA-256 are compared next.
            if downloaded == total {
                let _ = on_progress.send(DownloadProgress::stage("verifying"));
            }
        })?;
        // Only verified bytes reach the disk.
        let _ = on_progress.send(DownloadProgress::stage("installing"));
        let path = installer::stage(&std::env::temp_dir(), &asset, &bytes)?;
        // Per-user NSIS install (`installMode: currentUser`): no elevation needed.
        Command::new(path)
            .args(installer::NSIS_UPDATE_ARGS)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(drop)
            .map_err(|_| start_failed().to_string())
    })
    .await
    .map_err(|_| start_failed().to_string())??;
    // Nothing prevents `ExitRequested`, so this ends the process and frees the EXE; the
    // passive installer would otherwise close the running app itself.
    app.exit(0);
    Ok(())
}

async fn install_signed(
    update: Update,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    let mut downloaded = 0;
    let mut last_event = Instant::now();
    let verify_channel = on_progress.clone();
    let bytes = update
        .download(
            |length, total| {
                downloaded += length as u64;
                if last_event.elapsed() >= Duration::from_millis(100) || total == Some(downloaded) {
                    let _ = on_progress.send(DownloadProgress {
                        downloaded,
                        total,
                        stage: "downloading",
                    });
                    last_event = Instant::now();
                }
            },
            || {
                let _ = verify_channel.send(DownloadProgress::stage("verifying"));
            },
        )
        .await
        .map_err(|_| {
            tr(
                "Download oder Signaturprüfung fehlgeschlagen – nichts installiert.",
                "Download or signature check failed – nothing installed.",
            )
            .to_string()
        })?;
    // download() verifies the complete package before returning installable bytes.
    let _ = on_progress.send(DownloadProgress::stage("installing"));
    // On Windows the plugin starts the installer and exits the process itself.
    tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|_| start_failed())?
        .map_err(|_| start_failed().to_string())
}
