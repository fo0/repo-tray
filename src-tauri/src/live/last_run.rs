//! The latest run of workflows the run history does not show. The history keeps only the
//! newest completed runs per repository, so a rarely run workflow, such as a release, falls
//! out of it; one lookup per such workflow names when it last ran.
use super::{schedule::METADATA_SECONDS, url, LiveStore};
use crate::{
    github::{ApiError, Transport},
    models::*,
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// Latest-run lookups per repository and metadata read; workflows past it keep their last
/// known value until their turn comes.
pub(super) const MAX_RUN_LOOKUPS: usize = 10;

impl<T: Transport> LiveStore<T> {
    /// Sets `last_run_at` of each workflow without a known run; a workflow with one shows
    /// that run instead and keeps `None`. Favorites' workflows go first; the others take
    /// turns, the window moving on by `MAX_RUN_LOOKUPS` with each metadata read, so every
    /// workflow gets a value however many there are. Best effort: a failed lookup never
    /// fails the metadata scope. It sends no further lookup for this repository in this
    /// pass, and the workflows it leaves out keep their last known value.
    pub(super) fn fill_last_runs(&self, repo: &Repo, workflows: &mut [Workflow], now: u64) {
        let known: BTreeSet<u64> = self
            .data
            .runs
            .iter()
            .filter(|run| run.repo_id == repo.id)
            .map(|run| run.workflow_id)
            .collect();
        let previous: BTreeMap<u64, &str> = self
            .data
            .workflows
            .iter()
            .filter(|workflow| workflow.repo_id == repo.id)
            .filter_map(|workflow| Some((workflow.id, workflow.last_run_at.as_deref()?)))
            .collect();
        let pinned: BTreeSet<u64> = self
            .data
            .pins
            .iter()
            .filter(|pin| pin.repo_id == repo.id)
            .map(|pin| pin.workflow_id)
            .collect();
        let (mut order, mut others): (Vec<usize>, Vec<usize>) = (0..workflows.len())
            .filter(|&index| !known.contains(&workflows[index].id))
            .partition(|&index| pinned.contains(&workflows[index].id));
        if !others.is_empty() {
            let turn = (now / METADATA_SECONDS) as usize;
            let len = others.len();
            others.rotate_left(turn.wrapping_mul(MAX_RUN_LOOKUPS) % len);
        }
        order.extend(others);
        let mut lookups = 0;
        let mut failed = false;
        for index in order {
            let workflow = &mut workflows[index];
            let last = previous.get(&workflow.id).map(|at| (*at).to_owned());
            workflow.last_run_at = if failed || lookups >= MAX_RUN_LOOKUPS {
                last
            } else {
                lookups += 1;
                self.latest_run_at(repo, workflow.id, now)
                    .unwrap_or_else(|_| {
                        failed = true;
                        last
                    })
            };
        }
    }
    /// The creation time of the workflow's newest run: one cached page of one entry.
    fn latest_run_at(
        &self,
        repo: &Repo,
        workflow_id: u64,
        now: u64,
    ) -> Result<Option<String>, ApiError> {
        let id = workflow_id.to_string();
        let path = [
            "repos",
            repo.owner.as_str(),
            repo.name.as_str(),
            "actions",
            "workflows",
            id.as_str(),
            "runs",
        ];
        let first = url(&path, &[("per_page", "1")])
            .map_err(|_| ApiError::Policy("API-Adresse ungültig."))?;
        let pages = self
            .client
            .get_pages_limited(&repo.account_id, first, now, 1)?;
        let body = pages.bodies.first().ok_or(ApiError::InvalidResponse)?;
        let page: Value = serde_json::from_slice(body).map_err(|_| ApiError::InvalidResponse)?;
        let runs = page["workflow_runs"]
            .as_array()
            .ok_or(ApiError::InvalidResponse)?;
        Ok(runs
            .first()
            .and_then(|run| run["created_at"].as_str())
            .filter(|at| chrono::DateTime::parse_from_rfc3339(at).is_ok())
            .map(str::to_owned))
    }
}
