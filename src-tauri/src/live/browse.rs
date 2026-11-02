//! Repositories the user opened from the panel search: selected for this session, so their
//! workflows and runs load, without changing the automatic selection rules.
use super::LiveStore;
use crate::{github::Transport, models::*};
use std::collections::{BTreeSet, VecDeque};

/// Opened repositories that stay selected, newest first; the oldest drops out past the cap.
pub(super) const BROWSED_REPOS: usize = 5;

/// The session-only list of opened repository IDs, least recently opened first. It is never
/// persisted: after a restart only the automatic selection and favorites remain. A dropped
/// repository just loses this protection; the next catalog listing deselects it unless it is
/// auto-selected or pinned.
#[derive(Debug, Default)]
pub(super) struct Browsed(VecDeque<String>);
impl Browsed {
    /// Moves the repository to the newest place, adding it if needed.
    pub(super) fn visit(&mut self, repo_id: &str) {
        self.0.retain(|known| known != repo_id);
        self.0.push_back(repo_id.to_owned());
        while self.0.len() > BROWSED_REPOS {
            self.0.pop_front();
        }
    }
    pub(super) fn contains(&self, repo_id: &str) -> bool {
        self.0.iter().any(|known| known == repo_id)
    }
    pub(super) fn retain(&mut self, keep: impl Fn(&str) -> bool) {
        self.0.retain(|known| keep(known));
    }
    #[cfg(test)]
    pub(super) fn ids(&self) -> Vec<&str> {
        self.0.iter().map(String::as_str).collect()
    }
}

impl<T: Transport> LiveStore<T> {
    /// Selects a listed repository the panel search found, so its workflows and runs load
    /// at once. An already selected one is only refreshed; one opened before moves to the
    /// newest place of the session's opened repositories.
    pub fn open_repository(&mut self, repo_id: String) -> Result<Snapshot, String> {
        let accounts: BTreeSet<_> = self.data.accounts.iter().map(|a| a.id.as_str()).collect();
        let repo = self
            .data
            .repos
            .iter_mut()
            .find(|repo| repo.id == repo_id && accounts.contains(repo.account_id.as_str()))
            .ok_or("Repository nicht gefunden.")?;
        if !repo.selected {
            repo.selected = true;
            self.browsed.visit(&repo_id);
            // Its runs left the snapshot when it was deselected: it loads its metadata and
            // its initial history now, not on the old timers.
            self.schedule.metadata_now(&repo_id);
            self.history_since.remove(&repo_id);
            self.poll_at.remove(&repo_id);
        } else if self.browsed.contains(&repo_id) {
            self.browsed.visit(&repo_id);
        }
        Ok(self.refresh())
    }
    /// Opened repositories stay selected across a catalog listing that would deselect them.
    pub(super) fn keep_browsed(&mut self) {
        let listed: BTreeSet<_> = self.data.repos.iter().map(|r| r.id.clone()).collect();
        self.browsed.retain(|id| listed.contains(id));
        for repo in &mut self.data.repos {
            if self.browsed.contains(&repo.id) {
                repo.selected = true;
            }
        }
    }
}
