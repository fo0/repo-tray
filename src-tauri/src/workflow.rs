//! Bounded metadata parsing only. Workflow YAML is never interpreted or executed.

use crate::models::{InputSpec, InputType, InputValue, Inputs};
use serde_yaml_ng::{Mapping, Value};
use std::collections::BTreeSet;
use std::fmt;

pub const MAX_WORKFLOW_BYTES: usize = 64 * 1024;
const MAX_INPUTS: usize = 25;
const MAX_YAML_DEPTH: usize = 48;

#[derive(Clone, Debug, PartialEq)]
pub struct ParsedWorkflow {
    pub dispatch: bool,
    pub inputs: Vec<InputSpec>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkflowError(pub String);

impl fmt::Display for WorkflowError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for WorkflowError {}

fn error(message: impl Into<String>) -> WorkflowError {
    WorkflowError(message.into())
}

fn field<'a>(mapping: &'a Mapping, name: &str) -> Option<&'a Value> {
    mapping.get(Value::String(name.into()))
}

/// Accept GitHub's scalar, event-list, and event-map forms of `on`.
/// Also recognize boolean `true` as a key from YAML 1.1 producers that coerce `on`.
pub fn parse_workflow_yaml(source: &str) -> Result<ParsedWorkflow, WorkflowError> {
    check_yaml_envelope(source)?;
    let document: Value = serde_yaml_ng::from_str(source)
        .map_err(|_| error("Workflow YAML is malformed or contains duplicate keys."))?;
    check_tree(&document, 0)?;
    let root = document
        .as_mapping()
        .ok_or_else(|| error("A workflow must be a YAML mapping."))?;
    let on = field(root, "on").or_else(|| root.get(Value::Bool(true)));
    let dispatch = match on {
        None | Some(Value::Null) => None,
        Some(Value::String(event)) if event == "workflow_dispatch" => Some(&Value::Null),
        Some(Value::String(_)) => None,
        Some(Value::Sequence(events)) => {
            if !events.iter().all(|event| matches!(event, Value::String(_))) {
                return Err(error("Workflow event lists must contain strings."));
            }
            events
                .iter()
                .any(|event| event.as_str() == Some("workflow_dispatch"))
                .then_some(&Value::Null)
        }
        Some(Value::Mapping(events)) => field(events, "workflow_dispatch"),
        _ => return Err(error("Unsupported workflow event declaration.")),
    };
    let Some(dispatch) = dispatch else {
        return Ok(ParsedWorkflow {
            dispatch: false,
            inputs: vec![],
        });
    };
    let inputs = match dispatch {
        Value::Null => None,
        Value::Mapping(settings) => field(settings, "inputs"),
        _ => return Err(error("workflow_dispatch must be a mapping or empty.")),
    };
    let inputs = match inputs {
        None | Some(Value::Null) => vec![],
        Some(Value::Mapping(inputs)) => parse_specs(inputs)?,
        _ => return Err(error("Workflow inputs must be a mapping.")),
    };
    Ok(ParsedWorkflow {
        dispatch: true,
        inputs,
    })
}

