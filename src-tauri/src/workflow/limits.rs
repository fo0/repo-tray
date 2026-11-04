//! Structural limits checked before and after YAML parsing: size, nesting depth, anchors,
//! aliases and tags. Workflow YAML is never interpreted beyond these checks.

use super::{error, WorkflowError, MAX_WORKFLOW_BYTES};
use crate::i18n::tr;
use serde_yaml_ng::Value;

const MAX_YAML_DEPTH: usize = 48;

fn too_deep() -> WorkflowError {
    error(tr(
        "Workflow-YAML ist zu tief verschachtelt.",
        "Workflow YAML is nested too deeply.",
    ))
}

fn tags_unsupported() -> WorkflowError {
    error(tr(
        "YAML-Tags werden nicht unterstützt.",
        "YAML tags are not supported.",
    ))
}

pub(super) fn check_yaml_envelope(source: &str) -> Result<(), WorkflowError> {
    if source.len() > MAX_WORKFLOW_BYTES {
        return Err(error(tr(
            "Workflow-YAML ist größer als 64 KiB.",
            "Workflow YAML is larger than 64 KiB.",
        )));
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
            return Err(too_deep());
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
                return Err(error(tr(
                    "YAML-Anker und -Aliase werden nicht unterstützt.",
                    "YAML anchors and aliases are not supported.",
                )));
            }
            if node_start && byte == b'!' {
                return Err(tags_unsupported());
            }
            if node_start && (byte == b'|' || byte == b'>') {
                block_indent = Some(indentation);
                break;
            }
            if node_start && (byte == b'[' || byte == b'{') {
                flow_depth += 1;
                if flow_depth > MAX_YAML_DEPTH {
                    return Err(too_deep());
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

pub(super) fn check_tree(value: &Value, depth: usize) -> Result<(), WorkflowError> {
    if depth > MAX_YAML_DEPTH {
        return Err(too_deep());
    }
    match value {
        Value::Tagged(_) => Err(tags_unsupported()),
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
