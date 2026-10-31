//! Server-free GitHub App device authorization. Only public status crosses IPC.
use crate::auth::{DeviceAuthorization, DevicePollResult, NativeKeyring, SecretToken};
use serde::{Deserialize, Serialize};
use std::{io::Read, sync::Mutex, time::Duration};

// Temporarily paused until the publisher is ready to support GitHub App sign-in.
// Existing stored browser credentials keep their normal lifecycle.
pub const SIGN_IN_ENABLED: bool = false;
pub fn ensure_sign_in_enabled() -> Result<(), String> {
    if SIGN_IN_ENABLED {
        Ok(())
    } else {
        Err("Die Browser-Anmeldung / GitHub App ist vorübergehend deaktiviert. Nutze gh CLI oder einen Token.".into())
    }
}
pub const VERIFY_URL: &str = "https://github.com/login/device";
const REAUTH: &str =
    "Browser-Anmeldung abgelaufen oder nicht sicher erneuerbar. Bitte erneut mit GitHub anmelden.";
const INVALID: &str = "GitHub hat eine ungültige Anmeldeantwort geliefert.";
const NETWORK: &str =
    "GitHub ist gerade nicht erreichbar. RepoTray versucht es weiter, solange der Code gültig ist.";
// Serialize entire read/refresh/replace/delete transactions across all native callers.
static CREDENTIALS: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserConfig {
    pub configured: bool,
}
pub fn config() -> BrowserConfig {
    BrowserConfig {
        configured: SIGN_IN_ENABLED && publisher().is_ok(),
    }
}
pub fn publisher() -> Result<(&'static str, &'static str), String> {
    let id = option_env!("REPOTRAY_GITHUB_CLIENT_ID").unwrap_or("");
    let slug = option_env!("REPOTRAY_GITHUB_APP_SLUG").unwrap_or("");
    validate_publisher(id, slug)?;
    Ok((id, slug))
}
fn validate_publisher(id: &str, slug: &str) -> Result<(), String> {
    if !id.starts_with("Iv")
        || id.len() > 80
        || id.len() < 8
        || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.')
        || slug.is_empty()
        || slug.len() > 100
        || !slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err("Browser-Anmeldung ist noch nicht eingerichtet. Die Herausgeber-App und ihre öffentliche Client-ID fehlen.".into());
    }
    Ok(())
}
pub fn installation_url() -> Result<String, String> {
    let (_, slug) = publisher()?;
    Ok(format!("https://github.com/apps/{slug}/installations/new"))
}
pub fn is_browser_account(id: &str) -> bool {
    id.starts_with("github-device-")
}
pub fn account_id(user_id: u64) -> String {
    format!("github-device-{user_id}")
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum OAuthEndpoint {
    DeviceCode,
    AccessToken,
}
impl OAuthEndpoint {
    fn url(self) -> &'static str {
        match self {
            Self::DeviceCode => "https://github.com/login/device/code",
            Self::AccessToken => "https://github.com/login/oauth/access_token",
        }
    }
}
// Never derive Debug/Serialize: response bodies and forms may contain secrets.
pub struct OAuthResponse {
    pub status: u16,
    pub body: Vec<u8>,
}
impl Drop for OAuthResponse {
    fn drop(&mut self) {
        self.body.fill(0);
        std::hint::black_box(&mut self.body);
    }
}
pub trait OAuthTransport {
    fn post(
        &mut self,
        endpoint: OAuthEndpoint,
        form: &[(&str, &str)],
    ) -> Result<OAuthResponse, String>;
    fn identity(&mut self, token: &SecretToken) -> Result<(u64, String), String>;
}
pub struct NativeOAuthTransport {
    client: reqwest::blocking::Client,
}
impl NativeOAuthTransport {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            client: reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(concat!("RepoTray/", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|_| "Anmeldedienst nicht verfügbar.")?,
        })
    }
    fn response(response: reqwest::blocking::Response) -> Result<OAuthResponse, String> {
        let status = response.status().as_u16();
        let mut result = OAuthResponse {
            status,
            body: vec![],
        };
        response
            .take(32 * 1024 + 1)
            .read_to_end(&mut result.body)
            .map_err(|_| NETWORK)?;
        if result.body.len() > 32 * 1024 {
            return Err(INVALID.into());
        }
        Ok(result)
    }
}
impl OAuthTransport for NativeOAuthTransport {
    fn post(
        &mut self,
        endpoint: OAuthEndpoint,
        form: &[(&str, &str)],
    ) -> Result<OAuthResponse, String> {
        // A closed enum adds exactly two github.com endpoints; REST policy stays api.github.com only.
        let response = self
            .client
            .post(endpoint.url())
            .header("Accept", "application/json")
            .form(form)
            .send()
            .map_err(|_| NETWORK)?;
        Self::response(response)
    }
    fn identity(&mut self, token: &SecretToken) -> Result<(u64, String), String> {
        let request = self
            .client
            .get("https://api.github.com/user")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", crate::github::API_VERSION);
        let response = token
            .with_secret(|v| request.bearer_auth(v))
            .send()
            .map_err(|_| NETWORK)?;
        let response = Self::response(response)?;
        if response.status != 200 {
            return Err("GitHub-Konto konnte nicht bestätigt werden. Prüfe Organisationsfreigabe und melde dich erneut an.".into());
        }
        #[derive(Deserialize)]
        struct User {
            id: u64,
            login: String,
        }
        let user: User = serde_json::from_slice(&response.body).map_err(|_| INVALID)?;
        if user.id == 0
            || user.login.is_empty()
            || user.login.len() > 100
            || !user
                .login
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err(INVALID.into());
        }
        Ok((user.id, user.login))
    }
}

