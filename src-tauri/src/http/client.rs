// SPDX-License-Identifier: Apache-2.0
//! Shared `reqwest::Client` and in-memory access-token cache.
//!
//! # Token lifecycle
//!
//! The process holds at most ONE cached token, and it is tagged with the
//! credential that minted it ([`TokenOwner`]: profile name, client ID and API
//! base URL). A cached token is only handed out to a caller asking for that
//! exact owner, and only while it has at least 30 seconds left; otherwise the
//! caller performs a fresh client-credentials exchange.
//!
//! Every credential change (save, switch, delete) calls [`invalidate_tokens`],
//! which clears the cache and bumps a generation counter. An exchange that
//! started under an older generation still returns its token to its own
//! caller, but is never stored — so a slow exchange for the previous
//! credential cannot repopulate the cache after a switch.
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
//! `Clone + Send + Sync` and is kept in a `std::sync::OnceLock` so the TLS
//! session pool is shared across all calls.

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

/// The credential a token was minted for. Two owners are the same credential
/// only if all three fields match.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenOwner {
    pub profile: String,
    pub client_id: String,
    pub base_url: String,
}

impl TokenOwner {
    pub fn new(profile: &str, client_id: &str, base_url: &str) -> Self {
        Self {
            profile: profile.to_string(),
            client_id: client_id.trim().to_string(),
            base_url: base_url.trim().trim_end_matches('/').to_string(),
        }
    }
}

/// A minted access token, its owner and the Unix timestamp (seconds) at which
/// it expires.
#[derive(Debug, Clone)]
pub struct CachedToken {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
    /// Space-separated scopes the token grants, as reported by the server.
    pub scope: String,
    pub owner: TokenOwner,
}

