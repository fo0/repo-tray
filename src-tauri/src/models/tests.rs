//! Pin and request bounds, git ref rules and the bounded outcome cache.
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
