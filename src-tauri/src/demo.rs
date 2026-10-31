//! Entirely local simulation: no account, credential, URL opening, or HTTP calls.

use crate::models::*;
use crate::workflow::{validate_inputs, validate_non_secret_inputs};
use chrono::Utc;
use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, Instant};

const FIXTURE: &str = include_str!("../../fixtures/demo.json");
const DEMO_MESSAGE: &str = "Demo data only. No GitHub connection or real workflow starts.";

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Target {
    account_id: String,
    repo_id: String,
    workflow_id: u64,
    git_ref: String,
}

impl From<&DispatchRequest> for Target {
    fn from(request: &DispatchRequest) -> Self {
        Self {
            account_id: request.account_id.clone(),
            repo_id: request.repo_id.clone(),
            workflow_id: request.workflow_id,
            git_ref: request.git_ref.clone(),
        }
    }
}

#[derive(Clone)]
struct RecordedRequest {
    request: DispatchRequest,
    outcome: DispatchOutcome,
}

struct SimulatedRun {
    started: Instant,
    initial_status: RunStatus,
}

pub struct DemoStore {
    snapshot: Snapshot,
    scenario: DemoScenario,
    next_run_id: u64,
    requests: BTreeMap<(String, String), RecordedRequest>,
    uncertain_targets: BTreeSet<Target>,
    simulated_runs: BTreeMap<u64, SimulatedRun>,
}

impl Default for DemoStore {
    fn default() -> Self {
        Self::new()
    }
}

