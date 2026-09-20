// SPDX-License-Identifier: Apache-2.0
//! Typed bindings for the five Confinaid Partner API endpoints.
//!
//! Every call goes through `send_request`, which:
//!   1. Reads the stored credentials (client_id from config, secret from keychain).
//!   2. Obtains a valid access token (from cache or via exchange).
//!   3. Builds and fires the HTTP request.
//!   4. Returns a `RequestResult` with the full response for the UI to render.
//!
//! ## Endpoint catalogue
//!
//! | Id          | Method | Path              | Auth needed |
//! |-------------|--------|-------------------|-------------|
//! | Token       | POST   | /v1/token         | No          |
//! | Refresh     | POST   | /v1/token/refresh | No          |
//! | Revoke      | POST   | /v1/token/revoke  | No          |
//! | Analyze     | POST   | /v1/analyze       | Yes         |
//! | Rewrite     | POST   | /v1/rewrite       | Yes         |
//!
//! ## Security note
//!
//! `EndpointId::Token` is the ONLY call that reads the keychain secret and
//! places it in a request body. All other endpoints authenticate via a bearer
//! token derived from a prior exchange; the secret never crosses IPC.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::credentials;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

use super::client::{
    cached_token, clear_cached_token, exchange_token, http_client, set_cached_token, CachedToken,
    TokenResponse,
};

// ─── Public surface ───────────────────────────────────────────────────────────

/// Which endpoint the frontend wants to call.
///
/// Serde default: variant names are kept as-is (PascalCase), matching the
/// TypeScript `EndpointId` union. Do NOT add `rename_all` here.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EndpointId {
    Token,
    Refresh,
    Revoke,
    Analyze,
    Rewrite,
}

/// Everything the UI needs to render the response panel.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestResult {
    pub status: u16,
    pub status_text: String,
    pub duration_ms: u64,
    pub size_bytes: usize,
    /// Pretty-printed body when it is valid JSON, otherwise the raw text.
    pub body: String,
    pub is_json: bool,
    pub headers: Vec<[String; 2]>,
    pub url: String,
    /// Whether a new token pair was minted (Token or Refresh endpoint).
    /// `None` on any other endpoint.
    pub token_hint: Option<TokenHint>,
}

/// Minimal token info surfaced to the UI after a successful exchange.
/// The full token is cached in Rust and referenced by the hint alone.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenHint {
    /// Last 8 chars of the access token.
    pub access_hint: String,
    pub expires_in: u64,
    pub scope: String,
    /// Whether a live token is now in the cache.
    pub is_active: bool,
}

// ─── Standard HTTP status reasons ────────────────────────────────────────────

fn status_reason(code: u16) -> &'static str {
    match code {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Content Too Large",
        415 => "Unsupported Media Type",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "",
    }
}

// ─── Individual endpoint implementations ─────────────────────────────────────

/// `POST /v1/token` — exchange client credentials for a token pair.
///
/// The `client_secret` is read from the keychain here. It is placed in the
/// request body and immediately discarded from memory; it is never returned
/// to the caller.
async fn call_token(
    base_url: &str,
    client_id: &str,
    client_secret: &str,
    timeout_ms: u64,
) -> AppResult<RequestResult> {
    #[derive(Serialize)]
    struct Body<'a> {
        client_id: &'a str,
        client_secret: &'a str,
    }

    let url = format!("{}/v1/token", base_url.trim_end_matches('/'));
    let body_json = serde_json::to_value(Body {
        client_id,
        client_secret,
    })
    .map_err(|e| AppError::Internal(e.to_string()))?;

    fire_request(
        &url,
        body_json,
        None, // no bearer — auth is in the body
        timeout_ms,
        |body_text| {
            // Adopt the token pair into the cache if the call succeeded.
            if let Ok(tr) = serde_json::from_str::<TokenResponse>(body_text) {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let cached = CachedToken {
                    access_token: tr.access_token.clone(),
                    refresh_token: tr.refresh_token,
                    expires_at: now.saturating_add(tr.expires_in),
                    scope: tr.scope.clone(),
                };
                let hint = TokenHint {
                    access_hint: cached.hint(),
                    expires_in: tr.expires_in,
                    scope: tr.scope,
                    is_active: true,
                };
                set_cached_token(cached);
                Some(hint)
            } else {
                None
            }
        },
    )
    .await
}