impl CachedToken {
    /// `true` when the token has at least 30 seconds left at `now` — enough
    /// margin for a request to complete before the server considers it expired.
    pub fn is_valid_at(&self, now: u64) -> bool {
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

/// The cache state. Pure data so the ownership rules are unit-testable; the
/// process-wide instance lives in [`TOKEN_CACHE`].
#[derive(Debug, Default)]
pub struct TokenCache {
    generation: u64,
    token: Option<CachedToken>,
}

impl TokenCache {
    pub const fn new() -> Self {
        Self {
            generation: 0,
            token: None,
        }
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// The cached token if it belongs to `owner` and is still valid at `now`.
    pub fn get(&self, owner: &TokenOwner, now: u64) -> Option<CachedToken> {
        self.token
            .as_ref()
            .filter(|t| &t.owner == owner && t.is_valid_at(now))
            .cloned()
    }

    /// Store `token` unless the credentials changed since `generation` was
    /// read. Returns whether it was stored.
    pub fn store(&mut self, token: CachedToken, generation: u64) -> bool {
        if generation != self.generation {
            return false;
        }
        self.token = Some(token);
        true
    }

    /// Forget the token and make every in-flight exchange stale.
    pub fn invalidate(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.token = None;
    }

    /// Whether `refresh_token` belongs to the token chain cached for `owner`
    /// (expiry of the access token does not matter here).
    pub fn owns_refresh(&self, owner: &TokenOwner, refresh_token: &str) -> bool {
        self.token
            .as_ref()
            .is_some_and(|t| &t.owner == owner && t.refresh_token == refresh_token)
    }
}

static TOKEN_CACHE: Mutex<TokenCache> = Mutex::new(TokenCache::new());

fn with_cache<R>(f: impl FnOnce(&mut TokenCache) -> R) -> Option<R> {
    TOKEN_CACHE.lock().ok().map(|mut g| f(&mut g))
}

/// Current credential generation. Read it before an exchange and pass it to
/// [`store_token`] afterwards.
pub fn token_generation() -> u64 {
    with_cache(|c| c.generation()).unwrap_or(u64::MAX)
}

/// The cached token for `owner`, if any and still valid.
pub fn cached_token_for(owner: &TokenOwner) -> Option<CachedToken> {
    with_cache(|c| c.get(owner, now_secs())).flatten()
}

/// Cache `token` if the credentials did not change since `generation`.
pub fn store_token(token: CachedToken, generation: u64) -> bool {
    with_cache(|c| c.store(token, generation)).unwrap_or(false)
}

/// Clear the cache and invalidate in-flight exchanges. Call on every
/// credential change and when the user asks for a fresh token.
pub fn invalidate_tokens() {
    with_cache(TokenCache::invalidate);
}

/// Whether `refresh_token` was issued with the token cached for `owner`.
pub fn owns_refresh_token(owner: &TokenOwner, refresh_token: &str) -> bool {
    with_cache(|c| c.owns_refresh(owner, refresh_token)).unwrap_or(false)
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

/// Exchange the owner's client ID and `client_secret` for an access token.
///
/// Stores the result in the in-memory cache (unless the credentials changed
/// meanwhile) and returns it. The caller never needs to touch the cache.
pub async fn exchange_token(owner: &TokenOwner, client_secret: &str) -> AppResult<CachedToken> {
    // Read before the request: if the credentials change while it is in
    // flight, the result is returned to this caller but not cached.
    let generation = token_generation();
    let base_url = owner.base_url.as_str();
    let client_id = owner.client_id.as_str();
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
        owner: owner.clone(),
    };

    store_token(cached.clone(), generation);
    Ok(cached)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner(profile: &str, client: &str, base: &str) -> TokenOwner {
        TokenOwner::new(profile, client, base)
    }

    fn token(owner: &TokenOwner, access: &str, expires_at: u64) -> CachedToken {
        CachedToken {
            access_token: access.into(),
            refresh_token: format!("{access}-refresh"),
            expires_at,
            scope: "analyze".into(),
            owner: owner.clone(),
        }
    }

    const NOW: u64 = 1_000_000;

    #[test]
    fn only_the_owner_gets_the_cached_token() {
        let a = owner("a", "client-a", "https://api.example.com");
        let mut cache = TokenCache::new();
        assert!(cache.store(token(&a, "tok-a", NOW + 600), cache.generation()));

        assert_eq!(cache.get(&a, NOW).unwrap().access_token, "tok-a");
        // Same profile name, different client or base URL: a different credential.
        assert!(cache
            .get(&owner("a", "client-b", "https://api.example.com"), NOW)
            .is_none());
        assert!(cache
            .get(&owner("a", "client-a", "https://beta.example.com"), NOW)
            .is_none());
        assert!(cache
            .get(&owner("b", "client-a", "https://api.example.com"), NOW)
            .is_none());
    }

    #[test]
    fn owner_normalises_whitespace_and_trailing_slash() {
        assert_eq!(
            owner("a", " c ", "https://api.example.com/"),
            owner("a", "c", "https://api.example.com")
        );
    }

    #[test]
    fn expired_or_nearly_expired_tokens_are_not_returned() {
        let a = owner("a", "c", "u");
        let mut cache = TokenCache::new();
        cache.store(token(&a, "t", NOW + 30), cache.generation());
        assert!(cache.get(&a, NOW).is_none());
        cache.store(token(&a, "t", NOW + 31), cache.generation());
        assert!(cache.get(&a, NOW).is_some());
    }

    #[test]
    fn an_exchange_finishing_after_a_credential_change_is_not_stored() {
        let a = owner("a", "client-a", "u");
        let b = owner("b", "client-b", "u");
        let mut cache = TokenCache::new();

        // A's exchange starts…
        let started = cache.generation();
        // …the user switches to B…
        cache.invalidate();
        // …A's exchange completes late.
        assert!(!cache.store(token(&a, "tok-a", NOW + 600), started));
        assert!(cache.get(&a, NOW).is_none());
        assert!(cache.get(&b, NOW).is_none());

        // B's own exchange, started after the switch, is stored.
        assert!(cache.store(token(&b, "tok-b", NOW + 600), cache.generation()));
        assert_eq!(cache.get(&b, NOW).unwrap().access_token, "tok-b");
    }

    #[test]
    fn invalidate_clears_the_token() {
        let a = owner("a", "c", "u");
        let mut cache = TokenCache::new();
        cache.store(token(&a, "t", NOW + 600), cache.generation());
        cache.invalidate();
        assert!(cache.get(&a, NOW).is_none());
    }

    #[test]
    fn refresh_tokens_are_matched_to_their_owner() {
        let a = owner("a", "c", "u");
        let mut cache = TokenCache::new();
        // Expired access token: the refresh token still identifies the chain.
        cache.store(token(&a, "t", NOW - 10), cache.generation());
        assert!(cache.owns_refresh(&a, "t-refresh"));
        assert!(!cache.owns_refresh(&a, "other-refresh"));
        assert!(!cache.owns_refresh(&owner("b", "c", "u"), "t-refresh"));
    }
}
