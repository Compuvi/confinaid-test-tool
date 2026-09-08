// SPDX-License-Identifier: Apache-2.0
//! Tauri command handlers.
//!
//! Commands are kept here rather than alongside domain logic so the domain
//! modules (`config`, `credentials`, and later `http` / `runner`) stay free of
//! `AppHandle` and remain testable under `cargo test --lib`.

pub mod app;
pub mod credentials;
