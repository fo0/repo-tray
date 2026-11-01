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

#[test]
fn an_input_without_a_choice_takes_no_value_and_blocks_only_when_required() {
    let mut inputs = parse_workflow_yaml(
        "on:\n  workflow_dispatch:\n    inputs:\n      target: {type: environment}\n      stage: {type: environment, required: true}\n",
    )
    .unwrap()
    .inputs;
    for input in &mut inputs {
        input.note = Some("Fixture-Hinweis.".into());
    }
    let supplied = |name: &str, value: &str| {
        Inputs::from([(name.to_string(), InputValue::String(value.into()))])
    };
    assert_eq!(
        validate_inputs(&inputs[..1], &supplied("target", "production"))
            .unwrap_err()
            .0,
        "„target“: Fixture-Hinweis."
    );
    assert!(validate_inputs(&inputs[..1], &supplied("target", " ")).is_ok());
    assert!(validate_inputs(&inputs[..1], &Inputs::new()).is_ok());
    assert_eq!(
        validate_inputs(&inputs[1..], &Inputs::new()).unwrap_err().0,
        "Pflichtfeld „stage“ fehlt."
    );
}

#[test]
fn an_input_without_a_choice_still_takes_its_declared_default() {
    let mut inputs = parse_workflow_yaml(
        "on:\n  workflow_dispatch:\n    inputs:\n      target: {type: environment, default: production}\n",
    )
    .unwrap()
    .inputs;
    inputs[0].note = Some("Fixture-Hinweis.".into());
    let supplied =
        |value: &str| Inputs::from([("target".to_string(), InputValue::String(value.into()))]);
    assert!(validate_inputs(&inputs, &supplied("production")).is_ok());
    assert!(validate_inputs(&inputs, &Inputs::new()).is_ok());
    assert_eq!(
        validate_inputs(&inputs, &supplied("staging"))
            .unwrap_err()
            .0,
        "„target“: Fixture-Hinweis."
    );
}

#[test]
fn pin_inputs_are_bounded_in_count_and_characters() {
    let text = |chars: usize| InputValue::String("ä".repeat(chars));
    let widest: Inputs = (0..MAX_INPUTS)
        .map(|index| {
            let name = format!("{index:0>width$}", width = MAX_INPUT_NAME_BYTES);
            (name, text(MAX_PIN_INPUT_VALUE_CHARS))
        })
        .collect();
    assert!(validate_pin_inputs(&widest).is_ok());
    let mut crowded = widest.clone();
    crowded.insert("extra".into(), InputValue::Boolean(true));
    assert_eq!(
        validate_pin_inputs(&crowded).unwrap_err().0,
        "Ein Favorit speichert höchstens 25 Eingaben."
    );
    let long_name = Inputs::from([("n".repeat(MAX_INPUT_NAME_BYTES + 1), text(1))]);
    assert_eq!(
        validate_pin_inputs(&long_name).unwrap_err().0,
        "Eingabenamen eines Favoriten dürfen höchstens 128 Zeichen lang sein."
    );
    let long_value = Inputs::from([("notes".to_string(), text(MAX_PIN_INPUT_VALUE_CHARS + 1))]);
    assert_eq!(
        validate_pin_inputs(&long_value).unwrap_err().0,
        "Eingabewerte eines Favoriten dürfen höchstens 8000 Zeichen lang sein."
    );
}
