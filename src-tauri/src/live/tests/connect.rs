//! Connecting accounts: the cache row, the vault commit and what a failure leaves behind.
use super::harness::*;
use crate::auth::SecretToken;
use crate::live::*;
use std::sync::atomic::Ordering;

const ROLLBACK_FAILED: &str = "Anmeldung abgebrochen; der vorherige Tresoreintrag konnte nicht wiederhergestellt werden. Verbinde das Konto erneut oder trenne es.";

/// A commit that wrote the credential and then failed, as a cancel whose rollback failed.
fn stranded(id: &'static str) -> impl FnOnce(&dyn NativeKeyring) -> Result<(), String> {
    move |keyring| {
        keyring
            .write_token(id, &SecretToken::new("synthetic-credential".into()))
            .unwrap();
        Err(ROLLBACK_FAILED.into())
    }
}
fn pin(owner: &str) -> Pin {
    Pin {
        id: format!("pin-{owner}"),
        label: "Fixture pin".into(),
        account_id: owner.into(),
        repo_id: format!("{owner}:1"),
        workflow_id: 9,
        git_ref: "main".into(),
        inputs: Inputs::new(),
        quick_start: false,
    }
}

#[test]
fn a_connected_account_survives_restart_when_its_full_snapshot_cannot_be_written() {
    let mut h = Harness::new("connect", Remote::new(), &[]);
    refuse(&h.path, "%\"name\":\"fixture-1\"%");
    let snapshot = h
        .live
        .connect_account(account("github-1"), commit("github-1"))
        .unwrap();
    assert!(snapshot.repos.iter().any(|repo| repo.id == "github-1:1"));
    assert!(snapshot
        .message
        .as_deref()
        .is_some_and(|message| message.contains(CACHE_NOTICE)));
    assert!(h.vault.holds("github-1"));
    assert_eq!(h.restart().snapshot().accounts, vec![account("github-1")]);
}

#[test]
fn a_connect_whose_account_row_cannot_be_written_stores_no_credential() {
    let mut h = Harness::new("connect-refused", Remote::new(), &[]);
    refuse(&h.path, "%");
    let error = h
        .live
        .connect_account(account("github-1"), commit("github-1"))
        .unwrap_err();
    assert_eq!(error, ACCOUNT_SAVE_FAILED);
    assert!(h.vault.held.lock().unwrap().is_empty());
    assert!(h.live.snapshot().accounts.is_empty());
    assert!(h.remote().requests.is_empty());
}

#[test]
fn a_failed_credential_commit_removes_only_the_new_account_row() {
    let mut h = Harness::new("connect-vault", Remote::new(), &[]);
    // Another account's row and pin, plus a pin and a claim kept under the new account's ID.
    let mut other = empty_snapshot();
    other.accounts = vec![account("github-2")];
    h.live.cache.save_snapshot("github-2", &other).unwrap();
    for owner in ["github-1", "github-2"] {
        h.live.cache.save_pin(owner, &pin(owner)).unwrap();
    }
    let target = DispatchTarget {
        account_id: "github-1".into(),
        repo_id: "github-1:1".into(),
        workflow_id: 9,
        git_ref: "main".into(),
    };
    h.live
        .cache
        .claim_dispatch(&target, "2026-11-01T10:00:00+00:00")
        .unwrap();
    let error = h
        .live
        .connect_account(account("github-1"), |_| {
            Err("Betriebssystem-Tresor nicht verfügbar.".into())
        })
        .unwrap_err();
    assert_eq!(error, "Betriebssystem-Tresor nicht verfügbar.");
    assert_eq!(h.live.cache.account_ids().unwrap(), vec!["github-2"]);
    for owner in ["github-1", "github-2"] {
        assert_eq!(h.live.cache.load_pins(owner).unwrap(), vec![pin(owner)]);
    }
    assert_eq!(h.live.cache.uncertain_starts().unwrap().len(), 1);
    assert!(h.live.snapshot().accounts.is_empty());
    let restarted = h.restart().snapshot();
    assert_eq!(restarted.accounts, vec![account("github-2")]);
    assert_eq!(restarted.pins, vec![pin("github-2")]);
    assert_eq!(restarted.uncertain_starts.len(), 1);
}

