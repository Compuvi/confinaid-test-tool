// SPDX-License-Identifier: Apache-2.0
//! Filtering profile management through the Partner API.
//!
//! The Filtering page manages the filtering profiles of the active
//! credential's company: `/v1/filtering-profiles*` and `/v1/filtering/*`.
//! Unlike `send_request`, which only knows a fixed set of endpoints, this
//! module forwards a method + path + query + body composed by the frontend.
//! That makes the path the security boundary: a bearer token is attached to
//! whatever URL leaves this module, so nothing goes out unless it matches one
//! of the documented route shapes exactly.
//!
//! ## Path allowlist
//!
//! `{id}` is a canonical 8-4-4-4-12 hex UUID. Uppercase hex is accepted and
//! normalised to lowercase before the URL is built, mirroring the API
//! service (which lowercases ids itself); anything else in an id segment is
//! rejected.
//!
//! | Path                                              | Methods            |
//! |---------------------------------------------------|--------------------|
//! | `/v1/filtering-profiles`                          | GET, POST          |
//! | `/v1/filtering-profiles/{id}`                     | GET, PATCH, DELETE |
//! | `/v1/filtering-profiles/{id}/set-primary`         | POST               |
//! | `/v1/filtering-profiles/{id}/clone`               | POST               |
//! | `/v1/filtering-profiles/{id}/{collection}`        | GET, POST          |
//! | `/v1/filtering-profiles/{id}/{collection}/{id}`   | GET, PATCH, DELETE |
//! | `/v1/filtering-profiles/{id}/label-settings`      | GET, POST          |
//! | `/v1/filtering-profiles/{id}/label-settings/{id}` | GET, PATCH         |
//! | `/v1/filtering-profiles/{id}/logs`                | GET                |
//! | `/v1/filtering/{catalog}`                         | GET                |
//!
//! `{collection}` is `keywords`, `keyword-groups`, `codenames` or
//! `bypass-rules`. `{catalog}` is `labels`, `languages`, `attachments`,
//! `ai-models`, `label-conditions` or `keyword-templates`.
//!
//! Everything else is rejected before a token is acquired: other prefixes,
//! trailing or doubled slashes, `.`/`..` segments, percent-encoding, a query
//! string or fragment embedded in the path, extra segments, and any method
//! the route does not document.
//!
//! ## Authentication
//!
//! The token comes from the shared cache and must belong to the active
//! credential (see `http::client`). A 401 drops that token and retries once
//! with a freshly minted one.
//!
//! ## Query and body
//!
//! Only the documented filter keys are forwarded ([`ALLOWED_QUERY_KEYS`]);
//! others are dropped silently, as the API itself does. GET and DELETE never
//! carry a body. POST and PATCH bodies must be JSON objects; a missing body
//! is sent as `{}` (set-primary and clone accept that).

use std::time::{Duration, Instant};

use reqwest::header::HeaderMap;
use reqwest::{Client, Method, RequestBuilder};
use serde::Deserialize;
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

use super::client::{discard_token, http_client};
use super::endpoints::{acquire_token, active_credential, status_reason, RequestResult};

/// Query keys the Partner API documents for the filtering endpoints. Any
/// other key is dropped before the request is built.
pub const ALLOWED_QUERY_KEYS: &[&str] = &[
    "page",
    "page_size",
    "search",
    "ordering",
    "is_active",
    "language",
    "match_type",
    "parent",
    "top_level",
    "labels",
    "target_type",
    "action",
    "entity",
    "created_after",
    "created_before",
    "region",
];

/// Profile sub-collections with full CRUD.
const CRUD_COLLECTIONS: &[&str] = &["keywords", "keyword-groups", "codenames", "bypass-rules"];

/// Read-only catalogs under `/v1/filtering/`.
const CATALOGS: &[&str] = &[
    "labels",
    "languages",
    "attachments",
    "ai-models",
    "label-conditions",
    "keyword-templates",
];

// ─── Public surface ───────────────────────────────────────────────────────────

/// Parameters of one filtering call, as sent by `commands.filtering.request`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilteringRequestParams {
    /// `GET`, `POST`, `PATCH` or `DELETE` (case-insensitive).
    pub method: String,
    /// Absolute API path, e.g. `/v1/filtering-profiles/{id}/keywords`.
    pub path: String,
    /// Query pairs. Repeating a key (e.g. `labels`) is allowed.
    #[serde(default)]
    pub query: Vec<(String, String)>,
    /// JSON object body for POST / PATCH.
    #[serde(default)]
    pub body: Option<Value>,
    /// Milliseconds before the call is aborted. Defaults to the stored config.
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

