// SPDX-License-Identifier: Apache-2.0
//! Confinaid Test Tool — Tauri backend.
//!
//! ## Modules
//!
//! - [`error`]       — `AppError`, the single error type crossing IPC.
//! - [`state`]       — managed `AppState`; config load/save.
//! - [`config`]      — non-secret settings persisted as JSON.
//! - [`credentials`] — OS-keychain custody of the API secret key.
//! - [`commands`]    — Tauri command handlers, thin wrappers over the above.
//!
//! ## Planned modules
//!
//! Named here rather than created as empty stubs, which would only trip
//! `dead_code` under CI's `-D warnings`:
//!
//! - `http/` — `reqwest` client factory and Confinaid endpoint bindings.
//!   Request signing reads the secret from the keychain here; the value must
//!   never be handed back to the webview.
//! - `runner/` — load and rate-limit execution: concurrency governor, latency
//!   histogram, 429/`Retry-After` probe ladder. Progress streams to the UI
//!   over a `tauri::ipc::Channel`, not `emit` — a 500 RPS run would drown the
//!   event bus.
//! - `storage/` — persistence for saved suites and run results.
//! - `commands/{request,suite,report}.rs` — the corresponding command surface.

mod commands;
mod config;
mod credentials;
mod error;
mod state;

use tauri::Manager;

use commands::app::{get_app_version, get_runtime_info};
use commands::credentials::{clear_credentials, load_credentials, save_credentials};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let state: tauri::State<'_, AppState> = app.state();
            // A config that fails to load must not block startup — the user
            // can only fix it from Settings if the window actually opens.
            if let Err(err) = state.load_from_disk(&handle) {
                eprintln!("[setup] could not load config: {err}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // App
            get_app_version,
            get_runtime_info,
            // Credentials
            save_credentials,
            load_credentials,
            clear_credentials,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
