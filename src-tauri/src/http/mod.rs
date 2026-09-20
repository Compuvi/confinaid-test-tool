// SPDX-License-Identifier: Apache-2.0
//! HTTP client for the Confinaid Partner API (`/v1/*`).
//!
//! ## Modules
//!
//! - [`client`]    — shared `reqwest::Client` and in-memory token cache.
//! - [`endpoints`] — typed bindings for every `/v1/` endpoint.
//!
//! ## Security invariant
//!
//! The `client_secret` is read from the OS keychain inside this module and
//! used only to exchange for a short-lived access token. It is never returned
//! to the frontend; the token's last-eight characters are surfaced instead so
//! the user can confirm which credential is active.

pub mod client;
pub mod endpoints;

pub use endpoints::{send_request, RequestResult};
