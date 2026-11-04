//! Bounded metadata parsing only. Workflow YAML is never interpreted or executed.

use crate::i18n::tr;
use crate::models::{InputSpec, InputType, InputValue, Inputs};
use crate::trf;
use serde_yaml_ng::{Mapping, Value};
use std::collections::BTreeSet;
use std::fmt;

mod limits;
use limits::{check_tree, check_yaml_envelope};

pub const MAX_WORKFLOW_BYTES: usize = 64 * 1024;
/// The most inputs a workflow may declare; a favorite never needs to store more.
pub const MAX_INPUTS: usize = 25;
/// Longest input name a workflow may declare; favorites accept the same names.
pub const MAX_INPUT_NAME_BYTES: usize = 128;
/// Longest text value a favorite stores. With `MAX_INPUTS` and worst-case JSON escaping
/// (25 × 8,000 × 6 bytes ≈ 1.2 MB) every favorite stays below the 2 MiB cache entry limit.
pub const MAX_PIN_INPUT_VALUE_CHARS: usize = 8_000;

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
    let document: Value = serde_yaml_ng::from_str(source).map_err(|_| {
        error(tr(
            "Workflow-YAML ist fehlerhaft oder enthält doppelte Schlüssel.",
            "Workflow YAML is malformed or has duplicate keys.",
        ))
    })?;
    check_tree(&document, 0)?;
    let root = document.as_mapping().ok_or_else(|| {
        error(tr(
            "Workflow-YAML hat keine gültige Struktur.",
            "Workflow YAML has no valid structure.",
        ))
    })?;
    let on = field(root, "on").or_else(|| root.get(Value::Bool(true)));
    let dispatch = match on {
        None | Some(Value::Null) => None,
        Some(Value::String(event)) if event == "workflow_dispatch" => Some(&Value::Null),
        Some(Value::String(_)) => None,
        Some(Value::Sequence(events)) => {
            if !events.iter().all(|event| matches!(event, Value::String(_))) {
                return Err(error(tr(
                    "Die Event-Liste unter „on“ darf nur Event-Namen enthalten.",
                    "The event list under “on” may contain only event names.",
                )));
            }
            events
                .iter()
                .any(|event| event.as_str() == Some("workflow_dispatch"))
                .then_some(&Value::Null)
        }
        Some(Value::Mapping(events)) => field(events, "workflow_dispatch"),
        _ => {
            return Err(error(tr(
                "Die Event-Angabe unter „on“ wird nicht unterstützt.",
                "The events under “on” are not supported.",
            )))
        }
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
            return Err(error(tr(
                "„workflow_dispatch“ muss leer sein oder Einstellungen enthalten.",
                "“workflow_dispatch” must be empty or contain settings.",
            )))
        }
    };
    let inputs = match inputs {
        None | Some(Value::Null) => vec![],
        Some(Value::Mapping(inputs)) => parse_specs(inputs)?,
        _ => {
            return Err(error(tr(
                "„inputs“ unter „workflow_dispatch“ muss benannte Eingaben enthalten.",
                "“inputs” under “workflow_dispatch” must contain named inputs.",
            )))
        }
    };
    Ok(ParsedWorkflow {
        dispatch: true,
        inputs,
    })
}