fn parse_specs(inputs: &Mapping) -> Result<Vec<InputSpec>, WorkflowError> {
    if inputs.len() > MAX_INPUTS {
        return Err(error(
            "Workflow input count exceeds the local safety limit.",
        ));
    }
    let mut result = Vec::with_capacity(inputs.len());
    for (name, settings) in inputs {
        let name = name
            .as_str()
            .filter(|name| !name.is_empty() && name.len() <= 128)
            .ok_or_else(|| error("Workflow input names must be short strings."))?;
        let settings = settings
            .as_mapping()
            .ok_or_else(|| error("Each workflow input must be a mapping."))?;
        let input_type = match field(settings, "type") {
            None => InputType::String,
            Some(Value::String(kind)) => match kind.as_str() {
                "string" => InputType::String,
                "boolean" => InputType::Boolean,
                "choice" => InputType::Choice,
                "number" => InputType::Number,
                "environment" => InputType::Environment,
                _ => return Err(error("Unsupported workflow input type.")),
            },
            _ => return Err(error("Input types must be strings.")),
        };
        let required = match field(settings, "required") {
            None => false,
            Some(Value::Bool(required)) => *required,
            _ => return Err(error("Input required flags must be booleans.")),
        };
        let label = match field(settings, "description") {
            None | Some(Value::Null) => name.to_owned(),
            Some(Value::String(description)) => description.clone(),
            _ => return Err(error("Input descriptions must be strings.")),
        };
        let options = match field(settings, "options") {
            None | Some(Value::Null) => vec![],
            Some(Value::Sequence(values)) if input_type == InputType::Choice => values
                .iter()
                .map(|value| {
                    value
                        .as_str()
                        .filter(|value| !value.is_empty())
                        .map(str::to_owned)
                        .ok_or_else(|| error("Choice options must be nonempty strings."))
                })
                .collect::<Result<Vec<_>, _>>()?,
            _ => return Err(error("Only choice inputs may declare string options.")),
        };
        if input_type == InputType::Choice
            && (options.is_empty()
                || options.iter().collect::<BTreeSet<_>>().len() != options.len())
        {
            return Err(error("Choice inputs need distinct options."));
        }
        let default = field(settings, "default")
            .map(|value| {
                serde_yaml_ng::from_value::<InputValue>(value.clone())
                    .map_err(|_| error("Input defaults must be strings, numbers, or booleans."))
            })
            .transpose()?;
        let spec = InputSpec {
            name: name.into(),
            label,
            r#type: input_type,
            required,
            default,
            options,
        };
        if let Some(default) = &spec.default {
            validate_value(&spec, default)?;
        }
        result.push(spec);
    }
    Ok(result)
}

/// Validate types before dispatch and fill declared defaults. Never coerce booleans/numbers.
pub fn validate_inputs(specs: &[InputSpec], supplied: &Inputs) -> Result<Inputs, WorkflowError> {
    let names: BTreeSet<_> = specs.iter().map(|spec| spec.name.as_str()).collect();
    if names.len() != specs.len() {
        return Err(error("Workflow contains duplicate input names."));
    }
    if supplied.keys().any(|name| !names.contains(name.as_str())) {
        return Err(error("An unknown workflow input was supplied."));
    }
    let mut normalized = Inputs::new();
    for spec in specs {
        let value = supplied.get(&spec.name).or(spec.default.as_ref());
        match value {
            Some(value) => {
                validate_value(spec, value)?;
                normalized.insert(spec.name.clone(), value.clone());
            }
            None if spec.required => return Err(error("A required workflow input is missing.")),
            None => {}
        }
    }
    Ok(normalized)
}

fn validate_value(spec: &InputSpec, value: &InputValue) -> Result<(), WorkflowError> {
    let valid = match (spec.r#type, value) {
        (InputType::Boolean, InputValue::Boolean(_)) => true,
        (InputType::Number, InputValue::Number(_)) => true,
        (InputType::String | InputType::Environment, InputValue::String(_)) => true,
        (InputType::Choice, InputValue::String(value)) => spec.options.contains(value),
        _ => false,
    };
    if !valid {
        return Err(error(
            "A workflow input has the wrong type or choice value.",
        ));
    }
    if spec.required && value.is_empty() {
        return Err(error("A required workflow input must not be empty."));
    }
    Ok(())
}

