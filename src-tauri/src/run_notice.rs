//! Text of the desktop notification shown when a watched run completes.

use crate::models::{Repo, Run};
use crate::trf;

/// Title and body for a completed `run`: the title names the repository as `owner/name`,
/// the body the workflow. Falls back to the app name when the run's repository is not
/// in `repos`.
pub fn completion_notice(run: &Run, repos: &[Repo]) -> (String, String) {
    let title = repos
        .iter()
        .find(|repo| repo.id == run.repo_id)
        .map_or_else(
            || "RepoWatch".to_owned(),
            |repo| format!("{}/{}", repo.owner, repo.name),
        );
    let name = &run.name;
    (title, trf!("{name}: Run beendet.", "{name}: Run finished."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Permission, RunStatus};

    fn repo(id: &str, owner: &str, name: &str) -> Repo {
        Repo {
            id: id.into(),
            account_id: "account-1".into(),
            owner: owner.into(),
            name: name.into(),
            default_branch: "main".into(),
            pushed_at: None,
            selected: true,
            permission: Permission::Write,
        }
    }

    fn run(repo_id: &str) -> Run {
        Run {
            id: 1,
            repo_id: repo_id.into(),
            workflow_id: 7,
            name: "Build".into(),
            branch: "main".into(),
            status: RunStatus::Completed,
            conclusion: None,
            created_at: "2026-11-03T10:00:00Z".into(),
            updated_at: "2026-11-03T10:05:00Z".into(),
            html_url: "https://github.com/example-org/demo-app/actions/runs/1".into(),
        }
    }

    #[test]
    fn names_the_repository_and_the_workflow() {
        let repos = [
            repo("r1", "example-org", "other"),
            repo("r2", "example-org", "demo-app"),
        ];
        assert_eq!(
            completion_notice(&run("r2"), &repos),
            ("example-org/demo-app".into(), "Build: Run beendet.".into())
        );
    }

    #[test]
    fn falls_back_to_the_app_name_for_an_unknown_repository() {
        assert_eq!(
            completion_notice(&run("missing"), &[]),
            ("RepoWatch".into(), "Build: Run beendet.".into())
        );
    }

    #[test]
    fn speaks_english_when_chosen() {
        let notice = crate::i18n::with_locale(crate::i18n::Locale::En, || {
            completion_notice(&run("missing"), &[])
        });
        assert_eq!(notice.1, "Build: Run finished.");
    }
}
