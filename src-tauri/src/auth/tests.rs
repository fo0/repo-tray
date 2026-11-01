use super::*;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

fn authorization() -> DeviceAuthorization {
    DeviceAuthorization {
        device_code: SecretToken::new("synthetic-device-code".into()),
        user_code: "DEMO-1234".into(),
        verification_uri: "https://github.com/login/device".into(),
        expires_in: 900,
        interval: 5,
    }
}

#[test]
fn locked_gate_never_reads_or_writes_the_native_keyring() {
    struct CountingKeyring(Arc<AtomicUsize>);
    impl NativeKeyring for CountingKeyring {
        fn read_token(&self, _: &str) -> Result<Option<SecretToken>, AuthError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(None)
        }
        fn write_token(&self, _: &str, _: &SecretToken) -> Result<(), AuthError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
        fn delete_token(&self, _: &str) -> Result<(), AuthError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let credentials = Credentials::locked(CountingKeyring(calls.clone()));
    assert!(matches!(credentials.read("demo"), Err(AuthError::Locked)));
    assert_eq!(
        credentials.write("demo", &SecretToken::new("synthetic-token".into())),
        Err(AuthError::Locked)
    );
    assert_eq!(credentials.delete("demo"), Err(AuthError::Locked));
    assert_eq!(AuthGate::Locked.begin_device_flow(), Err(AuthError::Locked));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[test]
fn device_flow_respects_poll_interval_slowdown_and_cancellation() {
    let mut flow = DeviceFlow::new();
    flow.start_local(authorization(), 100).unwrap();
    assert_eq!(flow.next_poll(104).unwrap(), None);
    let ticket = flow.next_poll(105).unwrap().unwrap();
    assert_eq!(flow.next_poll(105).unwrap(), None);
    assert!(flow
        .with_device_code(ticket, 105, |value| value == "synthetic-device-code")
        .unwrap());
    let status = flow
        .apply_poll(ticket, DevicePollResult::SlowDown, 105)
        .unwrap();
    assert!(matches!(
        status,
        DeviceFlowStatus::AwaitingAuthorization {
            next_poll_at: 115,
            ..
        }
    ));
    assert_eq!(flow.next_poll(114).unwrap(), None);
    let ticket = flow.next_poll(115).unwrap().unwrap();
    flow.cancel();
    assert_eq!(
        flow.apply_poll(ticket, DevicePollResult::Authorized, 116),
        Err(AuthError::StalePoll)
    );
    assert_eq!(flow.status(116), DeviceFlowStatus::Cancelled);
    assert!(flow.pending.is_none());
}

#[test]
fn transport_failures_reduce_polling_frequency() {
    let mut flow = DeviceFlow::new();
    flow.start_local(authorization(), 0).unwrap();
    let ticket = flow.next_poll(5).unwrap().unwrap();
    let status = flow
        .apply_poll(ticket, DevicePollResult::TransportFailure, 5)
        .unwrap();
    assert!(matches!(
        status,
        DeviceFlowStatus::AwaitingAuthorization {
            next_poll_at: 15,
            ..
        }
    ));
    assert!(flow.next_poll(14).unwrap().is_none());
}

#[test]
fn expiry_clears_secret_and_rejects_late_authorization() {
    let mut flow = DeviceFlow::new();
    flow.start_local(authorization(), 0).unwrap();
    let ticket = flow.next_poll(5).unwrap().unwrap();
    assert_eq!(flow.status(900), DeviceFlowStatus::Expired);
    assert!(flow.pending.is_none());
    assert_eq!(
        flow.apply_poll(ticket, DevicePollResult::Authorized, 900),
        Err(AuthError::StalePoll)
    );
    assert_eq!(flow.next_poll(901), Err(AuthError::NotPending));
}

#[test]
fn expired_device_codes_cannot_be_read_by_a_delayed_poll() {
    let mut flow = DeviceFlow::new();
    flow.start_local(authorization(), 0).unwrap();
    let ticket = flow.next_poll(5).unwrap().unwrap();
    assert_eq!(
        flow.with_device_code(ticket, 900, |_| ()),
        Err(AuthError::StalePoll)
    );
    assert!(flow.pending.is_none());
}

#[test]
fn previous_flow_tickets_cannot_authorize_a_new_flow() {
    let mut flow = DeviceFlow::new();
    flow.start_local(authorization(), 0).unwrap();
    let old = flow.next_poll(5).unwrap().unwrap();
    flow.start_local(authorization(), 10).unwrap();
    assert_eq!(
        flow.apply_poll(old, DevicePollResult::Authorized, 11),
        Err(AuthError::StalePoll)
    );
    let current = flow.next_poll(15).unwrap().unwrap();
    assert_eq!(
        flow.apply_poll(current, DevicePollResult::Authorized, 16)
            .unwrap(),
        DeviceFlowStatus::Completed
    );
    assert!(flow.pending.is_none());
}

#[test]
fn public_status_and_debug_never_contain_device_code_or_token() {
    let token = SecretToken::new("synthetic-token".into());
    assert_eq!(format!("{token:?}"), "SecretToken([REDACTED])");
    let mut flow = DeviceFlow::new();
    let status = flow.start_local(authorization(), 0).unwrap();
    let public = serde_json::to_string(&status).unwrap();
    assert!(!public.contains("synthetic-device-code"));
    assert!(!public.contains("deviceCode"));
    assert!(public.contains("DEMO-1234"));
}
