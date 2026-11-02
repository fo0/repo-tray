//! Run cancellation: one POST per user action, never retried. GitHub cancels asynchronously,
//! so the run keeps its last known status until the next poll reports the real outcome.
use super::LiveStore;
use crate::{
    github::{ApiError, ApiRequest, Transport, TransportError},
    models::*,
};

const CANCEL_UNCONFIRMED: &str = "Abbruch nicht bestätigt – prüfe den Run auf GitHub.";
const CANCEL_FINISHED: &str = "Run lässt sich nicht mehr abbrechen – er ist bereits beendet.";
const CANCEL_FORBIDDEN: &str =
    "Abbrechen nicht erlaubt – der Zugang braucht „Actions: Lesen und Schreiben“.";

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
            .ok_or("Run nicht gefunden.")?;
        if run.status == RunStatus::Completed {
            return Err("Run ist bereits beendet.".into());
        }
        let repo = self
            .data
            .repos
            .iter()
            .find(|repo| repo.id == repo_id && repo.selected)
            .ok_or("Repository nicht im Tray.")?;
        if repo.permission != Permission::Write {
            return Err("Für dieses Repository fehlt der Schreibzugriff.".into());
        }
        let request = ApiRequest::cancel_run(&repo.account_id, &repo.owner, &repo.name, run_id)
            .map_err(|error| error.to_string())?;
        let refused = match self.client.post(&request, (self.clock)()) {
            Ok(response) if response.status == 202 => None,
            Ok(response) => Some(match response.status {
                409 => CANCEL_FINISHED.to_owned(),
                401 => format!(
                    "Zugang von {} abgelaufen oder widerrufen – verbinde das Konto neu.",
                    self.login(&repo.account_id)
                ),
                403 | 404 => CANCEL_FORBIDDEN.to_owned(),
                status => format!("GitHub-Fehler {status} beim Abbrechen."),
            }),
            Err(error) => return Err(cancel_failed(error)),
        };
        // Accepted, or already finished on GitHub: the next refresh polls the real status.
        if refused
            .as_deref()
            .is_none_or(|text| text == CANCEL_FINISHED)
        {
            self.poll_at.remove(&repo_id);
        }
        match refused {
            None => Ok(self.snapshot()),
            Some(text) => Err(text),
        }
    }
}

/// A rate limit (throttling 403/429 or an armed backoff) keeps the client's German text, as
/// do a credential the vault cannot give and a request that never left (`BeforeSend`: „GitHub
/// nicht erreichbar“); only a request whose answer never arrived may still have reached GitHub.
fn cancel_failed(error: ApiError) -> String {
    match error {
        ApiError::Transport(TransportError::OutcomeUnknown) | ApiError::InvalidResponse => {
            CANCEL_UNCONFIRMED.into()
        }
        other => other.to_string(),
    }
}
