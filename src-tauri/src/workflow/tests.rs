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
    assert!(parse_workflow_yaml(&format!("on: {}0{}", "[".repeat(100), "]".repeat(100))).is_err());
}

#[test]
fn rejects_unknown_inputs_wrong_types_missing_required_and_invalid_choices() {
    let parsed = parse_workflow_yaml("on:\n  workflow_dispatch:\n    inputs:\n      flag: {type: boolean, required: true}\n      target: {type: choice, options: [linux, windows]}\n      note: {type: string, required: true, default: x}\n").unwrap();
    assert_eq!(
        validate_inputs(&parsed.inputs, &Inputs::new()).unwrap_err(),
        error("Pflichtfeld „flag“ fehlt.")
    );
    let long = "u".repeat(80);
    for (supplied, message) in [
        (
            serde_json::json!({"flag": "true"}),
            "Eingabe „flag“ erwartet true oder false.".to_string(),
        ),
        (
            serde_json::json!({"flag": true, "unknown": "x"}),
            "Der Workflow kennt die Eingabe „unknown“ nicht (mehr).".to_string(),
        ),
        (
            serde_json::json!({"flag": true, long.clone(): "x"}),
            format!(
                "Der Workflow kennt die Eingabe „{}…“ nicht (mehr).",
                "u".repeat(64)
            ),
        ),
        (
            serde_json::json!({"flag": true, "target": "macos"}),
            "Der Wert von „target“ ist keine der erlaubten Optionen.".to_string(),
        ),
        (
            serde_json::json!({"flag": true, "target": 1}),
            "Eingabe „target“ erwartet eine der Optionen.".to_string(),
        ),
        (
            serde_json::json!({"flag": true, "note": ""}),
            "Pflichtfeld „note“ darf nicht leer sein.".to_string(),
        ),
    ] {
        let supplied: Inputs = serde_json::from_value(supplied).unwrap();
        assert_eq!(
            validate_inputs(&parsed.inputs, &supplied).unwrap_err(),
            error(message)
        );
    }
    assert_eq!(
        parse_workflow_yaml(
            "on: {workflow_dispatch: {inputs: {x: {type: boolean, default: 'false'}}}}"
        )
        .unwrap_err(),
        error("Eingabe „x“ erwartet true oder false.")
    );
    for (source, message) in [
        (
            "on: [",
            "Workflow-YAML ist fehlerhaft oder enthält doppelte Schlüssel.",
        ),
        (
            "on: {workflow_dispatch: {inputs: {x: {type: file}}}}",
            "Eingabe „x“ hat einen nicht unterstützten Typ.",
        ),
        (
            "on: {workflow_dispatch: {inputs: {x: {type: choice, options: [a, a]}}}}",
            "Eingabe „x“ braucht mindestens eine Option und keine doppelten.",
        ),
        (
            "on: &a workflow_dispatch",
            "YAML-Anker und -Aliase werden nicht unterstützt.",
        ),
    ] {
        assert_eq!(
            parse_workflow_yaml(source).unwrap_err(),
            error(message),
            "{source}"
        );
    }
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