/// The four methods the filtering endpoints use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FilteringMethod {
    Get,
    Post,
    Patch,
    Delete,
}

impl FilteringMethod {
    pub fn parse(raw: &str) -> AppResult<Self> {
        match raw.to_ascii_uppercase().as_str() {
            "GET" => Ok(Self::Get),
            "POST" => Ok(Self::Post),
            "PATCH" => Ok(Self::Patch),
            "DELETE" => Ok(Self::Delete),
            _ => Err(AppError::Validation(format!(
                "method {raw:?} is not allowed for filtering requests"
            ))),
        }
    }

    fn as_reqwest(self) -> Method {
        match self {
            Self::Get => Method::GET,
            Self::Post => Method::POST,
            Self::Patch => Method::PATCH,
            Self::Delete => Method::DELETE,
        }
    }

    fn has_body(self) -> bool {
        matches!(self, Self::Post | Self::Patch)
    }
}

/// A path that matched the allowlist, with ids normalised to lowercase.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedRoute {
    pub method: FilteringMethod,
    pub path: String,
}

/// A request that passed every check and is ready to be sent.
#[derive(Debug, Clone, PartialEq)]
pub struct PreparedRequest {
    pub method: FilteringMethod,
    pub path: String,
    pub query: Vec<(String, String)>,
    pub body: Option<Value>,
}

// ─── Validation ───────────────────────────────────────────────────────────────

/// Lowercase form of `segment` if it is a canonical 8-4-4-4-12 hex UUID.
pub fn canonical_uuid(segment: &str) -> Option<String> {
    let bytes = segment.as_bytes();
    if bytes.len() != 36 {
        return None;
    }
    for (i, b) in bytes.iter().enumerate() {
        let ok = match i {
            8 | 13 | 18 | 23 => *b == b'-',
            _ => b.is_ascii_hexdigit(),
        };
        if !ok {
            return None;
        }
    }
    Some(segment.to_ascii_lowercase())
}

fn rejected(path: &str) -> AppError {
    AppError::Validation(format!(
        "path {path:?} is not an allowed filtering endpoint"
    ))
}

fn method_rejected(method: FilteringMethod, path: &str) -> AppError {
    AppError::Validation(format!(
        "{} is not allowed on {path}",
        method.as_reqwest().as_str()
    ))
}

/// Match `path` against the documented route shapes and check that `method`
/// is one the route supports.
pub fn validate_route(method: FilteringMethod, path: &str) -> AppResult<ValidatedRoute> {
    use FilteringMethod::{Delete, Get, Patch, Post};

    let rest = path.strip_prefix("/v1/").ok_or_else(|| rejected(path))?;
    let raw: Vec<&str> = rest.split('/').collect();

    // Literal segments are compared exactly and id segments must be UUIDs, so
    // `..`, `%2e`, `?`, `#`, empty segments and the like can never match.
    let id_at = |i: usize| raw.get(i).and_then(|s| canonical_uuid(s));

    let (segments, allowed): (Vec<String>, &[FilteringMethod]) = match raw.as_slice() {
        ["filtering-profiles"] => (vec!["filtering-profiles".into()], &[Get, Post]),
        ["filtering-profiles", _] => {
            let id = id_at(1).ok_or_else(|| rejected(path))?;
            (vec!["filtering-profiles".into(), id], &[Get, Patch, Delete])
        }
        ["filtering-profiles", _, action @ ("set-primary" | "clone")] => {
            let id = id_at(1).ok_or_else(|| rejected(path))?;
            (
                vec!["filtering-profiles".into(), id, (*action).into()],
                &[Post],
            )
        }
        ["filtering-profiles", _, collection] => {
            let id = id_at(1).ok_or_else(|| rejected(path))?;
            let allowed: &[FilteringMethod] =
                if CRUD_COLLECTIONS.contains(collection) || *collection == "label-settings" {
                    &[Get, Post]
                } else if *collection == "logs" {
                    &[Get]
                } else {
                    return Err(rejected(path));
                };
            (
                vec!["filtering-profiles".into(), id, (*collection).into()],
                allowed,
            )
        }
        ["filtering-profiles", _, collection, _] => {
            let id = id_at(1).ok_or_else(|| rejected(path))?;
            let item = id_at(3).ok_or_else(|| rejected(path))?;
            let allowed: &[FilteringMethod] = if CRUD_COLLECTIONS.contains(collection) {
                &[Get, Patch, Delete]
            } else if *collection == "label-settings" {
                // Label settings are toggled, never deleted — same as the dashboard.
                &[Get, Patch]
            } else {
                return Err(rejected(path));
            };
            (
                vec!["filtering-profiles".into(), id, (*collection).into(), item],
                allowed,
            )
        }
        ["filtering", catalog] if CATALOGS.contains(catalog) => {
            (vec!["filtering".into(), (*catalog).into()], &[Get])
        }
        _ => return Err(rejected(path)),
    };

    if !allowed.contains(&method) {
        return Err(method_rejected(method, path));
    }

    Ok(ValidatedRoute {
        method,
        path: format!("/v1/{}", segments.join("/")),
    })
}

