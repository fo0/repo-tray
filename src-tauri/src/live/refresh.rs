//! The refresh orchestration: account catalogs, repository metadata and runs, each scope
//! on its own timer, settled into one snapshot and notice.
use super::{
    catalog::{account_repos, bounded_refs, list_values, merge_catalog, RefListing, REF_PAGES},
    empty_snapshot, number, text,
    transport::OAuthClient,
    with_notice, LiveStore, Schedule, BROWSER_SETUP_NOTICE,
};
use crate::{
    browser_auth,
    github::Transport,
    models::*,
    run_history::{self, Cause, ScopeError},
};
use std::collections::{BTreeMap, BTreeSet};

impl<T: Transport> LiveStore<T> {
    /// Lists every account whose catalog is due, each on its own timer. A failing account
    /// keeps its last known repositories: a transient failure retries after a minute, an
    /// unauthorized account waits out its hold. Healthy accounts are not refetched early.
    fn catalog(&mut self, issues: &mut RefreshIssues, now: u64) {
        let mut listings = BTreeMap::new();
        for account in &self.data.accounts {
            if issues.blocked.contains(&account.id) || !self.schedule.catalog_due(&account.id, now)
            {
                continue;
            }
            match account_repos(&self.client, account, now) {
                Ok(listing) => {
                    self.schedule.catalog_read(&account.id, None, now);
                    listings.insert(account.id.clone(), listing);
                }
                Err(error) => {
                    let error = error.for_account();
                    self.schedule.catalog_read(&account.id, Some(&error), now);
                    if matches!(error, ScopeError::Unauthorized(_)) {
                        self.schedule.hold(&account.id, error.clone(), now);
                    }
                    issues.block(account, error);
                }
            }
        }
        if !listings.is_empty() {
            self.data.repos = merge_catalog(&self.data.repos, &self.data.accounts, listings);
        }
    }
    fn repo_metadata(&self, repo: &Repo, now: u64) -> Result<Vec<Workflow>, ScopeError> {
        let base = ["repos", repo.owner.as_str(), repo.name.as_str()];
        let mut listing = RefListing::default();
        for (kind, names) in [
            ("branches", &mut listing.branches),
            ("tags", &mut listing.tags),
        ] {
            let path = [base.as_slice(), &[kind]].concat();
            let (values, truncated) =
                list_values(&self.client, &repo.account_id, &path, None, REF_PAGES, now)?;
            listing.truncated |= truncated;
            for value in values {
                names.push(text(&value, "name")?.to_string());
            }
        }
        let mut workflows = vec![];
        let (values, _) = list_values(
            &self.client,
            &repo.account_id,
            &[base.as_slice(), &["actions", "workflows"]].concat(),
            Some("workflows"),
            usize::MAX,
            now,
        )?;
        for value in values {
            let path = text(&value, "path")?;
            // Fail closed when YAML cannot be read/parsed; activity remains available.
            let mut parsed = self.yaml(repo, path, &repo.default_branch).ok();
            if parsed
                .as_ref()
                .is_some_and(|p| p.inputs.iter().any(|i| i.r#type == InputType::Environment))
            {
                let environments = self.list(
                    &repo.account_id,
                    &["repos", &repo.owner, &repo.name, "environments"],
                    Some("environments"),
                );
                match environments {
                    Ok(values) => {
                        let names: Vec<_> = values
                            .iter()
                            .filter_map(|v| v["name"].as_str().map(str::to_string))
                            .collect();
                        if let Some(p) = &mut parsed {
                            for input in &mut p.inputs {
                                if input.r#type == InputType::Environment {
                                    input.options = names.clone();
                                }
                            }
                        }
                    }
                    Err(_) => parsed = None,
                }
            }
            workflows.push(Workflow {
                id: number(&value, "id")?,
                repo_id: repo.id.clone(),
                name: text(&value, "name")?.into(),
                path: path.into(),
                dispatch: value["state"] == "active" && parsed.as_ref().is_some_and(|p| p.dispatch),
                inputs: parsed.map(|p| p.inputs).unwrap_or_default(),
                refs: vec![],
            });
        }
        let pinned: Vec<_> = self
            .data
            .pins
            .iter()
            .filter(|pin| pin.repo_id == repo.id)
            .map(|pin| pin.git_ref.as_str())
            .collect();
        let copies = workflows.iter().filter(|w| w.dispatch).count();
        let refs = bounded_refs(&repo.default_branch, &pinned, &listing, copies);
        for workflow in &mut workflows {
            // Only startable workflows offer a ref choice; the others show the default branch.
            workflow.refs = if workflow.dispatch {
                refs.clone()
            } else {
                vec![repo.default_branch.clone()]
            };
        }
        Ok(workflows)
    }
    /// Every account and repository refreshes on its own: a failing scope keeps its last
    /// known data while the others update, and each keeps its own metadata timer. A denied
    /// repository is marked on the repository itself and named in a notice; any other failure
    /// still marks the whole snapshot stale, because the models carry no per-account or
    /// per-repository freshness yet.
    pub fn refresh(&mut self) -> Snapshot {
        if self.data.accounts.is_empty() {
            self.data = empty_snapshot();
            return self.snapshot();
        }
        let now = (self.clock)();
        let mut issues = RefreshIssues::default();
        let mut oauth = OAuthClient::default();
        for account in &self.data.accounts {
            // An unauthorized account waits for its hold to end or for a reconnect.
            if let Some(error) = self.schedule.held(&account.id, now) {
                issues.block(account, error.clone());
                continue;
            }
            if !browser_auth::is_browser_account(&account.id) {
                continue;
            }
            let usable = match oauth.prepare(&account.id) {
                Ok(oauth) => {
                    browser_auth::access_token(self.keyring.as_ref(), &account.id, oauth, now)
                        .map(drop)
                        .map_err(|error| ScopeError::Unauthorized(Cause::Text(error)))
                }
                Err(error) => Err(ScopeError::Transient(Cause::Text(error))),
            };
            if let Err(error) = usable {
                if matches!(error, ScopeError::Unauthorized(_)) {
                    self.schedule.hold(&account.id, error.clone(), now);
                }
                issues.block(account, error);
            }
        }
        self.catalog(&mut issues, now);
        let selected: Vec<_> = self
            .data
            .repos
            .iter()
            .filter(|r| r.selected)
            .cloned()
            .collect();
        let mut eligible = vec![];
        for repo in &selected {
            if issues.blocked.contains(&repo.account_id) || repo.permission == Permission::Denied {
                continue;
            }
            if self.schedule.metadata_due(&repo.id, now) {
                match self.repo_metadata(repo, now) {
                    Ok(workflows) => {
                        self.schedule.metadata_read(&repo.id, None, now);
                        self.data.workflows.retain(|w| w.repo_id != repo.id);
                        self.data.workflows.extend(workflows);
                    }
                    Err(error) => {
                        self.schedule.metadata_read(&repo.id, Some(&error), now);
                        self.scope_failed(&mut issues, repo, error, now);
                        continue;
                    }
                }
            }
            eligible.push(repo.clone());
        }
        let run_history::RunsRefresh {
            mut runs,
            polled,
            failures,
        } = run_history::refresh_selected(
            &self.client,
            &eligible,
            &self.data.runs,
            &self.poll_at,
            &self.history_since,
            &mut issues.blocked,
            now,
        );
        // Held repositories (account unusable, access denied, metadata failed) keep their runs.
        let eligible_ids: BTreeSet<_> = eligible.iter().map(|r| r.id.as_str()).collect();
        runs.extend(
            self.data
                .runs
                .iter()
                .filter(|run| {
                    !eligible_ids.contains(run.repo_id.as_str())
                        && selected.iter().any(|repo| repo.id == run.repo_id)
                })
                .cloned(),
        );
        for (repo, error) in failures {
            self.scope_failed(&mut issues, &repo, error, now);
        }
        let active: BTreeSet<_> = self
            .data
            .repos
            .iter()
            .filter(|r| {
                eligible_ids.contains(r.id.as_str())
                    && r.permission != Permission::Denied
                    && !issues.blocked.contains(&r.account_id)
            })
            .map(|r| r.id.clone())
            .collect();
        run_history::follow_dispatched(&self.client, &mut self.tracked, &active, &mut runs, now);
        self.data.runs = runs;
        for (repo_id, polled_at) in polled {
            self.poll_at.insert(repo_id.clone(), polled_at);
            self.history_since.insert(repo_id, polled_at);
        }
        self.settle(issues);
        self.snapshot()
    }
    fn login(&self, account_id: &str) -> String {
        self.data
            .accounts
            .iter()
            .find(|account| account.id == account_id)
            .map_or_else(|| account_id.to_owned(), |account| account.login.clone())
    }
    /// A repository-level denial marks only that repository ("Actions · Kein Zugriff"),
    /// which also blocks dispatch to it; the next catalog listing re-reads its permission
    /// and retries it. An unauthorized answer holds the whole account. Every other failure
    /// is reported at snapshot level.
    fn scope_failed(
        &mut self,
        issues: &mut RefreshIssues,
        repo: &Repo,
        error: ScopeError,
        now: u64,
    ) {
        if let ScopeError::Denied(_) = error {
            if let Some(known) = self.data.repos.iter_mut().find(|r| r.id == repo.id) {
                known.permission = Permission::Denied;
            }
            return;
        }
        if let ScopeError::Unauthorized(_) = error {
            issues.blocked.insert(repo.account_id.clone());
            self.schedule.hold(&repo.account_id, error.clone(), now);
        }
        issues.failures.push(Failure {
            login: self.login(&repo.account_id),
            repo: Some(format!("{}/{}", repo.owner, repo.name)),
            error,
        });
    }
    /// Selected repositories whose Actions GitHub refused; their runs are not current.
    fn denied_notice(&self) -> Option<String> {
        let mut denied = self
            .data
            .repos
            .iter()
            .filter(|repo| repo.selected && repo.permission == Permission::Denied);
        let first = denied.next()?;
        let more = match denied.count() {
            0 => String::new(),
            count => format!(" (+{count} weitere)"),
        };
        Some(format!(
            "Kein Zugriff auf Actions: {}/{}{more} – prüfe Token-Rechte oder SSO-Freigabe.",
            first.owner, first.name
        ))
    }
    fn settle(&mut self, issues: RefreshIssues) {
        let denied = self.denied_notice();
        // An account that needs reconnecting is the most actionable headline.
        let headline = issues
            .failures
            .iter()
            .find(|failure| matches!(failure.error, ScopeError::Unauthorized(_)))
            .or_else(|| issues.failures.first());
        match headline {
            None => {
                self.data.updated_at = chrono::Utc::now().to_rfc3339();
                self.data.stale = false;
                self.data.connectivity = Connectivity::Online;
                let setup = (self.data.repos.is_empty()
                    && self
                        .data
                        .accounts
                        .iter()
                        .any(|a| browser_auth::is_browser_account(&a.id)))
                .then(|| BROWSER_SETUP_NOTICE.to_owned());
                self.data.message = match (setup, denied) {
                    (Some(setup), Some(denied)) => Some(with_notice(Some(setup), &denied)),
                    (setup, denied) => setup.or(denied),
                };
            }
            Some(failure) => {
                self.data.stale = true;
                self.data.connectivity = if issues
                    .failures
                    .iter()
                    .any(|failure| matches!(failure.error, ScopeError::Unauthorized(_)))
                {
                    Connectivity::Forbidden
                } else {
                    Connectivity::Offline
                };
                let more = match issues.failures.len() - 1 {
                    0 => String::new(),
                    count => format!(" (+{count} weitere)"),
                };
                let headline = format!("Letzter Stand · {}{more}", failure.describe());
                self.data.message = Some(match denied {
                    Some(denied) => with_notice(Some(headline), &denied),
                    None => headline,
                });
            }
        }
        // Healthy scopes were updated even when another one failed; keep them. A failed cache
        // write only adds a notice and never marks fresh data stale.
        self.persist();
    }
    /// The explicit "refresh repository access" action: every scope, including a held
    /// account, reads its catalog and metadata again now.
    pub fn refresh_repositories(&mut self) -> Snapshot {
        self.schedule = Schedule::default();
        self.refresh()
    }
    pub fn select_repos(&mut self, ids: Vec<String>) -> Result<Snapshot, String> {
        if ids.len() > 50
            || ids
                .iter()
                .any(|id| !self.data.repos.iter().any(|r| &r.id == id))
        {
            return Err("Wähle höchstens 50 bekannte Repositories.".into());
        }
        for repo in &mut self.data.repos {
            let selected = ids.contains(&repo.id);
            if selected && !repo.selected {
                // A deselected repository's runs leave the foreground snapshot.
                // Re-selecting must restore its initial history, not just new runs.
                self.history_since.remove(&repo.id);
            }
            repo.selected = selected;
        }
        self.poll_at.clear();
        self.persist();
        Ok(self.refresh())
    }
}

/// One failing scope of a refresh, named for the panel.
struct Failure {
    login: String,
    /// `owner/name` when the scope is a repository.
    repo: Option<String>,
    error: ScopeError,
}
impl Failure {
    fn describe(&self) -> String {
        self.error.describe(&self.login, self.repo.as_deref())
    }
}

/// Per-refresh bookkeeping: failing scopes and the accounts that sit this refresh out.
#[derive(Default)]
struct RefreshIssues {
    blocked: BTreeSet<String>,
    failures: Vec<Failure>,
}
impl RefreshIssues {
    /// The account sits out the rest of this refresh.
    fn block(&mut self, account: &Account, error: ScopeError) {
        self.blocked.insert(account.id.clone());
        self.failures.push(Failure {
            login: account.login.clone(),
            repo: None,
            error,
        });
    }
}