#[test]
fn a_failed_reconnect_keeps_the_existing_account_row() {
    let mut h = Harness::new("reconnect", Remote::new(), &[]);
    h.live
        .connect_account(account("github-1"), commit("github-1"))
        .unwrap();
    let error = h
        .live
        .connect_account(account("github-1"), |_| {
            Err("Anmeldung wurde abgebrochen.".into())
        })
        .unwrap_err();
    assert_eq!(error, "Anmeldung wurde abgebrochen.");
    assert_eq!(h.live.cache.account_ids().unwrap(), vec!["github-1"]);
    assert_eq!(h.live.snapshot().accounts, vec![account("github-1")]);
    assert!(h.vault.holds("github-1"));
    assert_eq!(h.restart().snapshot().accounts, vec![account("github-1")]);
}

#[test]
fn a_credential_left_in_the_vault_by_a_failed_commit_is_deleted_again() {
    let mut h = Harness::new("connect-stranded", Remote::new(), &[]);
    let error = h
        .live
        .connect_account(account("github-1"), stranded("github-1"))
        .unwrap_err();
    assert_eq!(error, ROLLBACK_FAILED);
    assert!(!h.vault.holds("github-1"));
    assert!(h.live.cache.account_ids().unwrap().is_empty());
    assert!(h.live.snapshot().accounts.is_empty());
    assert!(h.remote().requests.is_empty());
}

#[test]
fn a_credential_the_vault_will_not_delete_keeps_its_account_so_it_can_be_disconnected() {
    let mut h = Harness::new("connect-orphan", Remote::new(), &[]);
    h.vault.refuse_delete.store(true, Ordering::SeqCst);
    let error = h
        .live
        .connect_account(account("github-1"), stranded("github-1"))
        .unwrap_err();
    let notice = "Der Zugang von fixture-github-1 liegt noch im Tresor – trenne das Konto, um ihn zu entfernen.";
    assert_eq!(error, format!("{ROLLBACK_FAILED} · {notice}"));
    assert!(h.vault.holds("github-1"));
    let snapshot = h.live.snapshot();
    assert_eq!(snapshot.accounts, vec![account("github-1")]);
    assert!(snapshot
        .message
        .as_deref()
        .is_some_and(|message| message.contains(notice)));
    assert_eq!(h.restart().snapshot().accounts, vec![account("github-1")]);
    // Once the vault deletes again, disconnecting removes the entry and the account.
    h.vault.refuse_delete.store(false, Ordering::SeqCst);
    assert!(h.live.disconnect("github-1").unwrap().accounts.is_empty());
    assert!(!h.vault.holds("github-1"));
    assert!(h.restart().snapshot().accounts.is_empty());
}

#[test]
fn a_credential_the_vault_can_neither_read_nor_delete_keeps_its_account() {
    let mut h = Harness::new("connect-unreadable", Remote::new(), &[]);
    h.vault.refuse_read.store(true, Ordering::SeqCst);
    h.vault.refuse_delete.store(true, Ordering::SeqCst);
    let error = h
        .live
        .connect_account(account("github-1"), stranded("github-1"))
        .unwrap_err();
    let notice = "Der Zugang von fixture-github-1 liegt möglicherweise noch im Tresor – trenne das Konto, um ihn zu entfernen.";
    assert_eq!(error, format!("{ROLLBACK_FAILED} · {notice}"));
    assert!(h.vault.holds("github-1"));
    assert_eq!(h.live.cache.account_ids().unwrap(), vec!["github-1"]);
    let snapshot = h.live.snapshot();
    assert_eq!(snapshot.accounts, vec![account("github-1")]);
    assert!(snapshot
        .message
        .as_deref()
        .is_some_and(|message| message.contains(notice)));
    assert!(h.remote().requests.is_empty());
}

#[test]
fn an_unreadable_vault_that_still_deletes_removes_the_new_account_row() {
    let mut h = Harness::new("connect-unreadable-deletes", Remote::new(), &[]);
    h.vault.refuse_read.store(true, Ordering::SeqCst);
    let error = h
        .live
        .connect_account(account("github-1"), stranded("github-1"))
        .unwrap_err();
    assert_eq!(error, ROLLBACK_FAILED);
    assert!(!h.vault.holds("github-1"));
    assert!(h.live.cache.account_ids().unwrap().is_empty());
    assert!(h.live.snapshot().accounts.is_empty());
}
