use super::*;
use crate::auth::{AuthError, DeviceFlow, DeviceFlowStatus};
use std::collections::{BTreeMap, VecDeque};
struct Fake {
    responses: VecDeque<Result<OAuthResponse, String>>,
    calls: Vec<OAuthEndpoint>,
    identity: u64,
}
impl OAuthTransport for Fake {
    fn post(
        &mut self,
        endpoint: OAuthEndpoint,
        form: &[(&str, &str)],
    ) -> Result<OAuthResponse, String> {
        assert!(!form.iter().any(|(k, _)| *k == "client_secret"));
        self.calls.push(endpoint);
        self.responses.pop_front().expect("unexpected OAuth retry")
    }
    fn identity(&mut self, _: &SecretToken) -> Result<(u64, String), String> {
        Ok((self.identity, "fixture-user".into()))
    }
}
fn response(body: &str) -> Result<OAuthResponse, String> {
    Ok(OAuthResponse {
        status: 200,
        body: body.as_bytes().to_vec(),
    })
}
fn fake(responses: Vec<Result<OAuthResponse, String>>) -> Fake {
    Fake {
        responses: responses.into(),
        calls: vec![],
        identity: 42,
    }
}
fn token_response() -> Result<OAuthResponse, String> {
    response(
        r#"{"access_token":"synthetic-access","refresh_token":"synthetic-refresh","expires_in":28800,"refresh_token_expires_in":15897600,"token_type":"bearer"}"#,
    )
}
fn credential() -> BrowserCredential {
    BrowserCredential {
        tokens: tokens(&token_response().unwrap(), 0).unwrap(),
        client_id: "Iv1.synthetic".into(),
        user_id: 42,
        rotation_pending: false,
    }
}
#[derive(Default)]
struct Vault {
    data: Mutex<BTreeMap<String, SecretToken>>,
    writes: Mutex<usize>,
}
impl NativeKeyring for Vault {
    fn read_token(&self, id: &str) -> Result<Option<SecretToken>, AuthError> {
        Ok(self
            .data
            .lock()
            .unwrap()
            .get(id)
            .map(|s| s.with_secret(|s| SecretToken::new(s.into()))))
    }
    fn write_token(&self, id: &str, secret: &SecretToken) -> Result<(), AuthError> {
        *self.writes.lock().unwrap() += 1;
        self.data.lock().unwrap().insert(
            id.into(),
            secret.with_secret(|s| SecretToken::new(s.into())),
        );
        Ok(())
    }
    fn delete_token(&self, id: &str) -> Result<(), AuthError> {
        self.data.lock().unwrap().remove(id);
        Ok(())
    }
}
#[test]
fn browser_sign_in_is_explicitly_paused_independently_of_publisher_configuration() {
    assert!(!config().configured);
    assert!(ensure_sign_in_enabled()
        .unwrap_err()
        .contains("vorübergehend deaktiviert"));
    // Keep configuration parsing for existing credentials and future re-enabling.
    assert!(validate_publisher("Iv1.synthetic", "repotray-desktop").is_ok());
}