/// Keep only the documented query keys, in their original order.
pub fn filter_query(query: Vec<(String, String)>) -> Vec<(String, String)> {
    query
        .into_iter()
        .filter(|(k, _)| ALLOWED_QUERY_KEYS.contains(&k.as_str()))
        .collect()
}

/// Validate method, path, query and body without touching the network.
pub fn prepare(params: FilteringRequestParams) -> AppResult<PreparedRequest> {
    let method = FilteringMethod::parse(&params.method)?;
    let route = validate_route(method, &params.path)?;

    let body = if method.has_body() {
        match params.body {
            None | Some(Value::Null) => Some(Value::Object(Default::default())),
            Some(v @ Value::Object(_)) => Some(v),
            Some(_) => {
                return Err(AppError::Validation(
                    "the request body must be a JSON object".into(),
                ))
            }
        }
    } else {
        match params.body {
            None | Some(Value::Null) => None,
            Some(_) => {
                return Err(AppError::Validation(format!(
                    "a {} request cannot carry a body",
                    method.as_reqwest().as_str()
                )))
            }
        }
    };

    Ok(PreparedRequest {
        method,
        path: route.path,
        query: filter_query(params.query),
        body,
    })
}

// ─── Request building and response handling ──────────────────────────────────

/// Build the HTTP request for a prepared call. Split out so the method, URL,
/// headers and body can be asserted in unit tests without a server.
pub fn build_request(
    client: &Client,
    base_url: &str,
    prepared: &PreparedRequest,
    bearer: &str,
    timeout_ms: u64,
) -> RequestBuilder {
    let url = format!("{}{}", base_url.trim_end_matches('/'), prepared.path);
    let mut req = client
        .request(prepared.method.as_reqwest(), url)
        .bearer_auth(bearer)
        .timeout(Duration::from_millis(timeout_ms.max(1_000)));
    if !prepared.query.is_empty() {
        req = req.query(&prepared.query);
    }
    if let Some(body) = &prepared.body {
        // `.json` also sets `Content-Type: application/json`, which the API
        // requires on every POST / PATCH.
        req = req.json(body);
    }
    req
}

/// Turn a raw response into the `RequestResult` the UI renders.
///
/// 429 is returned as `AppError::RateLimited`, exactly like the other Partner
/// API calls. A 204 (or any empty body) yields `body: ""`, `is_json: false`.
pub fn into_result(
    status: u16,
    headers: &HeaderMap,
    body_bytes: &[u8],
    url: String,
    duration_ms: u64,
) -> AppResult<RequestResult> {
    if status == 429 {
        let retry_after_ms = headers
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok())
            .map(|secs| secs * 1_000);
        return Err(AppError::RateLimited {
            message: format!("429 Too Many Requests — {url}"),
            retry_after_ms,
        });
    }

    let header_pairs: Vec<[String; 2]> = headers
        .iter()
        .map(|(k, v)| [k.to_string(), v.to_str().unwrap_or("").to_string()])
        .collect();

    let body_text = String::from_utf8_lossy(body_bytes).into_owned();
    let (body, is_json) = if body_text.trim().is_empty() {
        (String::new(), false)
    } else {
        match serde_json::from_str::<Value>(&body_text) {
            Ok(v) => (
                serde_json::to_string_pretty(&v).unwrap_or_else(|_| body_text.clone()),
                true,
            ),
            Err(_) => (body_text, false),
        }
    };

    Ok(RequestResult {
        status,
        status_text: status_reason(status).to_string(),
        duration_ms,
        size_bytes: body_bytes.len(),
        body,
        is_json,
        headers: header_pairs,
        url,
        token_hint: None,
    })
}

