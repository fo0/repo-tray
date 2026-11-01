use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};

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
    /// Targets whose last start has an unknown outcome; each stays locked until released explicitly.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub uncertain_starts: Vec<UncertainStart>,
}

/// The scope a dispatch claim locks: one workflow on one ref of one account's repository.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchTarget {
    pub account_id: String,
    pub repo_id: String,
    pub workflow_id: u64,
    #[serde(rename = "ref")]
    pub git_ref: String,
}

impl From<&DispatchRequest> for DispatchTarget {
    fn from(request: &DispatchRequest) -> Self {
        Self {
            account_id: request.account_id.clone(),
            repo_id: request.repo_id.clone(),
            workflow_id: request.workflow_id,
            git_ref: request.git_ref.clone(),
        }
    }
}

/// A persisted claim whose start may or may not have reached GitHub.
/// `claimed_at` is `None` only for claims written before claim times were stored.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UncertainStart {
    pub account_id: String,
    pub repo_id: String,
    pub workflow_id: u64,
    #[serde(rename = "ref")]
    pub git_ref: String,
    pub claimed_at: Option<String>,
}

impl UncertainStart {
    pub fn target(&self) -> DispatchTarget {
        DispatchTarget {
            account_id: self.account_id.clone(),
            repo_id: self.repo_id.clone(),
            workflow_id: self.workflow_id,
            git_ref: self.git_ref.clone(),
        }
    }
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

pub const MAX_REQUEST_ID_CHARS: usize = 200;
pub const MAX_PIN_ID_CHARS: usize = 120;
pub const MAX_PIN_LABEL_CHARS: usize = 120;
/// Saved favorites across all accounts; each is one row and one entry in every snapshot.
pub const MAX_PINS: usize = 100;
/// Git's own limit for a ref name, in bytes.
pub const MAX_GIT_REF_BYTES: usize = 255;
/// Dispatch request IDs each store remembers for idempotent retries.
pub const MAX_RECORDED_OUTCOMES: usize = 256;

fn bounded_text(value: &str, max_chars: usize) -> bool {
    !value.trim().is_empty()
        && value.chars().count() <= max_chars
        && !value.chars().any(char::is_control)
}

/// Shared by the demo and live stores so both enforce the same request limits.
pub fn validate_request_id(request_id: &str) -> Result<(), String> {
    if bounded_text(request_id, MAX_REQUEST_ID_CHARS) {
        Ok(())
    } else {
        Err("Start-ID fehlt oder ist zu lang.".into())
    }
}

/// Shared by the demo and live stores for the user-written pin fields.
pub fn validate_pin_fields(pin: &Pin) -> Result<(), String> {
    if !bounded_text(&pin.id, MAX_PIN_ID_CHARS) || !bounded_text(&pin.label, MAX_PIN_LABEL_CHARS) {
        return Err(
            "Ein Favorit braucht eine ID und einen Namen mit höchstens 120 Zeichen.".into(),
        );
    }
    if !valid_git_ref(&pin.git_ref) {
        return Err("Branch oder Tag des Favoriten ist ungültig.".into());
    }
    Ok(())
}

/// Shared by the demo and live stores: a new favorite needs room; replacing one never does.
pub fn check_pin_room(pins: &[Pin], id: &str) -> Result<(), String> {
    if pins.len() >= MAX_PINS && !pins.iter().any(|pin| pin.id == id) {
        return Err(format!(
            "Höchstens {MAX_PINS} Favoriten – entferne zuerst einen anderen."
        ));
    }
    Ok(())
}

/// The essentials of `git check-ref-format` for a branch or tag name: at most 255 bytes, no
/// control characters, whitespace or any of `~^:?*[\`, no `..` or `@{`, not `@`, no leading
/// `-`, no trailing `.`, and no empty component (so no leading, trailing or double `/`) or
/// component that starts with `.` or ends with `.lock`.
pub fn valid_git_ref(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_GIT_REF_BYTES
        && name != "@"
        && !name.starts_with('-')
        && !name.ends_with('.')
        && !name.contains("..")
        && !name.contains("@{")
        && !name
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || "~^:?*[\\".contains(c))
        && name
            .split('/')
            .all(|part| !part.is_empty() && !part.starts_with('.') && !part.ends_with(".lock"))
}

/// Insertion-ordered, bounded map: the oldest entry is evicted once `capacity` is exceeded.
pub struct RecentOutcomes<K, V> {
    entries: BTreeMap<K, V>,
    order: VecDeque<K>,
    capacity: usize,
}

