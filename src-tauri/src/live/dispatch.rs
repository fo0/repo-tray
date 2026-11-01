//! Workflow starts: validated against the last refresh, claimed before the POST and sent
//! exactly once; an uncertain start stays locked until the user releases it.
use super::LiveStore;
use crate::{
    cache::Release,
    github::{ApiRequest, ApiUrl, Transport},
    models::*,
    workflow::validate_inputs,
};

impl<T: Transport> LiveStore<T> {
    /// Explicit user action after checking the runs on GitHub. It never dispatches, and no
    /// code path calls it automatically.
    pub fn release_uncertain_start(&mut self, start: UncertainStart) -> Result<Snapshot, String> {
        let release = self
            .cache
            .release_uncertain_start(&start)
            .map_err(|_| "Startsperre konnte nicht aufgehoben werden.")?;
        self.claims = self
            .cache
            .uncertain_starts()
            .map_err(|_| "Startsperren konnten nicht geladen werden.")?;
        if release == Release::Replaced {
            return Err(
                "Für dieses Ziel gibt es eine neuere Startsperre. Prüfe die Runs erneut.".into(),
            );
        }
        Ok(self.snapshot())
    }
    /// Validates against the last refresh, reads the workflow at the requested ref (a ref
    /// GitHub no longer knows is rejected here, before any claim), then sends exactly once.
    pub fn dispatch(&mut self, request: DispatchRequest) -> DispatchOutcome {
        if let Err(error) = validate_request_id(&request.request_id) {
            return DispatchOutcome::rejected(error);
        }
        let fingerprint = match serde_json::to_string(&request) {
            Ok(v) => v,
            Err(_) => return DispatchOutcome::rejected("Ungültige Anfrage."),
        };
        if let Some((prior, outcome)) = self.outcomes.get(&request.request_id) {
            return if prior == &fingerprint {
                outcome.clone()
            } else {
                DispatchOutcome::rejected("Start-ID bereits verwendet.")
            };
        }
        let checked = (|| -> Result<(Repo, crate::github::ApiRequest), String> {
            if self.data.stale {
                return Err("Verbindung zuerst aktualisieren.".into());
            }
            let repo = self
                .data
                .repos
                .iter()
                .find(|r| {
                    r.id == request.repo_id && r.account_id == request.account_id && r.selected
                })
                .ok_or("Repository nicht ausgewählt.")?
                .clone();
            if repo.permission != Permission::Write {
                return Err("Repository hat keinen Schreibzugriff.".into());
            }
            let workflow = self
                .data
                .workflows
                .iter()
                .find(|w| w.id == request.workflow_id && w.repo_id == repo.id && w.dispatch)
                .ok_or("Workflow ist nicht manuell startbar.")?;
            let default = self.yaml(&repo, &workflow.path, &repo.default_branch)?;
            if !default.dispatch {
                return Err("workflow_dispatch fehlt im Default-Branch.".into());
            }
            if !workflow.refs.contains(&request.git_ref) {
                return Err("Branch/Tag unbekannt. Metadaten aktualisieren.".into());
            }
            let actual = self.yaml(&repo, &workflow.path, &request.git_ref)?;
            if !actual.dispatch {
                return Err("workflow_dispatch fehlt im gewählten Ref.".into());
            }
            let inputs =
                validate_inputs(&actual.inputs, &request.inputs).map_err(|e| e.to_string())?;
            let api = ApiRequest::workflow_dispatch(
                &repo.account_id,
                &repo.owner,
                &repo.name,
                workflow.id,
                &request.git_ref,
                &inputs,
            )
            .map_err(|e| e.to_string())?;
            Ok((repo, api))
        })();
        let outcome = match checked {
            Err(error) => DispatchOutcome::rejected(error),
            Ok((repo, api)) => self.send_claimed(&request, repo, api),
        };
        self.outcomes
            .insert(request.request_id, (fingerprint, outcome.clone()));
        outcome
    }
    /// Persists the target claim, sends exactly once, and keeps the target locked whenever
    /// the outcome is unknown or the claim could not be removed.
    fn send_claimed(
        &mut self,
        request: &DispatchRequest,
        repo: Repo,
        api: ApiRequest,
    ) -> DispatchOutcome {
        let target = DispatchTarget {
            account_id: repo.account_id.clone(),
            repo_id: repo.id.clone(),
            workflow_id: request.workflow_id,
            git_ref: request.git_ref.clone(),
        };
        match self
            .cache
            .claim_dispatch(&target, &chrono::Utc::now().to_rfc3339())
        {
            Err(_) => {
                return DispatchOutcome::rejected(
                    "Startsperre konnte nicht gespeichert werden. Es wurde nichts gestartet.",
                )
            }
            Ok(None) => {
                return DispatchOutcome::uncertain(
                    "Der letzte Start dieses Ziels ist ungeklärt. Kein erneuter Start; prüfe die Runs auf GitHub und hebe die Sperre danach auf.",
                )
            }
            Ok(Some(claim)) => self.claims.push(claim),
        }
        let mut outcome = self
            .client
            .dispatch(&api, &repo.owner, &repo.name, (self.clock)());
        if outcome.state != DispatchState::Uncertain {
            match self.cache.resolve_dispatch(&target) {
                Ok(()) => self.claims.retain(|claim| claim.target() != target),
                Err(_) => outcome.message.push_str(
                    " Die Startsperre konnte nicht aufgehoben werden; prüfe die Runs auf GitHub und hebe sie danach auf.",
                ),
            }
        }
        if outcome.state == DispatchState::Accepted {
            if let (Some(id), Some(html_url)) = (outcome.run_id, outcome.html_url.as_ref()) {
                if let Ok(run_url) = ApiUrl::parse(&format!(
                    "https://api.github.com/repos/{}/{}/actions/runs/{id}",
                    repo.owner, repo.name
                )) {
                    self.tracked.insert(
                        id,
                        crate::github::RunTracker {
                            account_id: repo.account_id.clone(),
                            repo_id: repo.id.clone(),
                            workflow_id: request.workflow_id,
                            confirmation: crate::github::DispatchConfirmation {
                                workflow_run_id: id,
                                run_url,
                                html_url: html_url.clone(),
                            },
                        },
                    );
                }
            }
            self.poll_at.clear();
            self.refresh();
        }
        outcome
    }
}
