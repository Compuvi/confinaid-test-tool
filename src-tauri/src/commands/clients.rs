// SPDX-License-Identifier: Apache-2.0
//! Clients command — the IPC entry point for the Clients page.
//!
//! Thin glue over `http::clients`: the path allowlist, query filtering,
//! token acquisition and response shaping all live in the domain module so
//! `cargo test --lib` covers them without a Tauri runtime.

use tauri::State;

use crate::error::AppResult;
use crate::http::clients::{clients_request as http_clients_request, ClientsRequestParams};
use crate::http::RequestResult;
use crate::state::AppState;

/// Send one client management call for the active credential.
///
/// Called by `commands.clients.request` on the frontend. The path must match
/// `/v1/clients` or `/v1/clients/{id}`; the bearer token is attached here and
/// never reaches the webview.
#[tauri::command]
pub async fn clients_request(
    state: State<'_, AppState>,
    params: ClientsRequestParams,
) -> AppResult<RequestResult> {
    http_clients_request(params, &state).await
}