impl<K: Ord + Clone, V> RecentOutcomes<K, V> {
    pub fn new(capacity: usize) -> Self {
        Self {
            entries: BTreeMap::new(),
            order: VecDeque::new(),
            capacity: capacity.max(1),
        }
    }

    pub fn get(&self, key: &K) -> Option<&V> {
        self.entries.get(key)
    }

    pub fn insert(&mut self, key: K, value: V) {
        if self.entries.insert(key.clone(), value).is_none() {
            self.order.push_back(key);
        }
        while self.order.len() > self.capacity {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            }
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pin(id: &str, label: &str) -> Pin {
        Pin {
            id: id.into(),
            label: label.into(),
            account_id: "demo-personal".into(),
            repo_id: "demo-personal-kit".into(),
            workflow_id: 101,
            git_ref: "main".into(),
            inputs: Inputs::new(),
            quick_start: false,
        }
    }

    #[test]
    fn request_ids_and_pin_fields_are_bounded_in_characters() {
        assert!(validate_request_id("start-1").is_ok());
        assert!(validate_request_id(&"x".repeat(MAX_REQUEST_ID_CHARS)).is_ok());
        for invalid in [
            String::new(),
            "  ".into(),
            "x".repeat(MAX_REQUEST_ID_CHARS + 1),
            "line\nbreak".into(),
        ] {
            assert!(validate_request_id(&invalid).is_err());
        }
        let label = "ä".repeat(MAX_PIN_LABEL_CHARS);
        assert!(validate_pin_fields(&pin("pin-1", &label)).is_ok());
        let label = "a".repeat(MAX_PIN_LABEL_CHARS + 1);
        assert!(validate_pin_fields(&pin("pin-1", &label)).is_err());
        let id = "p".repeat(MAX_PIN_ID_CHARS + 1);
        assert!(validate_pin_fields(&pin(&id, "Label")).is_err());
        assert!(validate_pin_fields(&pin(" ", "Label")).is_err());
        assert!(validate_pin_fields(&pin("pin-1", "")).is_err());
    }

    #[test]
    fn pinned_refs_follow_the_git_ref_format_essentials() {
        let longest = "r".repeat(MAX_GIT_REF_BYTES);
        for valid in [
            "main",
            "release/2026.11",
            "v1.0.0",
            "feature/über-ä",
            "refs/heads/main",
            "a@b",
            longest.as_str(),
        ] {
            assert!(valid_git_ref(valid), "{valid}");
        }
        let too_long = "r".repeat(MAX_GIT_REF_BYTES + 1);
        let too_many_bytes = "ä".repeat(MAX_GIT_REF_BYTES / 2 + 1);
        for invalid in [
            "",
            "@",
            "-option",
            "/main",
            "main/",
            "main.",
            "a..b",
            "a//b",
            "a@{1}",
            "has space",
            "tab\there",
            "line\nbreak",
            "del\u{7f}",
            "nbsp\u{a0}x",
            "a~1",
            "a^",
            "a:b",
            "a?",
            "a*",
            "a[b",
            "back\\slash",
            ".hidden",
            "a/.hidden",
            "branch.lock",
            "a.lock/b",
            too_long.as_str(),
            too_many_bytes.as_str(),
        ] {
            assert!(!valid_git_ref(invalid), "{invalid:?}");
        }
        let mut invalid = pin("pin-1", "Label");
        invalid.git_ref = "a..b".into();
        assert_eq!(
            validate_pin_fields(&invalid).unwrap_err(),
            "Branch oder Tag des Favoriten ist ungültig."
        );
    }

    #[test]
    fn a_new_pin_needs_room_but_replacing_one_never_does() {
        let full: Vec<_> = (0..MAX_PINS)
            .map(|index| pin(&format!("pin-{index}"), "Label"))
            .collect();
        assert!(check_pin_room(&full[1..], "pin-new").is_ok());
        assert!(check_pin_room(&full, "pin-new")
            .unwrap_err()
            .contains("100"));
        assert!(check_pin_room(&full, "pin-7").is_ok());
    }

    #[test]
    fn recent_outcomes_evict_the_oldest_entry_and_keep_updates_in_place() {
        let mut outcomes = RecentOutcomes::new(2);
        outcomes.insert("a", 1);
        outcomes.insert("b", 2);
        outcomes.insert("a", 3);
        assert_eq!(outcomes.get(&"a"), Some(&3));
        outcomes.insert("c", 4);
        assert_eq!(outcomes.len(), 2);
        assert_eq!(outcomes.get(&"a"), None);
        assert_eq!(outcomes.get(&"b"), Some(&2));
        assert_eq!(outcomes.get(&"c"), Some(&4));
    }
}
