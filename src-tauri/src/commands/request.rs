// SPDX-License-Identifier: Apache-2.0
//! Request command — the single IPC entry point for the Requests page.
//!
//! Thin glue: deserialise params from the frontend, delegate to `http::send_request`,
//! and let `AppError` serialise any failure into the `{ code, message, details }`
//! shape the frontend already parses.

use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::http::endpoints::{
    get_token_status as http_get_token_status, SendRequestParams, TokenHint,
};
use crate::http::{send_request as http_send, RequestResult};
use crate::state::AppState;

/// Fire one request against the Confinaid Partner API.
///
/// Called by `commands.request.send` on the frontend. `body` is the exact JSON
/// the user composed; this command is responsible for injecting credentials
/// and the bearer token — the frontend never holds the secret.
#[tauri::command]
pub async fn send_request(
    app: AppHandle,
    state: State<'_, AppState>,
    params: SendRequestParams,
) -> AppResult<RequestResult> {
    http_send(params, &state, &app).await
}

/// Return the cached token hint without making a network call.
///
/// Used on page load so the UI can show "token active / no token" instantly.
#[tauri::command]
pub fn get_token_status() -> Option<TokenHint> {
    http_get_token_status()
}
