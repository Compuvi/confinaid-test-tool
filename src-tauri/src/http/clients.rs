// SPDX-License-Identifier: Apache-2.0
//! Client management through the Partner API.
//!
//! The Clients page manages the end customers ("clients") of the active
//! credential's company: `/v1/clients` and `/v1/clients/{id}`. Like
//! `http::filtering`, this forwards a method + path + query + body composed
//! by the frontend, so the path is the security boundary: a bearer token is
//! attached to whatever URL leaves this module, and nothing goes out unless it
//! matches one of the documented route shapes exactly.
//!
//! ## Path allowlist
//!
//! | Path               | Methods            |
//! |--------------------|--------------------|
//! | `/v1/clients`      | GET, POST          |
//! | `/v1/clients/{id}` | GET, PATCH, DELETE |
//!
//! `{id}` is a canonical UUID, normalised to lowercase (see
//! [`canonical_uuid`]). Everything else is rejected before a token is
//! acquired, with the same rules as the filtering pass-through.
//!
//! ## Authentication, query and body
//!
//! Shared with `http::filtering`: the token belongs to the active credential
//! and a 401 retries once with a fresh one; only [`ALLOWED_QUERY_KEYS`] are
//! forwarded; POST / PATCH bodies must be JSON objects.

use crate::error::{AppError, AppResult};
use crate::state::AppState;

use super::endpoints::RequestResult;
use super::filtering::{
    canonical_uuid, prepare_body, send_prepared, FilteringMethod, FilteringRequestParams,
    PreparedRequest, ValidatedRoute,
};

/// Query keys the Partner API documents for `GET /v1/clients`. Any other key
/// is dropped before the request is built.
pub const ALLOWED_QUERY_KEYS: &[&str] = &[
    "page",
    "page_size",
    "search",
    "is_active",
    "external_id",
    "filtering_profile_id",
    "ordering",
];

/// Parameters of one clients call, as sent by `commands.clients.request`.
/// Same wire shape as a filtering call.
pub type ClientsRequestParams = FilteringRequestParams;

fn rejected(path: &str) -> AppError {
    AppError::Validation(format!("path {path:?} is not an allowed clients endpoint"))
}

fn parse_method(raw: &str) -> AppResult<FilteringMethod> {
    FilteringMethod::parse(raw).map_err(|_| {
        AppError::Validation(format!(
            "method {raw:?} is not allowed for clients requests"
        ))
    })
}