fn parse_specs(inputs: &Mapping) -> Result<Vec<InputSpec>, WorkflowError> {
    if inputs.len() > MAX_INPUTS {
        return Err(error(trf!(
            "Der Workflow hat mehr als {MAX_INPUTS} Eingaben – mehr unterstützt RepoWatch nicht.",
            "The Workflow has more than {MAX_INPUTS} inputs – RepoWatch supports no more."
        )));
    }
    let mut result = Vec::with_capacity(inputs.len());
    for (name, settings) in inputs {
        let name = name
            .as_str()
            .filter(|name| !name.is_empty() && name.len() <= MAX_INPUT_NAME_BYTES)
            .ok_or_else(|| {
                error(trf!(
                    "Eingabenamen müssen Texte mit 1 bis {MAX_INPUT_NAME_BYTES} Zeichen sein.",
                    "Input names must be text of 1 to {MAX_INPUT_NAME_BYTES} characters."
                ))
            })?;
        let label = shown(name);
        let settings = settings.as_mapping().ok_or_else(|| {
            error(trf!(
                "Eingabe „{label}“ ist ungültig deklariert.",
                "Input “{label}” is declared incorrectly."
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
                    return Err(error(trf!(
                        "Eingabe „{label}“ hat einen nicht unterstützten Typ.",
                        "Input “{label}” has an unsupported type."
                    )))
                }
            },
            _ => {
                return Err(error(trf!(
                    "Der Typ von Eingabe „{label}“ muss ein Text sein.",
                    "The type of input “{label}” must be text."
                )))
            }
        };
        let required = match field(settings, "required") {
            None => false,
            Some(Value::Bool(required)) => *required,
            _ => {
                return Err(error(trf!(
                    "„required“ von Eingabe „{label}“ muss true oder false sein.",
                    "“required” of input “{label}” must be true or false."
                )))
            }
        };
        let description = match field(settings, "description") {
            None | Some(Value::Null) => name.to_owned(),
            Some(Value::String(description)) => description.clone(),
            _ => {
                return Err(error(trf!(
                    "Die Beschreibung von Eingabe „{label}“ muss ein Text sein.",
                    "The description of input “{label}” must be text."
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
                            error(trf!(
                                "Die Optionen von Eingabe „{label}“ müssen nicht leere Texte sein.",
                                "The options of input “{label}” must be non-empty text."
                            ))
                        })
                })
                .collect::<Result<Vec<_>, _>>()?,
            _ => {
                return Err(error(trf!(
                    "Eingabe „{label}“: Optionen sind nur als Liste bei Typ „choice“ erlaubt.",
                    "Input “{label}”: options are allowed only as a list with type “choice”."
                )))
            }
        };
        if input_type == InputType::Choice
            && (options.is_empty()
                || options.iter().collect::<BTreeSet<_>>().len() != options.len())
        {
            return Err(error(trf!(
                "Eingabe „{label}“ braucht mindestens eine Option und keine doppelten.",
                "Input “{label}” needs at least one option and no duplicates."
            )));
        }
        let default = field(settings, "default")
            .map(|value| {
                serde_yaml_ng::from_value::<InputValue>(value.clone()).map_err(|_| {
                    error(trf!(
                        "Der Standardwert von Eingabe „{label}“ muss Text, Zahl oder true/false sein.",
                        "The default of input “{label}” must be text, a number or true/false."
                    ))
                })
            })
            .transpose()?;
        let spec = InputSpec {
            name: name.into(),
            label: description,
            r#type: input_type,
            required,
            default,
            options,
            note: None,
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
        return Err(error(tr(
            "Der Workflow enthält doppelte Eingabenamen.",
            "The Workflow has duplicate input names.",
        )));
    }
    if let Some(name) = supplied.keys().find(|name| !names.contains(name.as_str())) {
        let name = shown(name);
        return Err(error(trf!(
            "Der Workflow kennt die Eingabe „{name}“ nicht (mehr).",
            "The Workflow does not know the input “{name}” (any more)."
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
                let name = shown(&spec.name);
                return Err(error(trf!(
                    "Pflichtfeld „{name}“ fehlt.",
                    "Required field “{name}” is missing."
                )));
            }
            None => {}
        }
    }
    Ok(normalized)
}

fn validate_value(spec: &InputSpec, value: &InputValue) -> Result<(), WorkflowError> {
    let name = shown(&spec.name);
    // An input without a choice right now (such as a cut-off environment list) takes no
    // value: a guessed one could start the workflow somewhere unintended. The workflow
    // author's own default is not a guess, so it stays startable.
    if let Some(note) = &spec.note {
        if !value.is_empty() && spec.default.as_ref() != Some(value) {
            return Err(error(format!("„{name}“: {note}")));
        }
    }
    let expected = match (spec.r#type, value) {
        (InputType::Boolean, InputValue::Boolean(_))
        | (InputType::Number, InputValue::Number(_))
        | (InputType::String | InputType::Environment, InputValue::String(_)) => None,
        (InputType::Choice, InputValue::String(value)) if spec.options.contains(value) => None,
        (InputType::Choice, InputValue::String(_)) => {
            return Err(error(trf!(
                "Der Wert von „{name}“ ist keine der erlaubten Optionen.",
                "The value of “{name}” is not one of the allowed options."
            )))
        }
        (InputType::Boolean, _) => Some(tr("true oder false", "true or false")),
        (InputType::Number, _) => Some(tr("eine Zahl", "a number")),
        (InputType::String | InputType::Environment, _) => Some(tr("einen Text", "text")),
        (InputType::Choice, _) => Some(tr("eine der Optionen", "one of the options")),
    };
    if let Some(expected) = expected {
        return Err(error(trf!(
            "Eingabe „{name}“ erwartet {expected}.",
            "Input “{name}” expects {expected}."
        )));
    }
    if spec.required && value.is_empty() {
        return Err(error(trf!(
            "Pflichtfeld „{name}“ darf nicht leer sein.",
            "Required field “{name}” must not be empty."
        )));
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

/// A favorite's inputs arrive over IPC unchecked against any workflow, so they are bounded
/// here before they reach the cache.
pub fn validate_pin_inputs(inputs: &Inputs) -> Result<(), WorkflowError> {
    if inputs.len() > MAX_INPUTS {
        return Err(error(trf!(
            "Ein Favorit speichert höchstens {MAX_INPUTS} Eingaben.",
            "A favorite stores at most {MAX_INPUTS} inputs."
        )));
    }
    if inputs.keys().any(|name| name.len() > MAX_INPUT_NAME_BYTES) {
        return Err(error(trf!(
            "Eingabenamen eines Favoriten dürfen höchstens {MAX_INPUT_NAME_BYTES} Zeichen lang sein.",
            "A favorite's input names may be at most {MAX_INPUT_NAME_BYTES} characters long."
        )));
    }
    if inputs.values().any(|value| {
        matches!(value, InputValue::String(text) if text.chars().count() > MAX_PIN_INPUT_VALUE_CHARS)
    }) {
        return Err(error(trf!(
            "Eingabewerte eines Favoriten dürfen höchstens {MAX_PIN_INPUT_VALUE_CHARS} Zeichen lang sein.",
            "A favorite's input values may be at most {MAX_PIN_INPUT_VALUE_CHARS} characters long."
        )));
    }
    Ok(())
}

/// Pins and cache are public preferences; secret-looking fields/values never enter them.
pub fn validate_non_secret_inputs(inputs: &Inputs) -> Result<(), WorkflowError> {
    if inputs.iter().any(|(name, value)| {
        sensitive_key(name)
            || matches!(value, InputValue::String(value) if looks_like_credential(value))
    }) {
        return Err(error(tr(
            "Geheime Eingaben wie Token oder Passwörter können nicht in Favoriten gespeichert werden.",
            "Secret inputs such as Tokens or passwords cannot be saved in favorites.",
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
