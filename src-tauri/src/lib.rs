//! RepoTray core. Browser preview uses fixtures; the native shell uses authenticated GitHub APIs.

pub mod auth;
pub mod cache;
pub mod demo;
pub mod github;
pub mod local_auth;
pub mod models;
pub mod popup;
pub mod workflow;

pub use demo::DemoStore;
pub use models::*;

#[cfg(feature = "network")]
pub mod live;
#[cfg(feature = "network")]
pub mod updates;

#[cfg(feature = "network")]
pub mod browser_auth;
