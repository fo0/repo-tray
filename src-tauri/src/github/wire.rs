//! Wire contracts: the dispatch confirmation, dispatched-run tracking and the one
//! wire-to-`Run` conversion.
use super::{
    validate_segment, ApiError, ApiRequest, ApiResponse, ApiUrl, API_ORIGIN, MAX_RESPONSE_BYTES,
};
use crate::models::{Conclusion, Run, RunStatus};
use serde::Deserialize;

/// GitHub's API 2026-03-10 contract: HTTP 200 with an explicit run ID and both URLs.
/// Source: https://docs.github.com/en/rest/actions/workflows?apiVersion=2026-03-10#create-a-workflow-dispatch-event
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DispatchConfirmation {
    pub workflow_run_id: u64,
    pub run_url: ApiUrl,
    pub html_url: String,
}

pub fn parse_dispatch_confirmation(
    response: &ApiResponse,
    owner: &str,
    repo: &str,
) -> Result<DispatchConfirmation, ApiError> {
    validate_segment(owner)?;
    validate_segment(repo)?;
    if response.status != 200 || response.body.len() > MAX_RESPONSE_BYTES {
        return Err(ApiError::InvalidResponse);
    }
    #[derive(Deserialize)]
    struct WireConfirmation {
        workflow_run_id: u64,
        run_url: String,
        html_url: String,
    }
    let wire: WireConfirmation =
        serde_json::from_slice(&response.body).map_err(|_| ApiError::InvalidResponse)?;
    let expected_path = format!(
        "/repos/{owner}/{repo}/actions/runs/{}",
        wire.workflow_run_id
    );
    let run_url = ApiUrl::parse(&wire.run_url)?;
    if wire.workflow_run_id == 0
        || run_url.as_str() != format!("{API_ORIGIN}{expected_path}")
        || wire.html_url
            != format!(
                "https://github.com/{owner}/{repo}/actions/runs/{}",
                wire.workflow_run_id
            )
    {
        return Err(ApiError::InvalidResponse);
    }
    Ok(DispatchConfirmation {
        workflow_run_id: wire.workflow_run_id,
        run_url,
        html_url: wire.html_url,
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunTracker {
    pub account_id: String,
    pub repo_id: String,
    pub workflow_id: u64,
    pub confirmation: DispatchConfirmation,
}

impl RunTracker {
    pub fn request(&self) -> Result<ApiRequest, ApiError> {
        ApiRequest::get(&self.account_id, self.confirmation.run_url.clone())
    }

    pub fn parse(&self, response: &ApiResponse) -> Result<Run, ApiError> {
        if response.status != 200 || response.body.len() > MAX_RESPONSE_BYTES {
            return Err(ApiError::InvalidResponse);
        }
        let value: serde_json::Value =
            serde_json::from_slice(&response.body).map_err(|_| ApiError::InvalidResponse)?;
        let run = run_from_wire(&self.repo_id, &value)?;
        if run.id != self.confirmation.workflow_run_id
            || run.workflow_id != self.workflow_id
            || run.html_url != self.confirmation.html_url
        {
            return Err(ApiError::InvalidResponse);
        }
        Ok(run)
    }
}

/// A single-resource lookup that GitHub answers with "not found" or "gone": the run was
/// deleted (retention, cleanup) and can never complete, so it leaves tracking.
pub fn resource_gone(status: u16) -> bool {
    matches!(status, 404 | 410)
}

/// The one wire-to-`Run` conversion for run lists, history resolution and dispatch tracking.
/// Future wire values never fail a refresh or keep a finished run open: a conclusion makes
/// the run terminal even under an unknown status, and an unknown conclusion still completes
/// the run, unclassified. An unknown status without a conclusion stays open (queued).
pub fn run_from_wire(repo_id: &str, value: &serde_json::Value) -> Result<Run, ApiError> {
    let id = value["id"].as_u64().filter(|id| *id > 0);
    let workflow_id = value["workflow_id"].as_u64().filter(|id| *id > 0);
    let (Some(id), Some(workflow_id)) = (id, workflow_id) else {
        return Err(ApiError::InvalidResponse);
    };
    let text = |key: &str| value[key].as_str().ok_or(ApiError::InvalidResponse);
    let (created_at, updated_at, html_url) =
        (text("created_at")?, text("updated_at")?, text("html_url")?);
    if chrono::DateTime::parse_from_rfc3339(created_at).is_err()
        || chrono::DateTime::parse_from_rfc3339(updated_at).is_err()
    {
        return Err(ApiError::InvalidResponse);
    }
    let concluded = value["conclusion"].as_str();
    let status = match value["status"].as_str() {
        Some("completed") => RunStatus::Completed,
        Some("in_progress") => RunStatus::InProgress,
        // Requested runs are about to enter the queue.
        Some("queued" | "requested") => RunStatus::Queued,
        // Pending waits for a concurrency group, waiting for a protection rule.
        Some("waiting" | "pending") => RunStatus::Waiting,
        _ if concluded.is_some() => RunStatus::Completed,
        _ => RunStatus::Queued,
    };
    let conclusion = match concluded.filter(|_| status == RunStatus::Completed) {
        Some("success") => Some(Conclusion::Success),
        Some("failure" | "timed_out" | "action_required" | "startup_failure") => {
            Some(Conclusion::Failure)
        }
        Some("cancelled" | "skipped" | "neutral" | "stale") => Some(Conclusion::Cancelled),
        _ => None,
    };
    Ok(Run {
        id,
        repo_id: repo_id.into(),
        workflow_id,
        // The REST schema allows a null run name; the commit title is the next best label.
        name: value["name"]
            .as_str()
            .or_else(|| value["display_title"].as_str())
            .unwrap_or_default()
            .into(),
        branch: value["head_branch"].as_str().unwrap_or_default().into(),
        status,
        conclusion,
        created_at: created_at.into(),
        updated_at: updated_at.into(),
        html_url: html_url.into(),
    })
}