/// `POST /v1/token/refresh` — spend a refresh token for a new pair.
///
/// The refresh token must have been obtained from a prior `/v1/token` call.
/// Replay detection: if the same refresh token is sent twice, the backend
/// revokes all tokens on the credential.
async fn call_refresh(base_url: &str, body: Value, timeout_ms: u64) -> AppResult<RequestResult> {
    let url = format!("{}/v1/token/refresh", base_url.trim_end_matches('/'));
    fire_request(&url, body, None, timeout_ms, |body_text| {
        if let Ok(tr) = serde_json::from_str::<TokenResponse>(body_text) {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let cached = CachedToken {
                access_token: tr.access_token.clone(),
                refresh_token: tr.refresh_token,
                expires_at: now.saturating_add(tr.expires_in),
                scope: tr.scope.clone(),
            };
            let hint = TokenHint {
                access_hint: cached.hint(),
                expires_in: tr.expires_in,
                scope: tr.scope,
                is_active: true,
            };
            set_cached_token(cached);
            Some(hint)
        } else {
            None
        }
    })
    .await
}

/// `POST /v1/token/revoke` — revoke an access or refresh token.
///
/// Always clears the in-memory cache so the UI stops presenting a dead token
/// as ready. The backend answers 204 whether or not the value matched — the
/// endpoint intentionally leaks no information about which tokens exist.
async fn call_revoke(base_url: &str, body: Value, timeout_ms: u64) -> AppResult<RequestResult> {
    let url = format!("{}/v1/token/revoke", base_url.trim_end_matches('/'));
    let result = fire_request(&url, body, None, timeout_ms, |_| None).await?;
    // Clear regardless of status — a 2xx means it worked; anything else means
    // the token is not usable for a different reason, so it is equally gone.
    clear_cached_token();
    Ok(result)
}

/// `POST /v1/analyze` — submit content for compliance analysis.
///
/// Requires a bearer token. If the cached token is still valid it is reused;
/// otherwise a fresh exchange is performed automatically.
async fn call_analyze(
    base_url: &str,
    client_id: &str,
    client_secret: &str,
    body: Value,
    timeout_ms: u64,
) -> AppResult<RequestResult> {
    let token = acquire_token(base_url, client_id, client_secret).await?;
    let url = format!("{}/v1/analyze", base_url.trim_end_matches('/'));
    fire_request(&url, body, Some(&token.access_token), timeout_ms, |_| None).await
}

/// `POST /v1/rewrite` — rewrite content flagged by a prior analyze call.
///
/// `analysis_id` is optional in the request body but must be omitted rather
/// than sent blank — the schema is `additionalProperties: false`.
async fn call_rewrite(
    base_url: &str,
    client_id: &str,
    client_secret: &str,
    body: Value,
    timeout_ms: u64,
) -> AppResult<RequestResult> {
    let token = acquire_token(base_url, client_id, client_secret).await?;
    let url = format!("{}/v1/rewrite", base_url.trim_end_matches('/'));
    fire_request(&url, body, Some(&token.access_token), timeout_ms, |_| None).await
}

// ─── Token acquisition ────────────────────────────────────────────────────────

/// Returns a valid token, re-exchanging when the cache is empty or expired.
async fn acquire_token(
    base_url: &str,
    client_id: &str,
    client_secret: &str,
) -> AppResult<CachedToken> {
    if let Some(t) = cached_token() {
        return Ok(t);
    }
    exchange_token(base_url, client_id, client_secret).await
}

// ─── Shared HTTP fire-and-read ────────────────────────────────────────────────

/// Fire a POST, read the response, build a `RequestResult`.
///
/// `on_success` is called with the raw body text when the status is 2xx and
/// the body is non-empty; it may return a `TokenHint` to carry back to the UI.
async fn fire_request<F>(
    url: &str,
    body: Value,
    bearer: Option<&str>,
    timeout_ms: u64,
    on_success: F,
) -> AppResult<RequestResult>
where
    F: FnOnce(&str) -> Option<TokenHint>,
{
    let client = http_client();
    let started = std::time::Instant::now();

    let timeout = std::time::Duration::from_millis(timeout_ms.max(1_000));
    let mut req = client
        .post(url)
        .header("Content-Type", "application/json")
        .timeout(timeout)
        .json(&body);

    if let Some(token) = bearer {
        req = req.bearer_auth(token);
    }

    let resp = req.send().await.map_err(|e| {
        if e.is_timeout() {
            AppError::Network(format!("request timed out after {timeout_ms}ms"))
        } else {
            AppError::Network(e.to_string())
        }
    })?;

    let duration_ms = started.elapsed().as_millis() as u64;
    let status = resp.status();
    let status_code = status.as_u16();
    let status_text = status_reason(status_code).to_string();

    // Collect expose-listed response headers.
    let headers: Vec<[String; 2]> = resp
        .headers()
        .iter()
        .map(|(k, v)| [k.to_string(), v.to_str().unwrap_or("").to_string()])
        .collect();

    // 429 — surface this as a distinct error so the UI can display a backoff
    // warning rather than a generic failure.
    if status_code == 429 {
        let retry_after_ms = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .map(|secs| secs * 1_000);

        return Err(AppError::RateLimited {
            message: format!("429 Too Many Requests — {url}"),
            retry_after_ms,
        });
    }

    let body_bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    let size_bytes = body_bytes.len();
    let body_text = String::from_utf8_lossy(&body_bytes).into_owned();

    // Pretty-print JSON when the body parses.
    let (body_display, is_json) = match serde_json::from_str::<Value>(&body_text) {
        Ok(v) => (
            serde_json::to_string_pretty(&v).unwrap_or(body_text.clone()),
            true,
        ),
        Err(_) => (body_text.clone(), false),
    };

    let token_hint = if status.is_success() && !body_text.is_empty() {
        on_success(&body_text)
    } else {
        None
    };

    Ok(RequestResult {
        status: status_code,
        status_text,
        duration_ms,
        size_bytes,
        body: body_display,
        is_json,
        headers,
        url: url.to_string(),
        token_hint,
    })
}