#[derive(Deserialize)]
struct WireTokens {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    refresh_token_expires_in: u64,
    token_type: String,
}
impl Drop for WireTokens {
    fn drop(&mut self) {
        wipe_string(&mut self.access_token);
        wipe_string(&mut self.refresh_token);
    }
}
pub struct BrowserTokens {
    pub access: SecretToken,
    pub refresh: SecretToken,
    pub expires_at: u64,
    pub refresh_expires_at: u64,
}
fn wipe_string(value: &mut String) {
    let mut bytes = std::mem::take(value).into_bytes();
    bytes.fill(0);
    std::hint::black_box(&mut bytes);
}
fn valid_secret(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 512
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
}
fn tokens(response: &OAuthResponse, now: u64) -> Result<BrowserTokens, String> {
    if response.status != 200 {
        return Err(INVALID.into());
    }
    let mut wire: WireTokens = serde_json::from_slice(&response.body).map_err(|_| INVALID)?;
    if !valid_secret(&wire.access_token)
        || !valid_secret(&wire.refresh_token)
        || !wire.token_type.eq_ignore_ascii_case("bearer")
        || wire.expires_in < 60
        || wire.expires_in > 86400
        || wire.refresh_token_expires_in <= wire.expires_in
        || wire.refresh_token_expires_in > 366 * 86400
    {
        return Err(INVALID.into());
    }
    Ok(BrowserTokens {
        access: SecretToken::new(std::mem::take(&mut wire.access_token)),
        refresh: SecretToken::new(std::mem::take(&mut wire.refresh_token)),
        expires_at: now.saturating_add(wire.expires_in),
        refresh_expires_at: now.saturating_add(wire.refresh_token_expires_in),
    })
}
pub fn begin(
    transport: &mut impl OAuthTransport,
    client_id: &str,
) -> Result<DeviceAuthorization, String> {
    let response = transport.post(
        OAuthEndpoint::DeviceCode,
        &[("client_id", client_id), ("scope", "offline_access")],
    )?;
    #[derive(Deserialize)]
    struct Wire {
        device_code: String,
        user_code: String,
        verification_uri: String,
        expires_in: u64,
        interval: u64,
    }
    if response.status != 200 {
        return Err("GitHub-Anmeldung konnte nicht gestartet werden. Prüfe Herausgeberkonfiguration und Netzwerk.".into());
    }
    let wire: Wire = serde_json::from_slice(&response.body).map_err(|_| {
        "GitHub-App nicht für Gerätecodes eingerichtet oder Anmeldeantwort ungültig."
    })?;
    let device_code = SecretToken::new(wire.device_code);
    if !device_code.with_secret(valid_secret) || wire.verification_uri != VERIFY_URL {
        return Err(INVALID.into());
    }
    Ok(DeviceAuthorization {
        device_code,
        user_code: wire.user_code,
        verification_uri: wire.verification_uri,
        expires_in: wire.expires_in,
        interval: wire.interval,
    })
}
pub enum PollOutcome {
    Status(DevicePollResult),
    Tokens(BrowserTokens),
}
pub fn poll(
    transport: &mut impl OAuthTransport,
    client_id: &str,
    code: &SecretToken,
    now: u64,
) -> Result<PollOutcome, String> {
    let response = code.with_secret(|code| {
        transport.post(
            OAuthEndpoint::AccessToken,
            &[
                ("client_id", client_id),
                ("device_code", code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ],
        )
    })?;
    if response.status >= 500 || response.status == 429 {
        return Err(NETWORK.into());
    }
    #[derive(Deserialize)]
    struct ErrorBody {
        error: Option<String>,
    }
    let error: ErrorBody = serde_json::from_slice(&response.body).map_err(|_| INVALID)?;
    if let Some(error) = error.error {
        let status = match error.as_str() {
            "authorization_pending" => DevicePollResult::AuthorizationPending,
            "slow_down" => DevicePollResult::SlowDown,
            "access_denied" => DevicePollResult::AccessDenied,
            "expired_token" | "token_expired" => DevicePollResult::ExpiredToken,
            "device_flow_disabled" | "incorrect_client_credentials" => {
                return Err(
                    "Die Herausgeber-App ist nicht für diese Anmeldung eingerichtet.".into(),
                )
            }
            _ => return Err("GitHub hat die Anmeldung beendet. Bitte neu starten.".into()),
        };
        return Ok(PollOutcome::Status(status));
    }
    Ok(PollOutcome::Tokens(tokens(&response, now)?))
}

// Access + refresh + rotation marker are one OS-vault value. No metadata cache contains them.
pub struct BrowserCredential {
    pub tokens: BrowserTokens,
    pub client_id: String,
    pub user_id: u64,
    pub rotation_pending: bool,
}
impl BrowserCredential {
    pub fn encode(&self) -> Result<SecretToken, String> {
        #[derive(Serialize)]
        struct Record<'a> {
            access_token: &'a str,
            refresh_token: &'a str,
            client_id: &'a str,
            user_id: u64,
            expires_at: u64,
            refresh_expires_at: u64,
            rotation_pending: bool,
        }
        self.tokens.access.with_secret(|access| {
            self.tokens.refresh.with_secret(|refresh| {
                serde_json::to_string(&Record {
                    access_token: access,
                    refresh_token: refresh,
                    client_id: &self.client_id,
                    user_id: self.user_id,
                    expires_at: self.tokens.expires_at,
                    refresh_expires_at: self.tokens.refresh_expires_at,
                    rotation_pending: self.rotation_pending,
                })
                .map(SecretToken::new)
                .map_err(|_| INVALID.into())
            })
        })
    }
    fn decode(secret: &SecretToken) -> Result<Self, String> {
        #[derive(Deserialize)]
        struct Record {
            access_token: String,
            refresh_token: String,
            client_id: String,
            user_id: u64,
            expires_at: u64,
            refresh_expires_at: u64,
            rotation_pending: bool,
        }
        impl Drop for Record {
            fn drop(&mut self) {
                wipe_string(&mut self.access_token);
                wipe_string(&mut self.refresh_token);
            }
        }
        let mut r: Record = secret
            .with_secret(|s| serde_json::from_str(s))
            .map_err(|_| REAUTH)?;
        if !valid_secret(&r.access_token) || !valid_secret(&r.refresh_token) || r.user_id == 0 {
            return Err(REAUTH.into());
        }
        Ok(Self {
            tokens: BrowserTokens {
                access: SecretToken::new(std::mem::take(&mut r.access_token)),
                refresh: SecretToken::new(std::mem::take(&mut r.refresh_token)),
                expires_at: r.expires_at,
                refresh_expires_at: r.refresh_expires_at,
            },
            client_id: r.client_id.clone(),
            user_id: r.user_id,
            rotation_pending: r.rotation_pending,
        })
    }
}
pub fn access_token(
    keyring: &dyn NativeKeyring,
    account: &str,
    transport: &mut impl OAuthTransport,
    now: u64,
) -> Result<SecretToken, String> {
    let _guard = CREDENTIALS.lock().map_err(|_| REAUTH)?;
    let stored = keyring
        .read_token(account)
        .map_err(|_| "Betriebssystem-Tresor nicht verfügbar.")?
        .ok_or(REAUTH)?;
    if !is_browser_account(account) {
        return Ok(stored);
    }
    let credential = BrowserCredential::decode(&stored)?;
    if account_id(credential.user_id) != account || credential.rotation_pending {
        return Err(REAUTH.into());
    }
    if now.saturating_add(60) < credential.tokens.expires_at {
        return Ok(credential.tokens.access);
    }
    if now.saturating_add(60) >= credential.tokens.refresh_expires_at {
        return Err(REAUTH.into());
    }
    let (id, _) = publisher()?;
    if credential.client_id != id {
        return Err(REAUTH.into());
    }
    rotate(keyring, account, transport, credential, now)
}
/// Commit only while the originating auth attempt still owns the result. The check
/// after a potentially blocking vault write is the commit point; cancellation that
/// wins before it restores the old entry while all other writers are excluded.
pub fn commit_credential(
    keyring: &dyn NativeKeyring,
    account: &str,
    credential: &SecretToken,
    still_current: impl Fn() -> bool,
) -> Result<(), String> {
    let _guard = CREDENTIALS.lock().map_err(|_| REAUTH)?;
    if !still_current() {
        return Err("Anmeldung wurde abgebrochen.".into());
    }
    let previous = keyring
        .read_token(account)
        .map_err(|_| "Betriebssystem-Tresor nicht verfügbar.")?;
    keyring
        .write_token(account, credential)
        .map_err(|_| "Betriebssystem-Tresor nicht verfügbar. Anmeldung wurde nicht gespeichert.")?;
    if !still_current() {
        let rollback = if let Some(previous) = previous {
            keyring.write_token(account, &previous)
        } else {
            keyring.delete_token(account)
        };
        rollback.map_err(|_| "Anmeldung abgebrochen; der vorherige Tresoreintrag konnte nicht wiederhergestellt werden. Bitte Konto erneut verbinden oder trennen.")?;
        return Err("Anmeldung wurde abgebrochen.".into());
    }
    Ok(())
}
/// A refresh already in progress finishes before deletion; it can never recreate
/// a credential after this operation completes. New sign-ins use the same lock.
pub fn disconnect_credential(keyring: &dyn NativeKeyring, account: &str) -> Result<(), String> {
    let _guard = CREDENTIALS.lock().map_err(|_| REAUTH)?;
    keyring
        .delete_token(account)
        .map_err(|_| "Token konnte nicht aus dem Betriebssystem-Tresor entfernt werden.".into())
}
fn rotate(
    keyring: &dyn NativeKeyring,
    account: &str,
    transport: &mut impl OAuthTransport,
    mut credential: BrowserCredential,
    now: u64,
) -> Result<SecretToken, String> {
    // Persist intent before the single-use request. A lost response / crash must not reuse the old refresh token.
    credential.rotation_pending = true;
    keyring
        .write_token(account, &credential.encode()?)
        .map_err(|_| REAUTH)?;
    let response = credential
        .tokens
        .refresh
        .with_secret(|refresh| {
            transport.post(
                OAuthEndpoint::AccessToken,
                &[
                    ("client_id", &credential.client_id),
                    ("grant_type", "refresh_token"),
                    ("refresh_token", refresh),
                ],
            )
        })
        .map_err(|_| REAUTH)?;
    let replacement = tokens(&response, now).map_err(|_| REAUTH)?;
    let (id, _) = transport
        .identity(&replacement.access)
        .map_err(|_| REAUTH)?;
    if id != credential.user_id {
        return Err(REAUTH.into());
    }
    credential.tokens = replacement;
    credential.rotation_pending = false;
    keyring
        .write_token(account, &credential.encode()?)
        .map_err(|_| REAUTH)?;
    Ok(credential.tokens.access)
}

