//! Repository catalogs and the bounded ref listing offered per startable workflow.
use super::{number, text, url};
use crate::{
    browser_auth,
    github::{ApiClient, Transport},
    models::*,
    run_history::ScopeError,
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// Pages (100 names each) read per ref kind for the ref picker.
pub(super) const REF_PAGES: usize = 3;
/// Refs offered per startable workflow, the default branch included; pinned refs come on top.
pub(super) const MAX_REFS: usize = 100;
/// Every workflow carries its own copy of the repository's refs; all copies of one
/// repository share this budget, so 50 selected repositories stay far below the cache cap.
pub(super) const REPO_REF_BYTES: usize = 8 * 1024;

/// A listing within `max_pages` (`usize::MAX`: the transport's whole page budget).
/// The flag reports a cut-off listing; GitHub's first pages are returned either way.
pub(super) fn list_values<T: Transport>(
    client: &ApiClient<T>,
    account: &str,
    path: &[&str],
    key: Option<&str>,
    max_pages: usize,
    now: u64,
) -> Result<(Vec<Value>, bool), ScopeError> {
    let pages =
        client.get_pages_limited(account, url(path, &[("per_page", "100")])?, now, max_pages)?;
    let mut all = vec![];
    for body in &pages.bodies {
        let page: Value = serde_json::from_slice(body).map_err(|_| "GitHub-Antwort ungültig.")?;
        all.extend(
            key.map_or(&page, |k| &page[k])
                .as_array()
                .ok_or("GitHub-Liste ungültig.")?
                .iter()
                .cloned(),
        );
    }
    Ok((all, pages.truncated))
}

/// One account's repositories as far as GitHub lists them.
pub(super) struct AccountRepos {
    pub(super) repos: Vec<Repo>,
    pub(super) truncated: bool,
}

pub(super) fn account_repos<T: Transport>(
    client: &ApiClient<T>,
    account: &Account,
    now: u64,
) -> Result<AccountRepos, ScopeError> {
    let mut values = vec![];
    let mut truncated = false;
    if browser_auth::is_browser_account(&account.id) {
        let (installations, cut) = list_values(
            client,
            &account.id,
            &["user", "installations"],
            Some("installations"),
            usize::MAX,
            now,
        )?;
        truncated |= cut;
        for installation in installations {
            if !installation["suspended_at"].is_null() {
                continue;
            }
            let installation_id = number(&installation, "id")?.to_string();
            let (repositories, cut) = list_values(
                client,
                &account.id,
                &["user", "installations", &installation_id, "repositories"],
                Some("repositories"),
                usize::MAX,
                now,
            )?;
            truncated |= cut;
            for value in repositories {
                let permission = browser_repository_permission(&installation, &value);
                values.push((value, permission));
            }
        }
    } else {
        let (repositories, cut) = list_values(
            client,
            &account.id,
            &["user", "repos"],
            None,
            usize::MAX,
            now,
        )?;
        truncated |= cut;
        for value in repositories {
            let permission = if value["permissions"]["push"].as_bool() == Some(true) {
                Permission::Write
            } else {
                Permission::Read
            };
            values.push((value, permission));
        }
    }
    let mut repos = vec![];
    for (value, permission) in values {
        repos.push(Repo {
            id: format!("{}:{}", account.id, number(&value, "id")?),
            account_id: account.id.clone(),
            owner: text(&value["owner"], "login")?.into(),
            name: text(&value, "name")?.into(),
            default_branch: value["default_branch"].as_str().unwrap_or("main").into(),
            selected: false,
            permission,
        });
    }
    Ok(AccountRepos { repos, truncated })
}

/// Listed accounts take their fresh repositories (selection kept by ID); unlisted accounts
/// keep their last known ones. A cut-off listing cannot prove that a selected repository
/// went away, so a selected repository missing from it stays.
pub(super) fn merge_catalog(
    previous: &[Repo],
    accounts: &[Account],
    mut listings: BTreeMap<String, AccountRepos>,
) -> Vec<Repo> {
    let selected: BTreeSet<_> = previous
        .iter()
        .filter(|r| r.selected)
        .map(|r| r.id.as_str())
        .collect();
    let mut repos = vec![];
    for account in accounts {
        let known = previous.iter().filter(|r| r.account_id == account.id);
        match listings.remove(&account.id) {
            None => repos.extend(known.cloned()),
            Some(listing) => {
                for mut repo in listing.repos {
                    repo.selected = selected.contains(repo.id.as_str());
                    repos.push(repo);
                }
                if listing.truncated {
                    repos.extend(known.filter(|r| r.selected).cloned());
                }
            }
        }
    }
    let mut seen = BTreeSet::new();
    repos.retain(|repo| seen.insert(repo.id.clone()));
    repos
}

/// A repository's branches and tags as far as the ref picker reads them.
#[derive(Debug, Default)]
pub(super) struct RefListing {
    pub(super) branches: Vec<String>,
    pub(super) tags: Vec<String>,
    /// Either kind was cut at `REF_PAGES`.
    pub(super) truncated: bool,
}

/// The refs one startable workflow offers, sorted. Dispatch validation in UI and core checks
/// against exactly this list.
///
/// - The default branch, always.
/// - Every ref a pin of this repository uses, outside `MAX_REFS` and the byte budget, so a
///   template stays startable: when the listing names it, or when the listing was cut off and
///   cannot prove the ref is gone. A vanished ref is still safe: `dispatch` reads the workflow
///   at that ref before it claims or sends anything, and GitHub's 404 rejects the start.
/// - Branches and tags in turns, in GitHub's order, while `MAX_REFS` and the repository's
///   byte budget (shared by `copies` workflows) allow; neither kind starves the other.
pub(super) fn bounded_refs(
    default_branch: &str,
    pinned: &[&str],
    listing: &RefListing,
    copies: usize,
) -> Vec<String> {
    let budget = REPO_REF_BYTES / copies.max(1);
    // JSON quotes and a separator per entry.
    let cost = |name: &str| name.len() + 3;
    let mut used = cost(default_branch);
    let mut refs = BTreeSet::from([default_branch.to_owned()]);
    for name in pinned {
        let listed = listing
            .branches
            .iter()
            .chain(&listing.tags)
            .any(|known| known == name);
        if (listed || listing.truncated) && refs.insert((*name).to_owned()) {
            used += cost(name);
        }
    }
    let turns = listing.branches.len().max(listing.tags.len());
    let alternating = (0..turns)
        .flat_map(|index| [listing.branches.get(index), listing.tags.get(index)])
        .flatten();
    for name in alternating {
        if refs.len() >= MAX_REFS {
            break;
        }
        if refs.contains(name) || used + cost(name) > budget {
            continue;
        }
        used += cost(name);
        refs.insert(name.clone());
    }
    refs.into_iter().collect()
}

// Installation Actions rights and the user's repository access are separate requirements.
pub(super) fn browser_repository_permission(installation: &Value, repo: &Value) -> Permission {
    let actions = installation["permissions"]["actions"]
        .as_str()
        .unwrap_or("");
    let contents = installation["permissions"]["contents"]
        .as_str()
        .unwrap_or("");
    if !matches!(actions, "read" | "write") {
        return Permission::Denied;
    }
    if actions == "write"
        && matches!(contents, "read" | "write")
        && repo["permissions"]["push"].as_bool() == Some(true)
    {
        Permission::Write
    } else {
        Permission::Read
    }
}