pub fn sensitive_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    [
        "token",
        "password",
        "passwd",
        "secret",
        "credential",
        "authorization",
        "apikey",
        "privatekey",
        "accesskey",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

pub fn looks_like_credential(value: &str) -> bool {
    let value = value.trim();
    ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"]
        .iter()
        .any(|prefix| value.starts_with(prefix))
        || value.contains("-----BEGIN PRIVATE KEY-----")
        || value.contains("-----BEGIN RSA PRIVATE KEY-----")
        || value.to_ascii_lowercase().starts_with("bearer ")
}

/// Pins and cache are public preferences; secret-looking fields/values never enter them.
pub fn validate_non_secret_inputs(inputs: &Inputs) -> Result<(), WorkflowError> {
    if inputs.iter().any(|(name, value)| {
        sensitive_key(name)
            || matches!(value, InputValue::String(value) if looks_like_credential(value))
    }) {
        return Err(error(
            "Secret inputs cannot be saved in pins or the local cache.",
        ));
    }
    Ok(())
}

fn check_yaml_envelope(source: &str) -> Result<(), WorkflowError> {
    if source.len() > MAX_WORKFLOW_BYTES {
        return Err(error("Workflow YAML exceeds the 64 KiB safety limit."));
    }
    let mut block_indent = None;
    let mut flow_depth = 0usize;
    let mut single = false;
    let mut double = false;
    let mut escaped = false;
    for line in source.lines() {
        let indentation = line.bytes().take_while(|byte| *byte == b' ').count();
        if line.trim().is_empty() {
            continue;
        }
        if let Some(block) = block_indent {
            if indentation > block {
                continue;
            }
            block_indent = None;
        }
        if !single && !double && (indentation > MAX_YAML_DEPTH * 2 || line.starts_with('\t')) {
            return Err(error("Workflow YAML nesting exceeds the safety limit."));
        }
        let mut node_start = true;
        let bytes = line.as_bytes();
        for (index, byte) in bytes.iter().copied().enumerate() {
            if double && escaped {
                escaped = false;
                continue;
            }
            if double && byte == b'\\' {
                escaped = true;
                continue;
            }
            if double {
                if byte == b'"' {
                    double = false;
                }
                continue;
            }
            if single {
                if byte == b'\'' {
                    single = false;
                }
                continue;
            }
            if node_start && (byte == b'"' || byte == b'\'') {
                double = byte == b'"';
                single = byte == b'\'';
                node_start = false;
                continue;
            }
            let boundary = index == 0
                || bytes[index - 1].is_ascii_whitespace()
                || b"[{,:-".contains(&bytes[index - 1]);
            if byte == b'#' && boundary {
                break;
            }
            if node_start && (byte == b'&' || byte == b'*') {
                return Err(error("YAML anchors and aliases are disabled."));
            }
            if node_start && byte == b'!' {
                return Err(error("Explicit YAML tags are disabled."));
            }
            if node_start && (byte == b'|' || byte == b'>') {
                block_indent = Some(indentation);
                break;
            }
            if node_start && (byte == b'[' || byte == b'{') {
                flow_depth += 1;
                if flow_depth > MAX_YAML_DEPTH {
                    return Err(error("Workflow YAML nesting exceeds the safety limit."));
                }
            } else if flow_depth > 0 && (byte == b']' || byte == b'}') {
                flow_depth = flow_depth.saturating_sub(1);
                node_start = false;
            } else if byte == b':'
                && (flow_depth > 0 || bytes.get(index + 1).is_none_or(u8::is_ascii_whitespace))
                || byte == b',' && flow_depth > 0
            {
                node_start = true;
            } else if node_start
                && (byte == b'-' || byte == b'?')
                && bytes.get(index + 1).is_some_and(u8::is_ascii_whitespace)
            {
                // A block sequence or explicit-key indicator precedes another node.
            } else if !byte.is_ascii_whitespace() {
                node_start = false;
            }
        }
    }
    Ok(())
}

fn check_tree(value: &Value, depth: usize) -> Result<(), WorkflowError> {
    if depth > MAX_YAML_DEPTH {
        return Err(error("Workflow YAML nesting exceeds the safety limit."));
    }
    match value {
        Value::Tagged(_) => Err(error("Custom YAML tags are disabled.")),
        Value::Sequence(values) => values
            .iter()
            .try_for_each(|value| check_tree(value, depth + 1)),
        Value::Mapping(values) => values.iter().try_for_each(|(key, value)| {
            check_tree(key, depth + 1)?;
            check_tree(value, depth + 1)
        }),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_event_forms_and_yaml_on_semantics() {
        for source in [
            "on: workflow_dispatch",
            "on: [push, workflow_dispatch]",
            "on:\n  workflow_dispatch:",
            "'on': {workflow_dispatch: {}}",
            "true: {workflow_dispatch: {}}",
        ] {
            assert!(parse_workflow_yaml(source).unwrap().dispatch);
        }
        assert!(
            !parse_workflow_yaml("on: [push, pull_request]")
                .unwrap()
                .dispatch
        );
    }

    #[test]
    fn parses_all_typed_inputs_and_keeps_false_and_zero() {
        let source = "on:\n  workflow_dispatch:\n    inputs:\n      flag: {type: boolean, default: false, required: true}\n      count: {type: number, default: 0}\n      target: {type: choice, options: [linux, windows], default: linux}\n      env: {type: environment, required: true}\n      label: {type: string, default: hello}\njobs:\n  safe:\n    steps:\n      - run: |\n          echo *not_an_alias\n          echo &not_an_anchor\n";
        let workflow = parse_workflow_yaml(source).unwrap();
        assert_eq!(workflow.inputs.len(), 5);
        let mut values = Inputs::new();
        values.insert("env".into(), InputValue::String("staging".into()));
        let normalized = validate_inputs(&workflow.inputs, &values).unwrap();
        assert_eq!(normalized["flag"], InputValue::Boolean(false));
        assert_eq!(normalized["count"], InputValue::Number(0.into()));
    }

    #[test]
    fn rejects_aliases_tags_oversize_and_deep_documents() {
        for source in [
            "on: &event workflow_dispatch\ncopy: *event",
            "on: &-event workflow_dispatch\ncopy: *-event",
            "on: &évent workflow_dispatch\ncopy: *évent",
            "on: !!str workflow_dispatch",
            "on: [workflow_dispatch, *unknown]",
        ] {
            assert!(parse_workflow_yaml(source).is_err(), "{source}");
        }
        assert!(parse_workflow_yaml(&"x".repeat(MAX_WORKFLOW_BYTES + 1)).is_err());
        assert!(
            parse_workflow_yaml(&format!("on: {}0{}", "[".repeat(100), "]".repeat(100))).is_err()
        );
    }

    #[test]
    fn rejects_unknown_inputs_wrong_types_missing_required_and_invalid_choices() {
        let parsed = parse_workflow_yaml("on:\n  workflow_dispatch:\n    inputs:\n      flag: {type: boolean, required: true}\n      target: {type: choice, options: [linux, windows]}\n").unwrap();
        assert!(validate_inputs(&parsed.inputs, &Inputs::new()).is_err());
        for supplied in [
            serde_json::json!({"flag": "true"}),
            serde_json::json!({"flag": true, "unknown": "x"}),
            serde_json::json!({"flag": true, "target": "macos"}),
        ] {
            let supplied: Inputs = serde_json::from_value(supplied).unwrap();
            assert!(validate_inputs(&parsed.inputs, &supplied).is_err());
        }
        assert!(parse_workflow_yaml(
            "on: {workflow_dispatch: {inputs: {x: {type: boolean, default: 'false'}}}}"
        )
        .is_err());
    }

    #[test]
    fn shell_characters_in_plain_and_quoted_strings_are_only_metadata() {
        let source = "on: workflow_dispatch\njobs:\n  sample:\n    steps:\n      - run: echo foo && echo *glob\n      - run: 'echo &anchor *alias'\n      - run: \"echo !tag\"\n";
        assert!(parse_workflow_yaml(source).unwrap().dispatch);
    }

    #[test]
    fn secret_detection_covers_case_separators_and_token_values() {
        for key in [
            "token",
            "GitHubToken",
            "api_key",
            "client-secret",
            "PASSWORD",
        ] {
            let values = Inputs::from([(key.into(), InputValue::String("hidden".into()))]);
            assert!(validate_non_secret_inputs(&values).is_err());
        }
        let values = Inputs::from([("version".into(), InputValue::String("ghp_example".into()))]);
        assert!(validate_non_secret_inputs(&values).is_err());
    }
}