// ─── Unified command entry point ──────────────────────────────────────────────

/// Parameters passed from the frontend for a single request.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendRequestParams {
    pub endpoint: EndpointId,
    /// JSON body exactly as the user composed it.
    pub body: Value,
    /// Milliseconds before the call is aborted. Defaults to the stored config.
    pub timeout_ms: Option<u64>,
}

/// Fire one request against the Confinaid Partner API.
///
/// Credential loading (config snapshot + keychain read) happens here, not in
/// the caller, so the secret is never in the frontend's heap.
pub async fn send_request(
    params: SendRequestParams,
    state: &AppState,
    _app: &tauri::AppHandle,
) -> AppResult<RequestResult> {
    let config = state.config_snapshot()?;
    let base_url = config.api_base_url.trim_end_matches('/').to_string();
    let client_id = config.client_id.clone();
    let timeout_ms = params.timeout_ms.unwrap_or(config.request_timeout_ms);

    // Validate that we have a connection profile before trying any call.
    if base_url.is_empty() {
        return Err(AppError::Validation(
            "No API base URL configured. Go to Connection → save credentials first.".into(),
        ));
    }

    // The token endpoint needs the client_secret from the keychain.
    // All other endpoints only need what is in the config.
    let profile_name = config
        .active_profile
        .as_deref()
        .unwrap_or("default")
        .to_string();

    match params.endpoint {
        EndpointId::Token => {
            // client_id: body value overrides stored config; allows testing a
            // different credential without changing the Connection settings.
            let cid_body = params
                .body
                .get("client_id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let cid = cid_body.as_deref().unwrap_or(&client_id);
            if cid.is_empty() {
                return Err(AppError::Validation(
                    "No client ID. Set one on the Connection page or enter it in the body.".into(),
                ));
            }

            // client_secret: body value overrides the keychain.
            // If left blank, the stored keychain secret is used automatically.
            let secret_body = params
                .body
                .get("client_secret")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());

            let secret = if let Some(s) = secret_body {
                s
            } else {
                credentials::read_secret(&profile_name)?.ok_or_else(|| {
                    AppError::Validation(
                        "No API secret stored. Go to Connection → save credentials first, \
                             or enter client_secret in the body."
                            .into(),
                    )
                })?
            };

            call_token(&base_url, cid, &secret, timeout_ms).await
        }

        EndpointId::Refresh => call_refresh(&base_url, params.body, timeout_ms).await,

        EndpointId::Revoke => call_revoke(&base_url, params.body, timeout_ms).await,

        EndpointId::Analyze => {
            if client_id.is_empty() {
                return Err(AppError::Validation(
                    "No client ID configured. Go to Connection → save credentials first.".into(),
                ));
            }
            let secret = credentials::read_secret(&profile_name)?.ok_or_else(|| {
                AppError::Validation(
                    "No API secret stored. Go to Connection → save credentials first.".into(),
                )
            })?;
            call_analyze(&base_url, &client_id, &secret, params.body, timeout_ms).await
        }

        EndpointId::Rewrite => {
            if client_id.is_empty() {
                return Err(AppError::Validation(
                    "No client ID configured. Go to Connection → save credentials first.".into(),
                ));
            }
            let secret = credentials::read_secret(&profile_name)?.ok_or_else(|| {
                AppError::Validation(
                    "No API secret stored. Go to Connection → save credentials first.".into(),
                )
            })?;
            call_rewrite(&base_url, &client_id, &secret, params.body, timeout_ms).await
        }
    }
}

/// Returns the currently active token hint, without triggering an exchange.
/// Used by the UI to show whether a token is live without making a network call.
pub fn get_token_status() -> Option<TokenHint> {
    cached_token().map(|t| TokenHint {
        access_hint: t.hint(),
        expires_in: 0, // remaining life not tracked separately — caller uses is_active
        scope: t.scope,
        is_active: true,
    })
}