/// Match `path` against the documented route shapes and check that `method`
/// is one the route supports.
pub fn validate_route(method: FilteringMethod, path: &str) -> AppResult<ValidatedRoute> {
    use FilteringMethod::{Delete, Get, Patch, Post};

    let rest = path.strip_prefix("/v1/").ok_or_else(|| rejected(path))?;
    let raw: Vec<&str> = rest.split('/').collect();

    let (normalised, allowed): (String, &[FilteringMethod]) = match raw.as_slice() {
        ["clients"] => ("/v1/clients".into(), &[Get, Post]),
        ["clients", id] => {
            let id = canonical_uuid(id).ok_or_else(|| rejected(path))?;
            (format!("/v1/clients/{id}"), &[Get, Patch, Delete])
        }
        _ => return Err(rejected(path)),
    };

    if !allowed.contains(&method) {
        return Err(AppError::Validation(format!(
            "{} is not allowed on {path}",
            method.as_reqwest().as_str()
        )));
    }

    Ok(ValidatedRoute {
        method,
        path: normalised,
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
pub fn prepare(params: ClientsRequestParams) -> AppResult<PreparedRequest> {
    let method = parse_method(&params.method)?;
    let route = validate_route(method, &params.path)?;
    let body = prepare_body(method, params.body)?;
    Ok(PreparedRequest {
        method,
        path: route.path,
        query: filter_query(params.query),
        body,
    })
}

/// Validate, authenticate and send one clients call for the active profile.
///
/// A rejected path never causes network traffic: validation runs before the
/// credential is resolved or a token is acquired.
pub async fn clients_request(
    params: ClientsRequestParams,
    state: &AppState,
) -> AppResult<RequestResult> {
    let timeout_override = params.timeout_ms;
    let prepared = prepare(params)?;
    send_prepared(&prepared, timeout_override, state).await
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use FilteringMethod::{Delete, Get, Patch, Post};

    const C: &str = "6f1c2a1e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

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

    fn params(method: &str, path: &str) -> ClientsRequestParams {
        FilteringRequestParams {
            method: method.into(),
            path: path.into(),
            query: vec![],
            body: None,
            timeout_ms: None,
        }
    }

    #[test]
    fn accepts_every_documented_route() {
        assert_eq!(ok(Get, "/v1/clients"), "/v1/clients");
        assert_eq!(ok(Post, "/v1/clients"), "/v1/clients");
        for m in [Get, Patch, Delete] {
            assert_eq!(
                ok(m, &format!("/v1/clients/{C}")),
                format!("/v1/clients/{C}")
            );
        }
    }

    #[test]
    fn normalises_uppercase_uuids_to_lowercase() {
        assert_eq!(
            ok(Get, &format!("/v1/clients/{}", C.to_ascii_uppercase())),
            format!("/v1/clients/{C}")
        );
    }

    #[test]
    fn rejects_other_endpoints_and_prefixes() {
        for path in [
            "",
            "/",
            "/v1",
            "/v1/",
            "/v1/analyze",
            "/v1/token",
            "/v1/filtering-profiles",
            "/v2/clients",
            "v1/clients",
            "//v1/clients",
            "/V1/clients",
            "/v1/Clients",
            "/v1/clientsX",
            "https://evil.example/v1/clients",
            "/partner/pipeline/clients/",
        ] {
            err(Get, path);
        }
    }

    #[test]
    fn rejects_traversal_encoded_and_malformed_ids() {
        for path in [
            "/v1/clients/..",
            "/v1/clients/../token",
            "/v1/clients/./",
            &format!("/v1/clients/{C}/../../token"),
            "/v1/clients/%2e%2e",
            &format!("/v1/clients/{}", C.replace('-', "%2D")),
            "/v1/clients?search=x",
            "/v1/clients#frag",
            "/v1/clients\\x",
            &format!("/v1/clients/{C}\u{0000}"),
            "/v1/clients/not-a-uuid",
            "/v1/clients/6f1c2a1e3b4d4e5f8a9b0c1d2e3f4a5b",
            "/v1/clients/6f1c2a1e-3b4d-4e5f-8a9b-0c1d2e3f4a5g",
            "/v1/clients/cid_abc123",
        ] {
            err(Get, path);
        }
    }

    #[test]
    fn rejects_trailing_doubled_and_extra_segments() {
        for path in [
            "/v1/clients/",
            "/v1//clients",
            &format!("/v1/clients/{C}/"),
            &format!("/v1/clients//{C}"),
            &format!("/v1/clients/{C}/filtering-profile"),
            &format!("/v1/clients/{C}/{C}"),
        ] {
            err(Get, path);
        }
    }

    #[test]
    fn rejects_undocumented_methods_per_route() {
        err(Patch, "/v1/clients");
        err(Delete, "/v1/clients");
        err(Post, &format!("/v1/clients/{C}"));
    }

    #[test]
    fn rejects_methods_outside_the_four_with_a_clients_message() {
        for m in ["PUT", "HEAD", "OPTIONS", "", "G ET"] {
            match prepare(params(m, "/v1/clients")) {
                Err(AppError::Validation(msg)) => assert!(msg.contains("clients"), "{msg}"),
                other => panic!("{m:?} should be rejected, got {other:?}"),
            }
        }
    }

    #[test]
    fn drops_undocumented_query_keys() {
        let mut p = params("GET", "/v1/clients");
        p.query = vec![
            ("page".into(), "2".into()),
            ("company".into(), "other".into()),
            ("is_active".into(), "true".into()),
            ("format".into(), "json".into()),
            ("labels".into(), C.into()),
            ("filtering_profile_id".into(), C.into()),
        ];
        assert_eq!(
            prepare(p).unwrap().query,
            vec![
                ("page".to_string(), "2".to_string()),
                ("is_active".to_string(), "true".to_string()),
                ("filtering_profile_id".to_string(), C.to_string()),
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
    fn bodies_follow_the_shared_rule() {
        let mut create = params("POST", "/v1/clients");
        create.body = Some(json!({"name": "Acme"}));
        assert_eq!(prepare(create).unwrap().body, Some(json!({"name": "Acme"})));

        let mut array = params("PATCH", &format!("/v1/clients/{C}"));
        array.body = Some(json!(["name"]));
        assert!(matches!(prepare(array), Err(AppError::Validation(_))));

        let mut get_with_body = params("GET", "/v1/clients");
        get_with_body.body = Some(json!({}));
        assert!(matches!(
            prepare(get_with_body),
            Err(AppError::Validation(_))
        ));

        assert_eq!(
            prepare(params("DELETE", &format!("/v1/clients/{C}")))
                .unwrap()
                .body,
            None
        );
    }
}
