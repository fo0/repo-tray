use crate::live::catalog::browser_repository_permission;
use crate::live::*;
#[test]
fn push_flag_does_not_imply_app_actions_write_and_missing_contents_blocks_dispatch() {
    let repo = serde_json::json!({"permissions":{"push":true}});
    for permissions in [
        serde_json::json!({"actions":"read","contents":"read"}),
        serde_json::json!({"actions":"write"}),
    ] {
        assert_eq!(
            browser_repository_permission(&serde_json::json!({"permissions":permissions}), &repo),
            Permission::Read
        );
    }
    assert_eq!(
        browser_repository_permission(
            &serde_json::json!({"permissions":{"contents":"read"}}),
            &repo
        ),
        Permission::Denied
    );
    let installation = serde_json::json!({"permissions":{"actions":"write","contents":"read"}});
    assert_eq!(
        browser_repository_permission(&installation, &repo),
        Permission::Write
    );
    assert_eq!(
        browser_repository_permission(
            &installation,
            &serde_json::json!({"permissions":{"push":false}})
        ),
        Permission::Read
    );
}
