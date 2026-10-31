use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum InputValue {
    String(String),
    Number(serde_json::Number),
    Boolean(bool),
}

impl InputValue {
    pub fn is_empty(&self) -> bool {
        matches!(self, Self::String(value) if value.trim().is_empty())
    }
}

pub type Inputs = BTreeMap<String, InputValue>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub login: String,
    pub label: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Permission {
    Write,
    Read,
    Denied,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    pub id: String,
    pub account_id: String,
    pub owner: String,
    pub name: String,
    pub default_branch: String,
    pub selected: bool,
    pub permission: Permission,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InputType {
    String,
    Boolean,
    Choice,
    Number,
    Environment,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputSpec {
    pub name: String,
    pub label: String,
    pub r#type: InputType,
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<InputValue>,
    #[serde(default)]
    pub options: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub id: u64,
    pub repo_id: String,
    pub name: String,
    pub path: String,
    pub dispatch: bool,
    pub inputs: Vec<InputSpec>,
    pub refs: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Queued,
    InProgress,
    Completed,
    Waiting,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Conclusion {
    Success,
    Failure,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: u64,
    pub repo_id: String,
    pub workflow_id: u64,
    pub name: String,
    pub branch: String,
    pub status: RunStatus,
    pub conclusion: Option<Conclusion>,
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pin {
    pub id: String,
    pub label: String,
    pub account_id: String,
    pub repo_id: String,
    pub workflow_id: u64,
    #[serde(rename = "ref")]
    pub git_ref: String,
    pub inputs: Inputs,
    pub quick_start: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Demo,
    Live,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Connectivity {
    Online,
    Offline,
    Forbidden,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub accounts: Vec<Account>,
    pub repos: Vec<Repo>,
    pub workflows: Vec<Workflow>,
    pub runs: Vec<Run>,
    pub pins: Vec<Pin>,
    pub mode: Mode,
    pub connectivity: Connectivity,
    pub updated_at: String,
    pub stale: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchRequest {
    pub account_id: String,
    pub repo_id: String,
    pub workflow_id: u64,
    #[serde(rename = "ref")]
    pub git_ref: String,
    pub inputs: Inputs,
    pub request_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DispatchState {
    Accepted,
    Uncertain,
    Rejected,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchOutcome {
    pub state: DispatchState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html_url: Option<String>,
    pub message: String,
}

impl DispatchOutcome {
    pub fn rejected(message: impl Into<String>) -> Self {
        Self {
            state: DispatchState::Rejected,
            run_id: None,
            html_url: None,
            message: message.into(),
        }
    }

    pub fn uncertain(message: impl Into<String>) -> Self {
        Self {
            state: DispatchState::Uncertain,
            run_id: None,
            html_url: None,
            message: message.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DemoScenario {
    #[default]
    Normal,
    Offline,
    Forbidden,
    Uncertain,
}

impl std::str::FromStr for DemoScenario {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "normal" => Ok(Self::Normal),
            "offline" => Ok(Self::Offline),
            "forbidden" => Ok(Self::Forbidden),
            "uncertain" => Ok(Self::Uncertain),
            _ => Err("Unknown demo scenario.".into()),
        }
    }
}
