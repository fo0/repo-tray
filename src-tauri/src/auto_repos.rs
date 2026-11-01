//! The automatic repository selection: every account shows its most recently pushed
//! repositories, plus each repository a favorite starts in, so favorites keep working.
use crate::models::{Pin, Repo};
use chrono::{DateTime, FixedOffset};
use std::cmp::Reverse;
use std::collections::BTreeMap;

/// Repositories each account shows by its newest pushes.
pub const AUTO_REPOS: usize = 10;

/// A push time as GitHub writes it (RFC 3339); anything else counts as missing.
pub fn push_time(value: Option<&str>) -> Option<DateTime<FixedOffset>> {
    value.and_then(|text| DateTime::parse_from_rfc3339(text).ok())
}

/// Selects, per account, the `AUTO_REPOS` repositories with the newest push (a missing or
/// unreadable push time last, ties by `owner/name`) and every repository of a favorite of
/// that account. Every other repository is deselected.
pub fn auto_select(repos: &mut [Repo], pins: &[Pin]) {
    let mut order: Vec<usize> = (0..repos.len()).collect();
    order.sort_by_cached_key(|&index| {
        let repo = &repos[index];
        (
            Reverse(push_time(repo.pushed_at.as_deref())),
            repo.owner.to_lowercase(),
            repo.name.to_lowercase(),
            repo.id.clone(),
        )
    });
    let mut shown: BTreeMap<String, usize> = BTreeMap::new();
    for index in order {
        let repo = &mut repos[index];
        let count = shown.entry(repo.account_id.clone()).or_default();
        let newest = *count < AUTO_REPOS;
        if newest {
            *count += 1;
        }
        let pinned = pins
            .iter()
            .any(|pin| pin.repo_id == repo.id && pin.account_id == repo.account_id);
        repo.selected = newest || pinned;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Inputs, Permission};

    fn repo(account: &str, name: &str, pushed_at: Option<&str>) -> Repo {
        Repo {
            id: format!("{account}:{name}"),
            account_id: account.into(),
            owner: "fixture-owner".into(),
            name: name.into(),
            default_branch: "main".into(),
            pushed_at: pushed_at.map(str::to_owned),
            selected: false,
            permission: Permission::Write,
        }
    }
    fn pin(account: &str, repo_id: &str) -> Pin {
        Pin {
            id: format!("pin-{repo_id}"),
            label: "Fixture".into(),
            account_id: account.into(),
            repo_id: repo_id.into(),
            workflow_id: 9,
            git_ref: "main".into(),
            inputs: Inputs::new(),
            quick_start: false,
        }
    }
    fn selected(repos: &[Repo]) -> Vec<&str> {
        let mut ids: Vec<_> = repos
            .iter()
            .filter(|r| r.selected)
            .map(|r| r.id.as_str())
            .collect();
        ids.sort();
        ids
    }

    #[test]
    fn the_newest_pushes_win_and_a_missing_push_time_ranks_last() {
        let mut repos: Vec<_> = (0..12)
            .map(|day| {
                let pushed = format!("2026-10-{:02}T08:00:00Z", day + 1);
                repo("a", &format!("r{day:02}"), Some(&pushed))
            })
            .collect();
        repos.push(repo("a", "never", None));
        repos.push(repo("a", "garbled", Some("yesterday")));
        // An offset is read as the moment it names: 2026-10-13T01:00Z, the newest push.
        repos.push(repo("a", "offset", Some("2026-10-13T03:00:00+02:00")));
        // An earlier selection does not count.
        repos[0].selected = true;
        auto_select(&mut repos, &[]);
        let mut expected: Vec<_> = (3..12).map(|day| format!("a:r{day:02}")).collect();
        expected.push("a:offset".into());
        expected.sort();
        assert_eq!(selected(&repos), expected);
        assert_eq!(selected(&repos).len(), AUTO_REPOS);
    }

    #[test]
    fn ties_go_by_owner_and_name_and_each_account_ranks_alone() {
        let same = Some("2026-10-01T08:00:00Z");
        let mut repos: Vec<_> = (0..AUTO_REPOS + 2)
            .rev()
            .map(|index| repo("a", &format!("Name-{index:02}"), same))
            .collect();
        repos.push(repo("b", "lonely", None));
        auto_select(&mut repos, &[]);
        let picked = selected(&repos);
        assert!(picked.contains(&"a:Name-00") && picked.contains(&"a:Name-09"));
        assert!(!picked.contains(&"a:Name-10") && !picked.contains(&"a:Name-11"));
        assert!(
            picked.contains(&"b:lonely"),
            "another account keeps its own slots"
        );
    }

    #[test]
    fn a_favorite_keeps_its_repository_beyond_the_newest() {
        let mut repos: Vec<_> = (0..AUTO_REPOS)
            .map(|index| repo("a", &format!("new-{index}"), Some("2026-10-02T08:00:00Z")))
            .collect();
        repos.push(repo("a", "old", Some("2020-01-01T00:00:00Z")));
        repos.push(repo("a", "other", None));
        // A favorite of another account never selects this account's repository.
        auto_select(&mut repos, &[pin("a", "a:old"), pin("b", "a:other")]);
        assert_eq!(selected(&repos).len(), AUTO_REPOS + 1);
        assert!(selected(&repos).contains(&"a:old"));
        assert!(!selected(&repos).contains(&"a:other"));
    }
}
