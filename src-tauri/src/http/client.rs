// SPDX-License-Identifier: Apache-2.0
//! Shared `reqwest::Client` and in-memory access-token cache.
//!
//! # Token lifecycle
//!
//! Tokens are short-lived. The cache stores one per credential profile and
//! re-exchanges automatically when:
//!   - no cached token exists yet, or
//!   - the cached token has expired (checked against the wall clock).
//!
//! Refresh tokens are NOT used for automatic renewal: they are single-use and
//! replaying one triggers the backend's replay-detection, which revokes every
//! live token on the credential. Automatic refresh is therefore more dangerous
//! than a fresh client-credentials exchange, which is cheap and stateless.
//!
//! # Thread safety
//!
//! The cache is wrapped in a `std::sync::Mutex`. Commands run on Tauri's async
//! executor (tokio), so the lock is held only for the duration of a quick
//! memory read/write — never across an `.await`. `reqwest::Client` is already
//! `Clone + Send + Sync` and is kept in a `once_cell::sync::OnceCell` so the
//! TLS session pool is shared across all calls.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

// ─── Shared HTTP client ───────────────────────────────────────────────────────

static HTTP_CLIENT: std::sync::OnceLock<Client> = std::sync::OnceLock::new();

/// Returns the process-wide `reqwest::Client`.
///
/// Initialised on first call; subsequent calls return a clone of the same
/// instance so the underlying connection pool is always shared.
pub fn http_client() -> Client {
    HTTP_CLIENT
        .get_or_init(|| {
            Client::builder()
                .user_agent(concat!("ConfinaidTestTool/", env!("CARGO_PKG_VERSION")))
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .expect("failed to build reqwest client")
        })
        .clone()
}

// ─── Token cache ─────────────────────────────────────────────────────────────

/// A minted access token and the Unix timestamp (seconds) at which it expires.
#[derive(Debug, Clone)]
#[allow(dead_code)] // refresh_token used by future /v1/token/refresh logic
pub struct CachedToken {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
    /// Space-separated scopes the token grants, as reported by the server.
    pub scope: String,
}

impl CachedToken {
    /// `true` when the token has at least 30 seconds left — enough margin for
    /// a request to complete before the server considers it expired.
    pub fn is_valid(&self) -> bool {
        let now = now_secs();
        self.expires_at > now.saturating_add(30)
    }

    /// The last eight characters of the access token, shown in the UI so the
    /// user can confirm which credential is active without leaking the value.
    pub fn hint(&self) -> String {
        let chars: Vec<char> = self.access_token.chars().collect();
        let hint_len = 8.min(chars.len());
        chars[chars.len() - hint_len..].iter().collect()
    }
}

static TOKEN_CACHE: Mutex<Option<CachedToken>> = Mutex::new(None);

/// Returns the cached token if it is still valid, or `None` otherwise.
pub fn cached_token() -> Option<CachedToken> {
    TOKEN_CACHE
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .filter(|t| t.is_valid())
}

/// Replaces the cached token with a freshly minted one.
pub fn set_cached_token(token: CachedToken) {
    if let Ok(mut guard) = TOKEN_CACHE.lock() {
        *guard = Some(token);
    }
}

/// Evicts the cached token — called when a revoke succeeds.
pub fn clear_cached_token() {
    if let Ok(mut guard) = TOKEN_CACHE.lock() {
        *guard = None;
    }
}

// ─── Token exchange ───────────────────────────────────────────────────────────

/// Wire shape of the `/v1/token` response (OAuth2 client-credentials).
#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
    #[allow(dead_code)] // informational; not needed by the cache
    pub token_type: String,
    pub scope: String,
}

/// Wire shape of an OAuth2-style error body.
#[derive(Debug, Deserialize)]
pub struct TokenErrorBody {
    pub error: String,
    #[serde(default)]
    pub error_description: String,
}

#[derive(Debug, Serialize)]
struct TokenRequest<'a> {
    client_id: &'a str,
    client_secret: &'a str,
}

/// Exchange `(client_id, client_secret)` for an access token.
///
/// Stores the result in the in-memory cache and returns it. The caller never
/// needs to touch the cache directly.
pub async fn exchange_token(
    base_url: &str,
    client_id: &str,
    client_secret: &str,
) -> AppResult<CachedToken> {
    let url = format!("{}/v1/token", base_url.trim_end_matches('/'));
    let client = http_client();

    let resp = client
        .post(&url)
        .json(&TokenRequest {
            client_id,
            client_secret,
        })
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    let status = resp.status();

    if !status.is_success() {
        // Try to surface the OAuth2 error description.
        let body = resp
            .json::<TokenErrorBody>()
            .await
            .unwrap_or(TokenErrorBody {
                error: status.to_string(),
                error_description: String::new(),
            });
        let msg = if body.error_description.is_empty() {
            body.error
        } else {
            format!("{}: {}", body.error, body.error_description)
        };
        return Err(if status.as_u16() == 401 || status.as_u16() == 403 {
            AppError::Unauthorized(msg)
        } else {
            AppError::Network(format!("token exchange failed (HTTP {status}): {msg}"))
        });
    }

    let token_resp: TokenResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("malformed token response: {e}")))?;

    let cached = CachedToken {
        access_token: token_resp.access_token,
        refresh_token: token_resp.refresh_token,
        expires_at: now_secs().saturating_add(token_resp.expires_in),
        scope: token_resp.scope,
    };

    set_cached_token(cached.clone());
    Ok(cached)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
