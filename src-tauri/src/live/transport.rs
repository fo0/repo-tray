//! The production GitHub transport: HTTPS with the account's bearer token from the vault.
use super::now;
use crate::{
    auth::{NativeKeyring, SecretToken},
    browser_auth::{self, NativeOAuthTransport, OAuthEndpoint, OAuthResponse, OAuthTransport},
    github::{ApiRequest, ApiResponse, Method, Transport, TransportError},
};
use std::{io::Read, sync::Arc, time::Duration};

pub struct HttpTransport {
    client: reqwest::blocking::Client,
    keyring: Arc<dyn NativeKeyring>,
    pub(super) bootstrap: Option<SecretToken>,
    oauth: OAuthClient,
}
impl HttpTransport {
    pub fn new(keyring: Arc<dyn NativeKeyring>) -> Result<Self, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(25))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("RepoTray/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|_| "HTTP-Dienst konnte nicht gestartet werden.")?;
        Ok(Self {
            client,
            keyring,
            bootstrap: None,
            oauth: OAuthClient::default(),
        })
    }
}
impl Transport for HttpTransport {
    fn send(&mut self, request: &ApiRequest) -> Result<ApiResponse, TransportError> {
        let stored;
        let token = if request.account_id() == "pending" {
            self.bootstrap.as_ref()
        } else {
            let oauth = self
                .oauth
                .prepare(request.account_id())
                .map_err(|_| TransportError::BeforeSend)?;
            stored = Some(
                browser_auth::access_token(
                    self.keyring.as_ref(),
                    request.account_id(),
                    oauth,
                    now(),
                )
                .map_err(|_| TransportError::BeforeSend)?,
            );
            stored.as_ref()
        }
        .ok_or(TransportError::BeforeSend)?;
        let mut builder = self.client.request(
            match request.method() {
                Method::Get => reqwest::Method::GET,
                Method::Post => reqwest::Method::POST,
            },
            request.url().as_str(),
        );
        for (key, value) in request.headers() {
            builder = builder.header(key, value);
        }
        builder = token.with_secret(|value| builder.bearer_auth(value));
        if let Some(body) = request.body() {
            builder = builder.body(body.to_vec());
        }
        let response = builder.send().map_err(|e| {
            if e.is_connect() || e.is_builder() {
                TransportError::BeforeSend
            } else {
                TransportError::OutcomeUnknown
            }
        })?;
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.to_string(), v.to_string())))
            .collect();
        let mut body = Vec::new();
        response
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut body)
            .map_err(|_| TransportError::OutcomeUnknown)?;
        if body.len() > 2 * 1024 * 1024 {
            return Err(TransportError::OutcomeUnknown);
        }
        Ok(ApiResponse {
            status,
            headers,
            body,
        })
    }
}
/// The OAuth HTTP client (runtime thread, TLS config) exists only for browser accounts,
/// whose credentials may rotate, and is built once and reused; PAT and gh accounts never
/// build one. It is built before `access_token` runs: rotation marks the vault entry before
/// its first request, so a failed build must happen while the credential is untouched.
#[derive(Default)]
pub(super) struct OAuthClient(Option<NativeOAuthTransport>);
impl OAuthClient {
    pub(super) fn prepare(&mut self, account: &str) -> Result<&mut Self, String> {
        if browser_auth::is_browser_account(account) && self.0.is_none() {
            self.0 = Some(NativeOAuthTransport::new()?);
        }
        Ok(self)
    }
    fn native(&mut self) -> Result<&mut NativeOAuthTransport, String> {
        self.0
            .as_mut()
            .ok_or_else(|| "Anmeldedienst nicht verfügbar.".into())
    }
}
impl OAuthTransport for OAuthClient {
    fn post(
        &mut self,
        endpoint: OAuthEndpoint,
        form: &[(&str, &str)],
    ) -> Result<OAuthResponse, String> {
        self.native()?.post(endpoint, form)
    }
    fn identity(&mut self, token: &SecretToken) -> Result<(u64, String), String> {
        self.native()?.identity(token)
    }
}
