//! Per-scope refresh timers and the hold on unauthorized accounts.
use crate::{models::Repo, refresh_interval, run_history::ScopeError};
use std::collections::BTreeMap;

/// How often each repository's metadata is read again, and how long an unauthorized account
/// is held. The account catalog follows the user's refresh interval (`refresh_interval`).
pub(super) const METADATA_SECONDS: u64 = 600;
/// A transiently failed catalog or metadata read retries after this delay.
pub(super) const RETRY_SECONDS: u64 = 60;

/// When each scope next reads its metadata (UNIX seconds; a missing entry means now). Every
/// account catalog and every repository's branches, tags and workflows keep their own timer,
/// so a failing scope never makes the healthy ones refetch early. An unauthorized account
/// sits out every request for the full interval, until it reconnects, or until the explicit
/// repository-access refresh.
#[derive(Debug)]
pub(super) struct Schedule {
    catalog: BTreeMap<String, u64>,
    metadata: BTreeMap<String, u64>,
    held: BTreeMap<String, (u64, ScopeError)>,
    /// Seconds between catalog reads of a healthy account.
    catalog_seconds: u64,
}
impl Default for Schedule {
    fn default() -> Self {
        Self::new(refresh_interval::DEFAULT_SECONDS)
    }
}
impl Schedule {
    pub(super) fn new(refresh_seconds: u64) -> Self {
        Self {
            catalog: BTreeMap::new(),
            metadata: BTreeMap::new(),
            held: BTreeMap::new(),
            catalog_seconds: refresh_interval::catalog_seconds(refresh_seconds),
        }
    }
    /// A changed refresh interval applies from the next catalog read; a deadline set under a
    /// longer interval than the new bound counts as reached at once (`reached`).
    pub(super) fn set_refresh(&mut self, refresh_seconds: u64) {
        self.catalog_seconds = refresh_interval::catalog_seconds(refresh_seconds);
    }
    /// Deadlines are wall-clock times. One further ahead than the longest delay any scope
    /// gets was set before the clock went back, so it counts as reached: a backward clock
    /// jump never stalls a read or extends a hold beyond one interval.
    fn reached(&self, at: u64, now: u64) -> bool {
        let longest = self.catalog_seconds.max(METADATA_SECONDS);
        now >= at || at > now.saturating_add(longest)
    }
    pub(super) fn catalog_due(&self, account: &str, now: u64) -> bool {
        self.catalog
            .get(account)
            .is_none_or(|at| self.reached(*at, now))
    }
    pub(super) fn metadata_due(&self, repo: &str, now: u64) -> bool {
        self.metadata
            .get(repo)
            .is_none_or(|at| self.reached(*at, now))
    }
    /// A successful listing proves the account authorized again, so any hold left on it goes.
    pub(super) fn catalog_read(&mut self, account: &str, failure: Option<&ScopeError>, now: u64) {
        let delay = match failure {
            None => {
                self.held.remove(account);
                self.catalog_seconds
            }
            Some(ScopeError::Transient(_)) => RETRY_SECONDS,
            // An unauthorized account waits as long as its hold.
            _ => METADATA_SECONDS,
        };
        self.catalog
            .insert(account.to_owned(), now.saturating_add(delay));
    }
    /// A denied repository is skipped until a catalog listing grants access again and then
    /// reads its metadata at once.
    pub(super) fn metadata_read(&mut self, repo: &str, failure: Option<&ScopeError>, now: u64) {
        let delay = match failure {
            Some(ScopeError::Denied(_)) => {
                self.metadata.remove(repo);
                return;
            }
            Some(ScopeError::Transient(_)) => RETRY_SECONDS,
            _ => METADATA_SECONDS,
        };
        self.metadata
            .insert(repo.to_owned(), now.saturating_add(delay));
    }
    /// The repository reads its metadata on the next refresh.
    pub(super) fn metadata_now(&mut self, repo: &str) {
        self.metadata.remove(repo);
    }
    pub(super) fn hold(&mut self, account: &str, error: ScopeError, now: u64) {
        let until = now.saturating_add(METADATA_SECONDS);
        self.held.insert(account.to_owned(), (until, error));
        self.catalog.insert(account.to_owned(), until);
    }
    /// The error an account is held for. A hold that has ended, also by a backward clock jump,
    /// is dropped, so it never applies again once the clock catches up with its old deadline.
    pub(super) fn held(&mut self, account: &str, now: u64) -> Option<&ScopeError> {
        if self
            .held
            .get(account)
            .is_some_and(|(until, _)| self.reached(*until, now))
        {
            self.held.remove(account);
        }
        self.held.get(account).map(|(_, error)| error)
    }
    /// A new, reconnected or removed account starts its timers over.
    pub(super) fn forget_account(&mut self, account: &str, repos: &[Repo]) {
        self.catalog.remove(account);
        self.held.remove(account);
        for repo in repos.iter().filter(|repo| repo.account_id == account) {
            self.metadata.remove(&repo.id);
        }
    }
}
