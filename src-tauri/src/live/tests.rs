//! Unit tests of the native engine, by topic. Every name is a labelled fixture.

mod browser_permission;
mod local_identity;
/// The refresh and dispatch orchestration against a synthetic GitHub. No real account,
/// token or repository is involved; every name below is a labelled fixture.
mod orchestration;
mod refresh_scope;
mod store;
