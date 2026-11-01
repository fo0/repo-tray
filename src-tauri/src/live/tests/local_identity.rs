use crate::live::connect::{credential_account_id, verify_local_identity};
#[test]
fn local_import_checks_identity_and_has_a_separate_app_owned_namespace() {
    assert!(verify_local_identity(Some("fixture-alex"), "other-account").is_err());
    assert!(verify_local_identity(Some("fixture-alex"), "Fixture-Alex").is_ok());
    assert!(verify_local_identity(None, "fixture-alex").is_ok());
    assert_ne!(
        credential_account_id(42, true),
        credential_account_id(42, false)
    );
    assert_eq!(credential_account_id(42, true), "github-gh-42");
}