impl DemoStore {
    pub fn new() -> Self {
        let snapshot: Snapshot = serde_json::from_str(FIXTURE)
            .expect("bundled demo fixture must match the checked TypeScript contract");
        let started = Instant::now();
        let simulated_runs = snapshot
            .runs
            .iter()
            .filter(|run| matches!(run.status, RunStatus::Queued | RunStatus::InProgress))
            .map(|run| {
                (
                    run.id,
                    SimulatedRun {
                        started,
                        initial_status: run.status,
                    },
                )
            })
            .collect();
        let next_run_id = snapshot.runs.iter().map(|run| run.id).max().unwrap_or(0) + 1;
        Self {
            snapshot,
            scenario: DemoScenario::Normal,
            next_run_id,
            requests: BTreeMap::new(),
            uncertain_targets: BTreeSet::new(),
            simulated_runs,
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        self.snapshot.clone()
    }

    pub fn refresh(&mut self) -> Snapshot {
        self.refresh_at(Instant::now())
    }

    fn refresh_at(&mut self, now: Instant) -> Snapshot {
        if self.snapshot.connectivity == Connectivity::Online {
            let timestamp = Utc::now().to_rfc3339();
            for run in &mut self.snapshot.runs {
                if let Some(simulation) = self.simulated_runs.get(&run.id) {
                    let elapsed = now.saturating_duration_since(simulation.started);
                    let complete_after = match simulation.initial_status {
                        RunStatus::InProgress => Duration::from_secs(1),
                        _ => Duration::from_secs(2),
                    };
                    let new_status = if elapsed >= complete_after {
                        RunStatus::Completed
                    } else if elapsed >= Duration::from_secs(1) {
                        RunStatus::InProgress
                    } else {
                        simulation.initial_status
                    };
                    if new_status != run.status {
                        run.status = new_status;
                        run.updated_at = timestamp.clone();
                        if new_status == RunStatus::Completed {
                            run.conclusion = Some(Conclusion::Success);
                        }
                    }
                }
            }
            let completed: Vec<_> = self
                .snapshot
                .runs
                .iter()
                .filter(|run| run.status == RunStatus::Completed)
                .map(|run| run.id)
                .collect();
            for id in completed {
                self.simulated_runs.remove(&id);
            }
            self.snapshot.updated_at = timestamp;
            self.snapshot.stale = false;
        }
        self.snapshot()
    }

    pub fn select_repos(&mut self, ids: Vec<String>) -> Result<Snapshot, String> {
        let ids: BTreeSet<_> = ids.into_iter().collect();
        if ids
            .iter()
            .any(|id| !self.snapshot.repos.iter().any(|repo| &repo.id == id))
        {
            return Err("An unknown repository cannot be selected.".into());
        }
        for repo in &mut self.snapshot.repos {
            repo.selected = ids.contains(&repo.id);
        }
        Ok(self.snapshot())
    }

    pub fn save_pin(&mut self, mut pin: Pin) -> Result<Snapshot, String> {
        if pin.id.trim().is_empty() || pin.label.trim().is_empty() || pin.label.len() > 120 {
            return Err("Pins need an ID and a label of at most 120 characters.".into());
        }
        validate_non_secret_inputs(&pin.inputs).map_err(|error| error.to_string())?;
        let request = DispatchRequest {
            account_id: pin.account_id.clone(),
            repo_id: pin.repo_id.clone(),
            workflow_id: pin.workflow_id,
            git_ref: pin.git_ref.clone(),
            inputs: pin.inputs.clone(),
            request_id: "pin-validation".into(),
        };
        pin.inputs = self.validate_request(&request)?;
        // Defaults can introduce secret fields too, so validate the final persisted inputs.
        validate_non_secret_inputs(&pin.inputs).map_err(|error| error.to_string())?;
        if let Some(existing) = self.snapshot.pins.iter_mut().find(|old| old.id == pin.id) {
            if existing.account_id != pin.account_id {
                return Err("A pin ID cannot be reassigned to another account.".into());
            }
            *existing = pin;
        } else {
            self.snapshot.pins.push(pin);
        }
        Ok(self.snapshot())
    }

    pub fn delete_pin(&mut self, id: String) -> Result<Snapshot, String> {
        let index = self
            .snapshot
            .pins
            .iter()
            .position(|pin| pin.id == id)
            .ok_or_else(|| "The pin no longer exists.".to_string())?;
        self.snapshot.pins.remove(index);
        Ok(self.snapshot())
    }

    pub fn dispatch(&mut self, request: DispatchRequest) -> DispatchOutcome {
        let key = (request.account_id.clone(), request.request_id.clone());
        if let Some(recorded) = self.requests.get(&key) {
            return if recorded.request == request {
                recorded.outcome.clone()
            } else {
                DispatchOutcome::rejected("This request ID was already used for another payload.")
            };
        }
        let outcome = if request.request_id.trim().is_empty() || request.request_id.len() > 200 {
            DispatchOutcome::rejected("A dispatch needs a nonempty request ID.")
        } else if let Err(message) = self.validate_request(&request) {
            DispatchOutcome::rejected(message)
        } else if self.uncertain_targets.contains(&Target::from(&request)) {
            DispatchOutcome::uncertain(
                "The previous start for this target is unresolved. Reset the demo before retrying.",
            )
        } else {
            match self.scenario {
                DemoScenario::Offline => DispatchOutcome::rejected(
                    "Offline: the start was not sent. Reconnect before trying again.",
                ),
                DemoScenario::Forbidden => DispatchOutcome::rejected(
                    "Access denied: workflow write permission is required.",
                ),
                DemoScenario::Uncertain => {
                    self.uncertain_targets.insert(Target::from(&request));
                    DispatchOutcome::uncertain(
                        "Simulated connection loss after sending. The outcome is unknown; do not retry.",
                    )
                }
                DemoScenario::Normal => self.create_run(&request),
            }
        };
        self.requests.insert(
            key,
            RecordedRequest {
                request,
                outcome: outcome.clone(),
            },
        );
        outcome
    }

    fn validate_request(&self, request: &DispatchRequest) -> Result<Inputs, String> {
        if !self
            .snapshot
            .accounts
            .iter()
            .any(|account| account.id == request.account_id)
        {
            return Err("Unknown account.".into());
        }
        let repo = self
            .snapshot
            .repos
            .iter()
            .find(|repo| repo.id == request.repo_id && repo.account_id == request.account_id)
            .ok_or_else(|| "Repository does not belong to this account.".to_string())?;
        if !repo.selected {
            return Err("Select this repository before starting a workflow.".into());
        }
        if repo.permission != Permission::Write {
            return Err("Repository write permission is required.".into());
        }
        let workflow = self
            .snapshot
            .workflows
            .iter()
            .find(|workflow| workflow.repo_id == repo.id && workflow.id == request.workflow_id)
            .ok_or_else(|| "Unknown workflow for this repository.".to_string())?;
        // GitHub only dispatches workflows present with workflow_dispatch on the default branch.
        if !workflow.dispatch || !workflow.refs.contains(&repo.default_branch) {
            return Err("Workflow is not dispatchable on the default branch.".into());
        }
        if !workflow.refs.contains(&request.git_ref) {
            return Err("Choose a known branch or tag for this workflow.".into());
        }
        validate_inputs(&workflow.inputs, &request.inputs).map_err(|error| error.to_string())
    }

    fn create_run(&mut self, request: &DispatchRequest) -> DispatchOutcome {
        let workflow = self
            .snapshot
            .workflows
            .iter()
            .find(|workflow| {
                workflow.repo_id == request.repo_id && workflow.id == request.workflow_id
            })
            .expect("dispatch target was validated");
        let run_id = self.next_run_id;
        self.next_run_id += 1;
        let now = Utc::now().to_rfc3339();
        self.snapshot.runs.insert(
            0,
            Run {
                id: run_id,
                repo_id: request.repo_id.clone(),
                workflow_id: request.workflow_id,
                name: workflow.name.clone(),
                branch: request.git_ref.clone(),
                status: RunStatus::Queued,
                conclusion: None,
                created_at: now.clone(),
                updated_at: now.clone(),
                html_url: String::new(),
            },
        );
        self.snapshot.updated_at = now;
        self.simulated_runs.insert(
            run_id,
            SimulatedRun {
                started: Instant::now(),
                initial_status: RunStatus::Queued,
            },
        );
        DispatchOutcome {
            state: DispatchState::Accepted,
            run_id: Some(run_id),
            html_url: None,
            message: "Demo workflow queued locally. No real workflow was started.".into(),
        }
    }

    pub fn set_scenario(&mut self, scenario: String) -> Result<Snapshot, String> {
        self.scenario = scenario.parse()?;
        let (connectivity, message) = match self.scenario {
            DemoScenario::Normal => (Connectivity::Online, DEMO_MESSAGE),
            DemoScenario::Offline => (
                Connectivity::Offline,
                "Offline demo: showing cached data. Workflow starts are disabled.",
            ),
            DemoScenario::Forbidden => (
                Connectivity::Forbidden,
                "Forbidden demo: cached data remains visible; workflow starts are disabled.",
            ),
            DemoScenario::Uncertain => (
                Connectivity::Online,
                "Uncertain demo: the next start simulates a lost response. Retry stays blocked until reset.",
            ),
        };
        self.snapshot.connectivity = connectivity;
        self.snapshot.stale = connectivity != Connectivity::Online;
        self.snapshot.message = Some(message.into());
        Ok(self.snapshot())
    }

    pub fn reset(&mut self) -> Snapshot {
        *self = Self::new();
        self.snapshot()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> DispatchRequest {
        DispatchRequest {
            account_id: "demo-personal".into(),
            repo_id: "demo-personal-kit".into(),
            workflow_id: 101,
            git_ref: "main".into(),
            inputs: Inputs::new(),
            request_id: "start-1".into(),
        }
    }

    #[test]
    fn fixture_round_trips_the_ui_contract() {
        let snapshot = DemoStore::new().snapshot();
        let json = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(json["mode"], "demo");
        assert_eq!(json["repos"][0]["accountId"], "demo-personal");
        assert_eq!(json["pins"][0]["ref"], "main");
        let fixture: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        assert_eq!(json, fixture);
    }

    #[test]
    fn default_branch_presence_is_required_but_tags_can_be_dispatched() {
        let mut store = DemoStore::new();
        let mut tag = request();
        tag.git_ref = "v0.1.0".into();
        assert_eq!(store.dispatch(tag).state, DispatchState::Accepted);
        store.snapshot.workflows[0]
            .refs
            .retain(|git_ref| git_ref != "main");
        let mut next = request();
        next.request_id = "start-2".into();
        next.git_ref = "develop".into();
        assert_eq!(store.dispatch(next).state, DispatchState::Rejected);
    }

    #[test]
    fn double_dispatch_is_idempotent_even_after_refresh() {
        let mut store = DemoStore::new();
        let original_count = store.snapshot.runs.len();
        let outcome = store.dispatch(request());
        assert_eq!(outcome.state, DispatchState::Accepted);
        assert_eq!(store.dispatch(request()), outcome);
        assert_eq!(store.snapshot.runs.len(), original_count + 1);
        let id = outcome.run_id.unwrap();
        let started = store.simulated_runs[&id].started;
        store.refresh_at(started + Duration::from_secs(1));
        assert_eq!(store.snapshot.runs[0].status, RunStatus::InProgress);
        store.refresh_at(started + Duration::from_secs(2));
        assert_eq!(store.snapshot.runs[0].status, RunStatus::Completed);
        assert_eq!(store.snapshot.runs[0].conclusion, Some(Conclusion::Success));
        assert_eq!(store.dispatch(request()), outcome);
        assert_eq!(store.snapshot.runs.len(), original_count + 1);
        let mut altered = request();
        altered.git_ref = "develop".into();
        assert_eq!(store.dispatch(altered).state, DispatchState::Rejected);
    }

    #[test]
    fn checks_unknown_inputs_refs_types_rights_and_selected_repositories() {
        let mut invalid = vec![];
        let mut value = request();
        value
            .inputs
            .insert("surprise".into(), InputValue::Boolean(true));
        invalid.push(value);
        let mut value = request();
        value
            .inputs
            .insert("dry_run".into(), InputValue::String("true".into()));
        invalid.push(value);
        let mut value = request();
        value.git_ref = "unknown".into();
        invalid.push(value);
        let mut value = request();
        value.workflow_id = 102;
        invalid.push(value);
        let mut value = request();
        value.repo_id = "demo-personal-site".into();
        value.workflow_id = 301;
        invalid.push(value);
        let mut value = request();
        value.account_id = "demo-work".into();
        value.repo_id = "demo-extra".into();
        value.workflow_id = 401;
        invalid.push(value);
        let mut value = request();
        value.account_id = "demo-work".into();
        invalid.push(value);
        for request in invalid {
            let mut store = DemoStore::new();
            let count = store.snapshot.runs.len();
            assert_eq!(store.dispatch(request).state, DispatchState::Rejected);
            assert_eq!(store.snapshot.runs.len(), count);
        }
    }

    #[test]
    fn offline_and_forbidden_keep_cache_but_never_create_a_run() {
        for scenario in ["offline", "forbidden"] {
            let mut store = DemoStore::new();
            let runs = store.snapshot.runs.clone();
            store.set_scenario(scenario.into()).unwrap();
            assert!(store.refresh().stale);
            assert_eq!(store.dispatch(request()).state, DispatchState::Rejected);
            assert_eq!(store.snapshot.runs, runs);
        }
    }

    #[test]
    fn uncertain_blocks_new_ids_for_same_target_until_reset_and_is_account_isolated() {
        let mut store = DemoStore::new();
        let count = store.snapshot.runs.len();
        store.set_scenario("uncertain".into()).unwrap();
        let first = store.dispatch(request());
        assert_eq!(first.state, DispatchState::Uncertain);
        store.set_scenario("normal".into()).unwrap();
        let mut second = request();
        second.request_id = "new-id".into();
        assert_eq!(store.dispatch(second).state, DispatchState::Uncertain);
        assert_eq!(store.snapshot.runs.len(), count);
        let mut work = request();
        work.account_id = "demo-work".into();
        work.repo_id = "demo-team-tools".into();
        work.workflow_id = 201;
        assert_eq!(store.dispatch(work).state, DispatchState::Accepted);
        store.reset();
        assert_eq!(store.dispatch(request()).state, DispatchState::Accepted);
    }

    #[test]
    fn pin_defaults_are_validated_and_account_cannot_be_changed() {
        let mut store = DemoStore::new();
        let mut pin = store.snapshot.pins[0].clone();
        pin.inputs.clear();
        store.save_pin(pin.clone()).unwrap();
        assert_eq!(store.snapshot.pins[0].inputs.len(), 3);
        pin.inputs
            .insert("password".into(), InputValue::String("x".into()));
        assert!(store.save_pin(pin).is_err());
        let mut pin = store.snapshot.pins[0].clone();
        pin.account_id = "demo-work".into();
        pin.repo_id = "demo-team-tools".into();
        pin.workflow_id = 201;
        pin.inputs.clear();
        assert!(store.save_pin(pin).is_err());
    }
}
