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

/// An input name as messages show it: no control characters, at most 64 characters.
fn shown(name: &str) -> String {
    let mut shown: String = name.chars().filter(|c| !c.is_control()).take(64).collect();
    if name.chars().count() > 64 {
        shown.push('…');
    }
    shown
}

fn field<'a>(mapping: &'a Mapping, name: &str) -> Option<&'a Value> {
    mapping.get(Value::String(name.into()))
}

/// Accept GitHub's scalar, event-list, and event-map forms of `on`.
/// Also recognize boolean `true` as a key from YAML 1.1 producers that coerce `on`.
pub fn parse_workflow_yaml(source: &str) -> Result<ParsedWorkflow, WorkflowError> {
    check_yaml_envelope(source)?;
    let document: Value = serde_yaml_ng::from_str(source)
        .map_err(|_| error("Workflow-YAML ist fehlerhaft oder enthält doppelte Schlüssel."))?;
    check_tree(&document, 0)?;
    let root = document
        .as_mapping()
        .ok_or_else(|| error("Workflow-YAML hat keine gültige Struktur."))?;
    let on = field(root, "on").or_else(|| root.get(Value::Bool(true)));
    let dispatch = match on {
        None | Some(Value::Null) => None,
        Some(Value::String(event)) if event == "workflow_dispatch" => Some(&Value::Null),
        Some(Value::String(_)) => None,
        Some(Value::Sequence(events)) => {
            if !events.iter().all(|event| matches!(event, Value::String(_))) {
                return Err(error(
                    "Die Event-Liste unter „on“ darf nur Event-Namen enthalten.",
                ));
            }
            events
                .iter()
                .any(|event| event.as_str() == Some("workflow_dispatch"))
                .then_some(&Value::Null)
        }
        Some(Value::Mapping(events)) => field(events, "workflow_dispatch"),
        _ => return Err(error("Die Event-Angabe unter „on“ wird nicht unterstützt.")),
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
        _ => {
            return Err(error(
                "„workflow_dispatch“ muss leer sein oder Einstellungen enthalten.",
            ))
        }
    };
    let inputs = match inputs {
        None | Some(Value::Null) => vec![],
        Some(Value::Mapping(inputs)) => parse_specs(inputs)?,
        _ => {
            return Err(error(
                "„inputs“ unter „workflow_dispatch“ muss benannte Eingaben enthalten.",
            ))
        }
    };
    Ok(ParsedWorkflow {
        dispatch: true,
        inputs,
    })
}