pub fn is_network_error(message: &str) -> bool {
    message == NETWORK
}

#[cfg(test)]
mod tests {
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
            let PollOutcome::Status(result) = poll(&mut t, "Iv1.synthetic", &code, now).unwrap()
            else {
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
            BrowserCredential::decode(&vault.read_token("github-device-42").unwrap().unwrap())
                .unwrap();
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
}

#[cfg(test)]
mod transaction_race_tests {
    use super::*;
    use crate::auth::AuthError;
    use std::{
        collections::BTreeMap,
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc,
        },
        thread,
    };
    #[derive(Default)]
    struct Vault(Mutex<BTreeMap<String, SecretToken>>);
    impl NativeKeyring for Vault {
        fn read_token(&self, account: &str) -> Result<Option<SecretToken>, AuthError> {
            Ok(self
                .0
                .lock()
                .unwrap()
                .get(account)
                .map(|v| v.with_secret(|s| SecretToken::new(s.into()))))
        }
        fn write_token(&self, account: &str, value: &SecretToken) -> Result<(), AuthError> {
            self.0.lock().unwrap().insert(
                account.into(),
                value.with_secret(|s| SecretToken::new(s.into())),
            );
            Ok(())
        }
        fn delete_token(&self, account: &str) -> Result<(), AuthError> {
            self.0.lock().unwrap().remove(account);
            Ok(())
        }
    }
    struct BlockingVault {
        inner: Vault,
        block_once: AtomicBool,
        entered: mpsc::SyncSender<()>,
        release: Mutex<mpsc::Receiver<()>>,
    }
    impl NativeKeyring for BlockingVault {
        fn read_token(&self, id: &str) -> Result<Option<SecretToken>, AuthError> {
            self.inner.read_token(id)
        }
        fn write_token(&self, id: &str, token: &SecretToken) -> Result<(), AuthError> {
            if self.block_once.swap(false, Ordering::SeqCst) {
                self.entered.send(()).unwrap();
                self.release.lock().unwrap().recv().unwrap();
            }
            self.inner.write_token(id, token)
        }
        fn delete_token(&self, id: &str) -> Result<(), AuthError> {
            self.inner.delete_token(id)
        }
    }
    fn record(access: &str) -> BrowserCredential {
        BrowserCredential {
            tokens: BrowserTokens {
                access: SecretToken::new(access.into()),
                refresh: SecretToken::new("synthetic-refresh".into()),
                expires_at: 1,
                refresh_expires_at: 100000,
            },
            client_id: "Iv1.synthetic".into(),
            user_id: 42,
            rotation_pending: false,
        }
    }
    struct BlockingTransport {
        entered: mpsc::SyncSender<()>,
        release: mpsc::Receiver<()>,
    }
    impl OAuthTransport for BlockingTransport {
        fn post(&mut self, _: OAuthEndpoint, _: &[(&str, &str)]) -> Result<OAuthResponse, String> {
            self.entered.send(()).unwrap();
            self.release.recv().unwrap();
            Ok(OAuthResponse { status: 200, body: br#"{"access_token":"synthetic-refreshed","refresh_token":"synthetic-rotated","expires_in":28800,"refresh_token_expires_in":15897600,"token_type":"bearer"}"#.to_vec() })
        }
        fn identity(&mut self, _: &SecretToken) -> Result<(u64, String), String> {
            Ok((42, "fixture-user".into()))
        }
    }
    #[test]
    fn cancel_during_blocked_vault_write_rolls_back_without_late_account_commit() {
        for previous in [None, Some("synthetic-old")] {
            let (entered_tx, entered_rx) = mpsc::sync_channel(0);
            let (release_tx, release_rx) = mpsc::sync_channel(0);
            let vault = Arc::new(BlockingVault {
                inner: Vault::default(),
                block_once: AtomicBool::new(true),
                entered: entered_tx,
                release: Mutex::new(release_rx),
            });
            if let Some(value) = previous {
                vault
                    .inner
                    .write_token("github-device-42", &SecretToken::new(value.into()))
                    .unwrap();
            }
            vault
                .inner
                .write_token("github-42", &SecretToken::new("synthetic-pat".into()))
                .unwrap();
            let current = Arc::new(AtomicBool::new(true));
            let account_committed = Arc::new(AtomicBool::new(false));
            let worker = {
                let vault = vault.clone();
                let current = current.clone();
                let account_committed = account_committed.clone();
                thread::spawn(move || {
                    let result = commit_credential(
                        vault.as_ref(),
                        "github-device-42",
                        &record("synthetic-new").encode().unwrap(),
                        || current.load(Ordering::SeqCst),
                    );
                    if result.is_ok() {
                        account_committed.store(true, Ordering::SeqCst);
                    }
                    result
                })
            };
            entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            current.store(false, Ordering::SeqCst);
            release_tx.send(()).unwrap();
            assert!(worker.join().unwrap().is_err());
            assert!(!account_committed.load(Ordering::SeqCst));
            assert_eq!(
                vault
                    .read_token("github-device-42")
                    .unwrap()
                    .map(|s| s.with_secret(str::to_owned)),
                previous.map(str::to_owned)
            );
            assert!(vault
                .read_token("github-42")
                .unwrap()
                .unwrap()
                .with_secret(|s| s == "synthetic-pat"));
        }
    }
    #[test]
    fn disconnect_waits_for_inflight_refresh_then_removes_credential_permanently() {
        let vault = Arc::new(Vault::default());
        vault
            .write_token(
                "github-device-42",
                &record("synthetic-old").encode().unwrap(),
            )
            .unwrap();
        let (entered_tx, entered_rx) = mpsc::sync_channel(0);
        let (release_tx, release_rx) = mpsc::sync_channel(0);
        let refresh = {
            let vault = vault.clone();
            thread::spawn(move || {
                let _guard = CREDENTIALS.lock().unwrap();
                rotate(
                    vault.as_ref(),
                    "github-device-42",
                    &mut BlockingTransport {
                        entered: entered_tx,
                        release: release_rx,
                    },
                    record("synthetic-old"),
                    10,
                )
            })
        };
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (started_tx, started_rx) = mpsc::sync_channel(0);
        let (done_tx, done_rx) = mpsc::sync_channel(1);
        let disconnect = {
            let vault = vault.clone();
            thread::spawn(move || {
                started_tx.send(()).unwrap();
                let result = disconnect_credential(vault.as_ref(), "github-device-42");
                done_tx.send(()).unwrap();
                result
            })
        };
        started_rx.recv().unwrap();
        assert!(done_rx.recv_timeout(Duration::from_millis(30)).is_err());
        release_tx.send(()).unwrap();
        refresh.join().unwrap().unwrap();
        disconnect.join().unwrap().unwrap();
        assert!(vault.read_token("github-device-42").unwrap().is_none());
    }
    #[test]
    fn fresh_login_waits_for_old_refresh_and_remains_the_final_vault_owner() {
        let vault = Arc::new(Vault::default());
        let (entered_tx, entered_rx) = mpsc::sync_channel(0);
        let (release_tx, release_rx) = mpsc::sync_channel(0);
        let refresh = {
            let vault = vault.clone();
            thread::spawn(move || {
                let _guard = CREDENTIALS.lock().unwrap();
                rotate(
                    vault.as_ref(),
                    "github-device-42",
                    &mut BlockingTransport {
                        entered: entered_tx,
                        release: release_rx,
                    },
                    record("synthetic-old"),
                    10,
                )
            })
        };
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (started_tx, started_rx) = mpsc::sync_channel(0);
        let (done_tx, done_rx) = mpsc::sync_channel(1);
        let login = {
            let vault = vault.clone();
            thread::spawn(move || {
                started_tx.send(()).unwrap();
                let result = commit_credential(
                    vault.as_ref(),
                    "github-device-42",
                    &record("synthetic-new-login").encode().unwrap(),
                    || true,
                );
                done_tx.send(()).unwrap();
                result
            })
        };
        started_rx.recv().unwrap();
        assert!(done_rx.recv_timeout(Duration::from_millis(30)).is_err());
        release_tx.send(()).unwrap();
        refresh.join().unwrap().unwrap();
        login.join().unwrap().unwrap();
        let stored =
            BrowserCredential::decode(&vault.read_token("github-device-42").unwrap().unwrap())
                .unwrap();
        assert!(stored
            .tokens
            .access
            .with_secret(|s| s == "synthetic-new-login"));
        assert!(!stored.rotation_pending);
    }
}
