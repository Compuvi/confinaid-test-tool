// SPDX-License-Identifier: Apache-2.0
//! HTTP client for the Confinaid Partner API (`/v1/*`).
//!
//! ## Modules
//!
//! - [`client`]    — shared `reqwest::Client` and in-memory token cache.
//! - [`endpoints`] — typed bindings for every `/v1/` endpoint.
//! - [`filtering`] — allowlisted pass-through for `/v1/filtering-profiles*`
//!   and `/v1/filtering/*` (filtering profile management).
//! - [`clients`]   — allowlisted pass-through for `/v1/clients*` (client
//!   management), sharing the filtering module's send path.
//!
//! ## Security invariant
//!
//! The `client_secret` is read from the OS keychain inside this module and
//! used only to exchange for a short-lived access token. It is never returned
//! to the frontend; the token's last-eight characters are surfaced instead so
//! the user can confirm which credential is active.

pub mod client;
pub mod clients;
pub mod endpoints;
pub mod filtering;

pub use endpoints::{send_request, RequestResult};
