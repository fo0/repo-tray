//! Run cancellation: one POST per user action, never retried. GitHub cancels asynchronously,
//! so the run keeps its last known status until the next poll reports the real outcome.
use super::LiveStore;
use crate::{
    github::{ApiError, ApiRequest, Transport, TransportError},
    i18n::tr,
    models::*,
    trf,
};

fn cancel_unconfirmed() -> &'static str {
    tr(
        "Abbruch nicht bestätigt – prüfe den Run auf GitHub.",
        "Cancellation not confirmed – check the run on GitHub.",
    )
}
fn cancel_finished() -> &'static str {
    tr(
        "Run lässt sich nicht mehr abbrechen – er ist bereits beendet.",
        "The run can no longer be cancelled – it has already finished.",
    )
}
/// GitHub's 409 for an orphan it never queued: „Cannot cancel a workflow run that has not
/// been queued yet.“ Force-cancel answers the same; only deleting the run on GitHub helps.
fn cancel_stuck() -> &'static str {
    tr(
        "GitHub nimmt den Abbruch nicht an – der Run hängt auf GitHub. Lösche ihn dort.",
        "GitHub refuses to cancel – the run is stuck on GitHub. Delete it there.",
    )
}
fn cancel_forbidden() -> &'static str {
    tr(
        "Abbrechen nicht erlaubt – der Zugang braucht „Actions: Lesen und Schreiben“.",
        "Cancelling not allowed – the access needs “Actions: Read and write”.",
    )
}

impl<T: Transport> LiveStore<T> {
    /// Asks GitHub once to cancel an open run of a selected repository with write access.
    /// Accepted (202), the repository's runs poll at the next refresh; nothing is changed
    /// locally. Refused requests are never sent again on their own.
    pub fn cancel_run(&mut self, repo_id: String, run_id: u64) -> Result<Snapshot, String> {
        let run = self
            .data
            .runs
            .iter()
            .find(|run| run.id == run_id && run.repo_id == repo_id)
            .ok_or(tr("Run nicht gefunden.", "Run not found."))?;
        match run.status {
            RunStatus::Completed => {
                return Err(tr("Run ist bereits beendet.", "Run has already finished.").into())
            }
            RunStatus::Stuck => return Err(cancel_stuck().into()),
            _ => {}
        }
        let repo = self
            .data
            .repos
            .iter()
            .find(|repo| repo.id == repo_id && repo.selected)
            .ok_or(tr(
                "Repository nicht im Tray.",
                "Repository not in the tray.",
            ))?;
        if repo.permission != Permission::Write {
            return Err(tr(
                "Für dieses Repository fehlt der Schreibzugriff.",
                "Write access to this repository is missing.",
            )
            .into());
        }
        let request = ApiRequest::cancel_run(&repo.account_id, &repo.owner, &repo.name, run_id)
            .map_err(|error| error.to_string())?;
        let (status, body) = match self.client.post(&request, (self.clock)()) {
            Ok(response) => (response.status, response.body),
            Err(error) => return Err(cancel_failed(error)),
        };
        let refused = match status {
            202 => None,
            status => Some(match status {
                409 if never_queued(&body) => cancel_stuck().to_owned(),
                409 => cancel_finished().to_owned(),
                401 => trf!(
                    "Zugang von {} abgelaufen oder widerrufen – verbinde das Konto neu.",
                    "Access of {} expired or revoked – reconnect the account.",
                    self.login(&repo.account_id)
                ),
                403 | 404 => cancel_forbidden().to_owned(),
                status => trf!(
                    "GitHub-Fehler {status} beim Abbrechen.",
                    "GitHub error {status} while cancelling."
                ),
            }),
        };
        // Accepted, or already finished on GitHub: the next refresh polls the real status.
        if matches!(status, 202 | 409) {
            self.poll_at.remove(&repo_id);
        }
        match refused {
            None => Ok(self.snapshot()),
            Some(text) => Err(text),
        }
    }
}

/// A rate limit (throttling 403/429 or an armed backoff) keeps the client's own text, as
/// do a credential the vault cannot give and a request that never left (`BeforeSend`: „GitHub
/// nicht erreichbar“); only a request whose answer never arrived may still have reached GitHub.
fn cancel_failed(error: ApiError) -> String {
    match error {
        ApiError::Transport(TransportError::OutcomeUnknown) | ApiError::InvalidResponse => {
            cancel_unconfirmed().into()
        }
        other => other.to_string(),
    }
}

/// Whether a 409 says GitHub never queued the run, as opposed to having finished it.
fn never_queued(body: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|value| value["message"].as_str().map(str::to_ascii_lowercase))
        .is_some_and(|message| message.contains("not been queued"))
}
