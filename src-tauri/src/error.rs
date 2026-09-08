// SPDX-License-Identifier: Apache-2.0
//! The single error type crossing the IPC boundary.
//!
//! Every command returns `AppResult<T>`. On the failure path Tauri serializes
//! the error, and this module's manual `Serialize` impl guarantees the shape
//! `{ code, message, details }` — exactly what `TauriError.fromRust()` in
//! `src/lib/api/errors.ts` parses. Returning bare `String` errors instead
//! would leave the frontend unable to distinguish a validation failure from a
//! 429, which is the distinction this tool exists to measure.

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

pub type AppResult<T> = Result<T, AppError>;

/// The variant set is a wire contract with `TauriErrorCode` in
/// `src/lib/api/errors.ts`, not an inventory of what Rust currently throws.
/// `Unauthorized`, `Conflict`, `Network` and `RateLimited` are constructed by
/// the `http` and `runner` modules once they land; defining them up front
/// means the frontend's retry and error-display logic can be written — and
/// tested — against the complete set rather than growing to meet it.
#[allow(dead_code)]
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),

    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    Unauthorized(String),

    #[error("{0}")]
    Forbidden(String),

    #[error("{0}")]
    Conflict(String),

    #[error("{0}")]
    Network(String),

    /// The Confinaid API throttled us. `retry_after_ms` carries the parsed
    /// `Retry-After` header when the server supplied one.
    #[error("{message}")]
    RateLimited {
        message: String,
        retry_after_ms: Option<u64>,
    },

    #[error("{0}")]
    Storage(String),

    #[error("{0}")]
    Internal(String),
}

impl AppError {
    /// Stable wire code. Must stay in sync with the `TauriErrorCode` union in
    /// `src/lib/api/errors.ts`.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Validation(_) => "VALIDATION_ERROR",
            Self::NotFound(_) => "NOT_FOUND",
            Self::Unauthorized(_) => "UNAUTHORIZED",
            Self::Forbidden(_) => "FORBIDDEN",
            Self::Conflict(_) => "CONFLICT",
            Self::Network(_) => "NETWORK_ERROR",
            Self::RateLimited { .. } => "RATE_LIMITED",
            Self::Storage(_) => "STORAGE_ERROR",
            Self::Internal(_) => "INTERNAL_ERROR",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 3)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        match self {
            Self::RateLimited { retry_after_ms, .. } => state.serialize_field(
                "details",
                &serde_json::json!({ "retryAfterMs": retry_after_ms }),
            )?,
            _ => state.serialize_field("details", &serde_json::Value::Null)?,
        }
        state.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        match err.kind() {
            std::io::ErrorKind::NotFound => Self::NotFound(err.to_string()),
            std::io::ErrorKind::PermissionDenied => Self::Forbidden(err.to_string()),
            _ => Self::Storage(err.to_string()),
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::Internal(format!("serialization failed: {err}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_variant_has_a_stable_code() {
        let cases: Vec<(AppError, &str)> = vec![
            (AppError::Validation("v".into()), "VALIDATION_ERROR"),
            (AppError::NotFound("n".into()), "NOT_FOUND"),
            (AppError::Unauthorized("u".into()), "UNAUTHORIZED"),
            (AppError::Forbidden("f".into()), "FORBIDDEN"),
            (AppError::Conflict("c".into()), "CONFLICT"),
            (AppError::Network("net".into()), "NETWORK_ERROR"),
            (
                AppError::RateLimited {
                    message: "slow down".into(),
                    retry_after_ms: Some(1500),
                },
                "RATE_LIMITED",
            ),
            (AppError::Storage("s".into()), "STORAGE_ERROR"),
            (AppError::Internal("i".into()), "INTERNAL_ERROR"),
        ];

        for (err, expected) in cases {
            assert_eq!(err.code(), expected);
        }
    }

    #[test]
    fn serializes_to_the_shape_the_frontend_parses() {
        let value = serde_json::to_value(AppError::Validation("bad url".into())).unwrap();
        assert_eq!(value["code"], "VALIDATION_ERROR");
        assert_eq!(value["message"], "bad url");
        assert!(value["details"].is_null());
    }

    #[test]
    fn rate_limited_carries_retry_after_in_details() {
        let value = serde_json::to_value(AppError::RateLimited {
            message: "429".into(),
            retry_after_ms: Some(2000),
        })
        .unwrap();
        assert_eq!(value["code"], "RATE_LIMITED");
        assert_eq!(value["details"]["retryAfterMs"], 2000);
    }

    #[test]
    fn io_not_found_maps_to_not_found_rather_than_storage() {
        let err: AppError = std::io::Error::new(std::io::ErrorKind::NotFound, "config.json").into();
        assert_eq!(err.code(), "NOT_FOUND");
    }
}