/// Raw response of one attempt.
struct RawResponse {
    status: u16,
    headers: HeaderMap,
    body: Vec<u8>,
    url: String,
    duration_ms: u64,
}

async fn send_once(
    base_url: &str,
    prepared: &PreparedRequest,
    bearer: &str,
    timeout_ms: u64,
) -> AppResult<RawResponse> {
    let client = http_client();
    let request = build_request(&client, base_url, prepared, bearer, timeout_ms)
        .build()
        .map_err(|e| AppError::Internal(format!("could not build request: {e}")))?;
    let url = request.url().to_string();

    let started = Instant::now();
    let resp = client.execute(request).await.map_err(|e| {
        if e.is_timeout() {
            AppError::Network(format!("request timed out after {timeout_ms}ms"))
        } else {
            AppError::Network(e.to_string())
        }
    })?;
    let status = resp.status().as_u16();
    let headers = resp.headers().clone();
    let body = resp
        .bytes()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
        .to_vec();
    Ok(RawResponse {
        status,
        headers,
        body,
        url,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

/// A 401 on the first attempt means the cached token was revoked or expired
/// server-side; nothing was processed, so one retry with a fresh token is safe
/// even for writes.
pub fn should_retry_with_fresh_token(status: u16, attempt: u32) -> bool {
    status == 401 && attempt == 0
}

/// Validate, authenticate and send one filtering call for the active profile.
///
/// Order matters: the request is validated, then the active credential is
/// resolved and checked (base URL, client ID, secret), and only then is a
/// token acquired — a rejected path or an incomplete profile never causes
/// network traffic.
pub async fn filtering_request(
    params: FilteringRequestParams,
    state: &AppState,
) -> AppResult<RequestResult> {
    let timeout_override = params.timeout_ms;
    let prepared = prepare(params)?;

    let timeout_ms = match timeout_override {
        Some(ms) => ms,
        None => state.config_snapshot()?.request_timeout_ms,
    };

    let cred = active_credential(state)?;
    let mut attempt = 0;
    loop {
        let token = acquire_token(&cred.owner, &cred.secret).await?;
        let raw = send_once(
            &cred.owner.base_url,
            &prepared,
            &token.access_token,
            timeout_ms,
        )
        .await?;
        if should_retry_with_fresh_token(raw.status, attempt) {
            discard_token(&token.access_token);
            attempt += 1;
            continue;
        }
        return into_result(
            raw.status,
            &raw.headers,
            &raw.body,
            raw.url,
            raw.duration_ms,
        );
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderValue;
    use FilteringMethod::{Delete, Get, Patch, Post};

    const P: &str = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    const I: &str = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

    fn ok(method: FilteringMethod, path: &str) -> String {
        validate_route(method, path)
            .unwrap_or_else(|e| panic!("{method:?} {path} should be allowed: {e}"))
            .path
    }

    fn err(method: FilteringMethod, path: &str) {
        let res = validate_route(method, path);
        assert!(
            matches!(res, Err(AppError::Validation(_))),
            "{method:?} {path} should be rejected, got {res:?}"
        );
    }

    fn params(method: &str, path: &str) -> FilteringRequestParams {
        FilteringRequestParams {
            method: method.into(),
            path: path.into(),
            query: vec![],
            body: None,
            timeout_ms: None,
        }
    }

    // ── Accepted shapes ──────────────────────────────────────────────────────

    #[test]
    fn accepts_every_documented_profile_route() {
        ok(Get, "/v1/filtering-profiles");
        ok(Post, "/v1/filtering-profiles");
        for m in [Get, Patch, Delete] {
            ok(m, &format!("/v1/filtering-profiles/{P}"));
        }
        ok(Post, &format!("/v1/filtering-profiles/{P}/set-primary"));
        ok(Post, &format!("/v1/filtering-profiles/{P}/clone"));
        ok(Get, &format!("/v1/filtering-profiles/{P}/logs"));
    }

    #[test]
    fn accepts_every_documented_sub_resource_route() {
        for c in CRUD_COLLECTIONS {
            for m in [Get, Post] {
                ok(m, &format!("/v1/filtering-profiles/{P}/{c}"));
            }
            for m in [Get, Patch, Delete] {
                ok(m, &format!("/v1/filtering-profiles/{P}/{c}/{I}"));
            }
        }
        for m in [Get, Post] {
            ok(m, &format!("/v1/filtering-profiles/{P}/label-settings"));
        }
        for m in [Get, Patch] {
            ok(m, &format!("/v1/filtering-profiles/{P}/label-settings/{I}"));
        }
    }

    #[test]
    fn accepts_every_catalog() {
        for c in CATALOGS {
            assert_eq!(
                ok(Get, &format!("/v1/filtering/{c}")),
                format!("/v1/filtering/{c}")
            );
        }
    }

    #[test]
    fn normalises_uppercase_uuids_to_lowercase() {
        let upper_p = P.to_ascii_uppercase();
        let upper_i = I.to_ascii_uppercase();
        assert_eq!(
            ok(
                Get,
                &format!("/v1/filtering-profiles/{upper_p}/keywords/{upper_i}")
            ),
            format!("/v1/filtering-profiles/{P}/keywords/{I}")
        );
    }

    // ── Rejected shapes ──────────────────────────────────────────────────────

    #[test]
    fn rejects_unknown_prefixes_and_other_endpoints() {
        for path in [
            "",
            "/",
            "/v1",
            "/v1/",
            "/v1/analyze",
            "/v1/token",
            "/v2/filtering-profiles",
            "v1/filtering-profiles",
            "//v1/filtering-profiles",
            "/V1/filtering-profiles",
            "/v1/Filtering-Profiles",
            "/v1/filtering",
            "/v1/filtering/",
            "/v1/filtering/regions",
            "/v1/filtering-profilesX",
            "https://evil.example/v1/filtering-profiles",
            "/partner/pipeline/filtering/profiles/",
        ] {
            err(Get, path);
        }
    }

    #[test]
    fn rejects_traversal_and_encoded_characters() {
        for path in [
            "/v1/filtering-profiles/..",
            "/v1/filtering-profiles/../token",
            "/v1/filtering/../analyze",
            "/v1/filtering-profiles/./",
            &format!("/v1/filtering-profiles/{P}/../../token"),
            &format!("/v1/filtering-profiles/{P}/keywords/.."),
            "/v1/filtering-profiles/%2e%2e",
            "/v1/filtering%2Dprofiles",
            &format!("/v1/filtering-profiles/{}", P.replace('-', "%2D")),
            "/v1/filtering/labels%3Fregion=x",
            "/v1/filtering/labels?region=x",
            "/v1/filtering/labels#frag",
            "/v1/filtering\\labels",
            &format!("/v1/filtering-profiles/{P}\u{0000}"),
        ] {
            err(Get, path);
        }
    }

    #[test]
    fn rejects_trailing_doubled_and_extra_segments() {
        for path in [
            "/v1/filtering-profiles/",
            &format!("/v1/filtering-profiles/{P}/"),
            &format!("/v1/filtering-profiles//{P}"),
            &format!("/v1/filtering-profiles/{P}/keywords/"),
            &format!("/v1/filtering-profiles/{P}/keywords/{I}/"),
            &format!("/v1/filtering-profiles/{P}/keywords/{I}/extra"),
            &format!("/v1/filtering-profiles/{P}/logs/{I}"),
            &format!("/v1/filtering-profiles/{P}/clone/{I}"),
            "/v1/filtering/labels/extra",
            &format!("/v1/filtering/labels/{I}"),
            &format!("/v1/filtering-profiles/{P}/employees"),
            &format!("/v1/filtering-profiles/{P}/unknown/{I}"),
        ] {
            err(Get, path);
        }
    }

    #[test]
    fn rejects_malformed_ids() {
        for id in [
            "not-a-uuid",
            "3f2b1c4d5e6f4a7b8c9d0e1f2a3b4c5d",
            "{3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d}",
            "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5",
            "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5dd",
            "3f2b1c4g-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
            "3f2b1c4d_5e6f_4a7b_8c9d_0e1f2a3b4c5d",
            " 3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5",
        ] {
            err(Get, &format!("/v1/filtering-profiles/{id}"));
            err(Get, &format!("/v1/filtering-profiles/{P}/keywords/{id}"));
        }
    }

    #[test]
    fn rejects_undocumented_methods_per_route() {
        err(Patch, "/v1/filtering-profiles");
        err(Delete, "/v1/filtering-profiles");
        err(Post, &format!("/v1/filtering-profiles/{P}"));
        err(Get, &format!("/v1/filtering-profiles/{P}/set-primary"));
        err(Delete, &format!("/v1/filtering-profiles/{P}/clone"));
        err(Post, &format!("/v1/filtering-profiles/{P}/logs"));
        err(Delete, &format!("/v1/filtering-profiles/{P}/keywords"));
        err(Post, &format!("/v1/filtering-profiles/{P}/keywords/{I}"));
        // No DELETE on label settings — toggle is_active instead.
        err(
            Delete,
            &format!("/v1/filtering-profiles/{P}/label-settings/{I}"),
        );
        err(Post, "/v1/filtering/labels");
    }

    #[test]
    fn rejects_methods_outside_the_four() {
        for m in ["PUT", "HEAD", "OPTIONS", "TRACE", "CONNECT", "", "G ET"] {
            let res = prepare(params(m, "/v1/filtering-profiles"));
            assert!(matches!(res, Err(AppError::Validation(_))), "{m:?}");
        }
        assert_eq!(FilteringMethod::parse("patch").unwrap(), Patch);
    }

    // ── Query and body ───────────────────────────────────────────────────────

    #[test]
    fn drops_undocumented_query_keys_and_keeps_repeats() {
        let mut p = params("GET", &format!("/v1/filtering-profiles/{P}/label-settings"));
        p.query = vec![
            ("page".into(), "2".into()),
            ("labels".into(), I.into()),
            ("company".into(), "other".into()),
            ("labels".into(), P.into()),
            ("PAGE".into(), "9".into()),
            ("format".into(), "json".into()),
            ("region".into(), P.into()),
        ];
        let prepared = prepare(p).unwrap();
        assert_eq!(
            prepared.query,
            vec![
                ("page".to_string(), "2".to_string()),
                ("labels".to_string(), I.to_string()),
                ("labels".to_string(), P.to_string()),
                ("region".to_string(), P.to_string()),
            ]
        );
    }

    #[test]
    fn every_allowed_query_key_is_kept() {
        let query: Vec<(String, String)> = ALLOWED_QUERY_KEYS
            .iter()
            .map(|k| (k.to_string(), "x".to_string()))
            .collect();
        assert_eq!(filter_query(query.clone()), query);
    }

    #[test]
    fn post_without_body_sends_an_empty_object() {
        let prepared = prepare(params(
            "POST",
            &format!("/v1/filtering-profiles/{P}/set-primary"),
        ))
        .unwrap();
        assert_eq!(prepared.body, Some(serde_json::json!({})));
    }

    #[test]
    fn rejects_non_object_bodies() {
        for body in [
            serde_json::json!([1]),
            serde_json::json!("x"),
            serde_json::json!(3),
        ] {
            let mut p = params("PATCH", &format!("/v1/filtering-profiles/{P}"));
            p.body = Some(body);
            assert!(matches!(prepare(p), Err(AppError::Validation(_))));
        }
    }

    #[test]
    fn rejects_a_body_on_get_and_delete() {
        for m in ["GET", "DELETE"] {
            let mut p = params(m, &format!("/v1/filtering-profiles/{P}"));
            p.body = Some(serde_json::json!({"title": "x"}));
            assert!(matches!(prepare(p), Err(AppError::Validation(_))), "{m}");
        }
        let mut p = params("DELETE", &format!("/v1/filtering-profiles/{P}"));
        p.body = Some(Value::Null);
        assert_eq!(prepare(p).unwrap().body, None);
    }

    #[test]
    fn params_deserialise_from_the_frontend_shape() {
        let p: FilteringRequestParams = serde_json::from_value(serde_json::json!({
            "method": "GET",
            "path": "/v1/filtering-profiles",
            "query": [["page", "1"], ["search", "fin"]],
            "timeoutMs": 5000
        }))
        .unwrap();
        assert_eq!(p.query.len(), 2);
        assert_eq!(p.timeout_ms, Some(5000));
        assert!(p.body.is_none());
    }

    // ── Request building ─────────────────────────────────────────────────────

    #[test]
    fn builds_a_get_with_bearer_and_encoded_query() {
        let mut p = params("GET", "/v1/filtering-profiles");
        p.query = vec![
            ("search".into(), "a&b c".into()),
            ("page".into(), "3".into()),
        ];
        let prepared = prepare(p).unwrap();
        let req = build_request(
            &Client::new(),
            "https://api.example.com/",
            &prepared,
            "tok123",
            5_000,
        )
        .build()
        .unwrap();

        assert_eq!(req.method(), Method::GET);
        assert_eq!(
            req.url().as_str(),
            "https://api.example.com/v1/filtering-profiles?search=a%26b+c&page=3"
        );
        assert_eq!(req.headers()["authorization"], "Bearer tok123");
        assert!(req.body().is_none());
        assert!(req.headers().get("content-type").is_none());
        assert_eq!(req.timeout(), Some(&Duration::from_millis(5_000)));
    }

    #[test]
    fn builds_a_patch_with_json_body() {
        let mut p = params("PATCH", &format!("/v1/filtering-profiles/{P}/keywords/{I}"));
        p.body = Some(serde_json::json!({"is_active": false}));
        let prepared = prepare(p).unwrap();
        let req = build_request(
            &Client::new(),
            "https://api.example.com",
            &prepared,
            "t",
            10,
        )
        .build()
        .unwrap();

        assert_eq!(req.method(), Method::PATCH);
        assert_eq!(
            req.url().as_str(),
            format!("https://api.example.com/v1/filtering-profiles/{P}/keywords/{I}")
        );
        assert_eq!(req.headers()["content-type"], "application/json");
        let body: Value = serde_json::from_slice(req.body().unwrap().as_bytes().unwrap()).unwrap();
        assert_eq!(body, serde_json::json!({"is_active": false}));
        // Timeout floor matches the other Partner API calls.
        assert_eq!(req.timeout(), Some(&Duration::from_millis(1_000)));
    }

    #[test]
    fn builds_a_delete_without_body() {
        let prepared = prepare(params("DELETE", &format!("/v1/filtering-profiles/{P}"))).unwrap();
        let req = build_request(
            &Client::new(),
            "http://localhost:8080",
            &prepared,
            "t",
            5_000,
        )
        .build()
        .unwrap();
        assert_eq!(req.method(), Method::DELETE);
        assert!(req.body().is_none());
        assert_eq!(
            req.url().as_str(),
            format!("http://localhost:8080/v1/filtering-profiles/{P}")
        );
    }

    // ── Response handling ────────────────────────────────────────────────────

    #[test]
    fn a_204_has_an_empty_non_json_body() {
        let res = into_result(204, &HeaderMap::new(), b"", "u".into(), 7).unwrap();
        assert_eq!(res.status, 204);
        assert_eq!(res.status_text, "No Content");
        assert_eq!(res.body, "");
        assert!(!res.is_json);
        assert_eq!(res.size_bytes, 0);
        assert!(res.token_hint.is_none());
    }

    #[test]
    fn json_errors_are_passed_through_with_their_status() {
        let raw = br#"{"error":{"code":"validation_failed","message":"m","details":{"conditions[0].threshold":["bad"]}}}"#;
        let mut headers = HeaderMap::new();
        headers.insert("x-request-id", HeaderValue::from_static("abc"));
        let res = into_result(422, &headers, raw, "u".into(), 1).unwrap();
        assert_eq!(res.status, 422);
        assert!(res.is_json);
        let parsed: Value = serde_json::from_str(&res.body).unwrap();
        assert_eq!(
            parsed["error"]["details"]["conditions[0].threshold"][0],
            "bad"
        );
        assert!(res
            .headers
            .iter()
            .any(|[k, v]| k == "x-request-id" && v == "abc"));
    }

    #[test]
    fn non_json_bodies_are_returned_raw() {
        let res = into_result(502, &HeaderMap::new(), b"Bad Gateway", "u".into(), 1).unwrap();
        assert_eq!(res.body, "Bad Gateway");
        assert!(!res.is_json);
    }

    #[test]
    fn retries_once_on_401_only() {
        assert!(should_retry_with_fresh_token(401, 0));
        assert!(!should_retry_with_fresh_token(401, 1));
        assert!(!should_retry_with_fresh_token(403, 0));
        assert!(!should_retry_with_fresh_token(200, 0));
    }

    #[test]
    fn a_429_is_a_rate_limited_error_with_retry_after() {
        let mut headers = HeaderMap::new();
        headers.insert("retry-after", HeaderValue::from_static("3"));
        let err = into_result(429, &headers, b"{}", "u".into(), 1).unwrap_err();
        match err {
            AppError::RateLimited { retry_after_ms, .. } => assert_eq!(retry_after_ms, Some(3_000)),
            other => panic!("expected RateLimited, got {other:?}"),
        }
    }
}