#[test]
fn public_config_rejects_urls_and_accepts_current_and_legacy_client_id_formats() {
    for id in ["Iv1.synthetic", "Iv23liSynthetic1234"] {
        assert!(validate_publisher(id, "repotray-desktop").is_ok());
    }
    for (id, slug) in [
        ("", "repotray"),
        ("Iv1.synthetic", "evil/path"),
        ("Iv1.synthetic", "../device"),
        ("https://evil.test", "repotray"),
    ] {
        assert!(validate_publisher(id, slug).is_err());
    }
    assert_eq!(
        OAuthEndpoint::DeviceCode.url(),
        "https://github.com/login/device/code"
    );
    assert_eq!(
        OAuthEndpoint::AccessToken.url(),
        "https://github.com/login/oauth/access_token"
    );
}
#[test]
fn protocol_drives_wait_slowdown_denied_and_never_serializes_device_secret() {
    let mut t = fake(vec![
        response(
            r#"{"device_code":"synthetic-device","user_code":"ABCD-EFGH","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#,
        ),
        response(r#"{"error":"authorization_pending"}"#),
        response(r#"{"error":"slow_down","interval":10}"#),
        response(r#"{"error":"access_denied"}"#),
    ]);
    let mut flow = DeviceFlow::new();
    let public = flow
        .start_local(begin(&mut t, "Iv1.synthetic").unwrap(), 0)
        .unwrap();
    assert!(!serde_json::to_string(&public)
        .unwrap()
        .contains("synthetic-device"));
    for (now, expected) in [
        (5, DevicePollResult::AuthorizationPending),
        (10, DevicePollResult::SlowDown),
        (20, DevicePollResult::AccessDenied),
    ] {
        let ticket = flow.next_poll(now).unwrap().unwrap();
        let code = flow
            .with_device_code(ticket, now, |s| SecretToken::new(s.into()))
            .unwrap();
        let PollOutcome::Status(result) = poll(&mut t, "Iv1.synthetic", &code, now).unwrap() else {
            panic!("expected status")
        };
        assert_eq!(result, expected);
        flow.apply_poll(ticket, result, now).unwrap();
    }
    assert_eq!(flow.status(21), DeviceFlowStatus::Denied);
    assert_eq!(t.calls.len(), 4);
}
#[test]
fn untrusted_verification_url_and_token_shapes_fail_closed() {
    let mut t = fake(vec![response(
        r#"{"device_code":"synthetic-device","user_code":"ABCD-EFGH","verification_uri":"https://github.com.evil.test/login/device","expires_in":900,"interval":5}"#,
    )]);
    assert!(begin(&mut t, "Iv1.synthetic").is_err());
    assert!(tokens(
        &response(r#"{"access_token":"synthetic","token_type":"bearer"}"#).unwrap(),
        0
    )
    .is_err());
    let mut t = fake(vec![Ok(OAuthResponse {
        status: 503,
        body: b"unavailable".to_vec(),
    })]);
    assert!(is_network_error(
        &poll(
            &mut t,
            "Iv1.synthetic",
            &SecretToken::new("synthetic-device".into()),
            0
        )
        .err()
        .unwrap()
    ));
}
#[test]
fn rotation_commits_both_tokens_and_preserves_foreign_credentials() {
    let vault = Vault::default();
    vault
        .write_token("github-42", &SecretToken::new("synthetic-pat".into()))
        .unwrap();
    let mut t = fake(vec![token_response()]);
    let access = rotate(&vault, "github-device-42", &mut t, credential(), 100).unwrap();
    assert!(access.with_secret(|s| s == "synthetic-access"));
    let record =
        BrowserCredential::decode(&vault.read_token("github-device-42").unwrap().unwrap()).unwrap();
    assert!(!record.rotation_pending);
    assert_eq!(record.tokens.expires_at, 28900);
    assert!(vault
        .read_token("github-42")
        .unwrap()
        .unwrap()
        .with_secret(|s| s == "synthetic-pat"));
    assert_eq!(t.calls.len(), 1);
}
#[test]
fn lost_refresh_response_is_durable_and_never_retried_even_after_restart() {
    let vault = Vault::default();
    let mut t = fake(vec![Err(NETWORK.into())]);
    assert!(rotate(&vault, "github-device-42", &mut t, credential(), 30000).is_err());
    assert!(
        BrowserCredential::decode(&vault.read_token("github-device-42").unwrap().unwrap())
            .unwrap()
            .rotation_pending
    );
    let mut restarted = fake(vec![]);
    assert!(access_token(&vault, "github-device-42", &mut restarted, 30001).is_err());
    assert!(restarted.calls.is_empty());
    assert_eq!(t.calls.len(), 1);
}
#[test]
fn vault_failure_before_rotation_prevents_send_and_failed_replacement_keeps_marker() {
    struct FailingVault {
        vault: Vault,
        allow_first: bool,
    }
    impl NativeKeyring for FailingVault {
        fn read_token(&self, id: &str) -> Result<Option<SecretToken>, AuthError> {
            self.vault.read_token(id)
        }
        fn write_token(&self, id: &str, token: &SecretToken) -> Result<(), AuthError> {
            if !self.allow_first || *self.vault.writes.lock().unwrap() > 0 {
                return Err(AuthError::KeyringUnavailable);
            }
            self.vault.write_token(id, token)
        }
        fn delete_token(&self, _: &str) -> Result<(), AuthError> {
            panic!("rotation must not delete credentials")
        }
    }
    let vault = FailingVault {
        vault: Vault::default(),
        allow_first: false,
    };
    let mut t = fake(vec![]);
    assert!(rotate(&vault, "github-device-42", &mut t, credential(), 30000).is_err());
    assert!(t.calls.is_empty());
    let vault = FailingVault {
        vault: Vault::default(),
        allow_first: true,
    };
    let mut t = fake(vec![token_response()]);
    assert!(rotate(&vault, "github-device-42", &mut t, credential(), 30000).is_err());
    assert!(
        BrowserCredential::decode(&vault.read_token("github-device-42").unwrap().unwrap())
            .unwrap()
            .rotation_pending
    );
    let mut restarted = fake(vec![]);
    assert!(access_token(&vault, "github-device-42", &mut restarted, 30001).is_err());
    assert!(restarted.calls.is_empty());
}

#[test]
fn refresh_identity_mismatch_cannot_replace_vault_credentials() {
    let vault = Vault::default();
    let mut t = fake(vec![token_response()]);
    t.identity = 7;
    assert!(rotate(&vault, "github-device-42", &mut t, credential(), 30000).is_err());
    assert!(
        BrowserCredential::decode(&vault.read_token("github-device-42").unwrap().unwrap())
            .unwrap()
            .rotation_pending
    );
}