fn parse_specs(inputs: &Mapping) -> Result<Vec<InputSpec>, WorkflowError> {
    if inputs.len() > MAX_INPUTS {
        return Err(error(format!(
            "Der Workflow hat mehr als {MAX_INPUTS} Eingaben – mehr unterstützt RepoTray nicht."
        )));
    }
    let mut result = Vec::with_capacity(inputs.len());
    for (name, settings) in inputs {
        let name = name
            .as_str()
            .filter(|name| !name.is_empty() && name.len() <= 128)
            .ok_or_else(|| error("Eingabenamen müssen Texte mit 1 bis 128 Zeichen sein."))?;
        let settings = settings.as_mapping().ok_or_else(|| {
            error(format!(
                "Eingabe „{}“ ist ungültig deklariert.",
                shown(name)
            ))
        })?;
        let input_type = match field(settings, "type") {
            None => InputType::String,
            Some(Value::String(kind)) => match kind.as_str() {
                "string" => InputType::String,
                "boolean" => InputType::Boolean,
                "choice" => InputType::Choice,
                "number" => InputType::Number,
                "environment" => InputType::Environment,
                _ => {
                    return Err(error(format!(
                        "Eingabe „{}“ hat einen nicht unterstützten Typ.",
                        shown(name)
                    )))
                }
            },
            _ => {
                return Err(error(format!(
                    "Der Typ von Eingabe „{}“ muss ein Text sein.",
                    shown(name)
                )))
            }
        };
        let required = match field(settings, "required") {
            None => false,
            Some(Value::Bool(required)) => *required,
            _ => {
                return Err(error(format!(
                    "„required“ von Eingabe „{}“ muss true oder false sein.",
                    shown(name)
                )))
            }
        };
        let label = match field(settings, "description") {
            None | Some(Value::Null) => name.to_owned(),
            Some(Value::String(description)) => description.clone(),
            _ => {
                return Err(error(format!(
                    "Die Beschreibung von Eingabe „{}“ muss ein Text sein.",
                    shown(name)
                )))
            }
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
                        .ok_or_else(|| {
                            error(format!(
                                "Die Optionen von Eingabe „{}“ müssen nicht leere Texte sein.",
                                shown(name)
                            ))
                        })
                })
                .collect::<Result<Vec<_>, _>>()?,
            _ => {
                return Err(error(format!(
                    "Eingabe „{}“: Optionen sind nur als Liste bei Typ „choice“ erlaubt.",
                    shown(name)
                )))
            }
        };
        if input_type == InputType::Choice
            && (options.is_empty()
                || options.iter().collect::<BTreeSet<_>>().len() != options.len())
        {
            return Err(error(format!(
                "Eingabe „{}“ braucht mindestens eine Option und keine doppelten.",
                shown(name)
            )));
        }
        let default = field(settings, "default")
            .map(|value| {
                serde_yaml_ng::from_value::<InputValue>(value.clone()).map_err(|_| {
                    error(format!(
                        "Der Standardwert von Eingabe „{}“ muss Text, Zahl oder true/false sein.",
                        shown(name)
                    ))
                })
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
        return Err(error("Der Workflow enthält doppelte Eingabenamen."));
    }
    if let Some(name) = supplied.keys().find(|name| !names.contains(name.as_str())) {
        return Err(error(format!(
            "Der Workflow kennt die Eingabe „{}“ nicht (mehr).",
            shown(name)
        )));
    }
    let mut normalized = Inputs::new();
    for spec in specs {
        let value = supplied.get(&spec.name).or(spec.default.as_ref());
        match value {
            Some(value) => {
                validate_value(spec, value)?;
                normalized.insert(spec.name.clone(), value.clone());
            }
            None if spec.required => {
                return Err(error(format!("Pflichtfeld „{}“ fehlt.", shown(&spec.name))))
            }
            None => {}
        }
    }
    Ok(normalized)
}

fn validate_value(spec: &InputSpec, value: &InputValue) -> Result<(), WorkflowError> {
    let name = shown(&spec.name);
    let expected = match (spec.r#type, value) {
        (InputType::Boolean, InputValue::Boolean(_))
        | (InputType::Number, InputValue::Number(_))
        | (InputType::String | InputType::Environment, InputValue::String(_)) => None,
        (InputType::Choice, InputValue::String(value)) if spec.options.contains(value) => None,
        (InputType::Choice, InputValue::String(_)) => {
            return Err(error(format!(
                "Der Wert von „{name}“ ist keine der erlaubten Optionen."
            )))
        }
        (InputType::Boolean, _) => Some("true oder false"),
        (InputType::Number, _) => Some("eine Zahl"),
        (InputType::String | InputType::Environment, _) => Some("einen Text"),
        (InputType::Choice, _) => Some("eine der Optionen"),
    };
    if let Some(expected) = expected {
        return Err(error(format!("Eingabe „{name}“ erwartet {expected}.")));
    }
    if spec.required && value.is_empty() {
        return Err(error(format!("Pflichtfeld „{name}“ darf nicht leer sein.")));
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
            "Geheime Eingaben wie Token oder Passwörter können nicht in Favoriten gespeichert werden.",
        ));
    }
    Ok(())
}

fn check_yaml_envelope(source: &str) -> Result<(), WorkflowError> {
    if source.len() > MAX_WORKFLOW_BYTES {
        return Err(error("Workflow-YAML ist größer als 64 KiB."));
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
            return Err(error("Workflow-YAML ist zu tief verschachtelt."));
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
                return Err(error("YAML-Anker und -Aliase werden nicht unterstützt."));
            }
            if node_start && byte == b'!' {
                return Err(error("YAML-Tags werden nicht unterstützt."));
            }
            if node_start && (byte == b'|' || byte == b'>') {
                block_indent = Some(indentation);
                break;
            }
            if node_start && (byte == b'[' || byte == b'{') {
                flow_depth += 1;
                if flow_depth > MAX_YAML_DEPTH {
                    return Err(error("Workflow-YAML ist zu tief verschachtelt."));
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
        return Err(error("Workflow-YAML ist zu tief verschachtelt."));
    }
    match value {
        Value::Tagged(_) => Err(error("YAML-Tags werden nicht unterstützt.")),
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
mod tests;
