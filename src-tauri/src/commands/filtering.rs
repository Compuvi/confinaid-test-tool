// SPDX-License-Identifier: Apache-2.0
//! Filtering command — the IPC entry point for the Filtering page.
//!
//! Thin glue over `http::filtering`: the path allowlist, query filtering,
//! token acquisition and response shaping all live in the domain module so
//! `cargo test --lib` covers them without a Tauri runtime.

use tauri::State;

use crate::error::AppResult;
use crate::http::filtering::{filtering_request as http_filtering_request, FilteringRequestParams};
use crate::http::RequestResult;
use crate::state::AppState;

/// Send one filtering profile management call for the active credential.
///
/// Called by `commands.filtering.request` on the frontend. The path must
/// match one of the documented `/v1/filtering-profiles*` / `/v1/filtering/*`
/// routes; the bearer token is attached here and never reaches the webview.
#[tauri::command]
pub async fn filtering_request(
    state: State<'_, AppState>,
    params: FilteringRequestParams,
) -> AppResult<RequestResult> {
    http_filtering_request(params, &state).await
}
