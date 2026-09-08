// SPDX-License-Identifier: Apache-2.0
//! Non-secret application configuration, persisted as JSON.
//!
//! The API secret key is deliberately NOT part of this struct — it lives in
//! the OS keychain (see `credentials`). Anything stored here is safe to read
//! with a text editor, and users will do exactly that when debugging.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const CONFIG_FILE_NAME: &str = "config.json";

fn default_api_base_url() -> String {
    "https://beta-api.confinaid.com".to_string()
}

fn default_request_timeout_ms() -> u64 {
    30_000
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_api_base_url")]
    pub api_base_url: String,

    #[serde(default)]
    pub client_id: String,

    /// Name of the credential profile currently selected in the UI.
    #[serde(default)]
    pub active_profile: Option<String>,

    #[serde(default = "default_request_timeout_ms")]
    pub request_timeout_ms: u64,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            api_base_url: default_api_base_url(),
            client_id: String::new(),
            active_profile: None,
            request_timeout_ms: default_request_timeout_ms(),
        }
    }
}

impl AppConfig {
    /// Reads config from `dir/config.json`. A missing file is not an error —
    /// first launch is the common case and yields defaults.
    pub fn load_from_dir(dir: &Path) -> AppResult<Self> {
        let path = dir.join(CONFIG_FILE_NAME);
        match std::fs::read_to_string(&path) {
            Ok(contents) => serde_json::from_str(&contents).map_err(|err| {
                AppError::Storage(format!(
                    "{} is not valid config JSON: {err}",
                    path.display()
                ))
            }),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(err) => Err(AppError::Storage(format!(
                "could not read {}: {err}",
                path.display()
            ))),
        }
    }

    /// Writes atomically: serialize to a sibling temp file, then rename. A
    /// crash mid-write leaves the previous config intact rather than a
    /// truncated file the next launch would refuse to parse.
    pub fn save_to_dir(&self, dir: &Path) -> AppResult<PathBuf> {
        std::fs::create_dir_all(dir)?;

        let path = dir.join(CONFIG_FILE_NAME);
        let temp_path = dir.join(format!("{CONFIG_FILE_NAME}.tmp"));

        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(&temp_path, json)?;
        std::fs::rename(&temp_path, &path)?;

        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("confinaid-test-tool-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn missing_file_yields_defaults_rather_than_an_error() {
        let dir = temp_dir("missing");
        let config = AppConfig::load_from_dir(&dir).unwrap();
        assert_eq!(config, AppConfig::default());
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = temp_dir("roundtrip");
        let config = AppConfig {
            api_base_url: "https://api.example.com".into(),
            client_id: "client-123".into(),
            active_profile: Some("staging".into()),
            request_timeout_ms: 5_000,
        };

        config.save_to_dir(&dir).unwrap();
        assert_eq!(AppConfig::load_from_dir(&dir).unwrap(), config);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn save_leaves_no_temp_file_behind() {
        let dir = temp_dir("tempfile");
        AppConfig::default().save_to_dir(&dir).unwrap();
        assert!(!dir.join(format!("{CONFIG_FILE_NAME}.tmp")).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unknown_and_missing_fields_fall_back_to_defaults() {
        let dir = temp_dir("partial");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(CONFIG_FILE_NAME),
            r#"{ "clientId": "only-this", "somethingNew": 1 }"#,
        )
        .unwrap();

        let config = AppConfig::load_from_dir(&dir).unwrap();
        assert_eq!(config.client_id, "only-this");
        assert_eq!(config.api_base_url, default_api_base_url());
        assert_eq!(config.request_timeout_ms, default_request_timeout_ms());

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn config_never_carries_a_secret_field() {
        // Guards the core invariant: secrets belong in the keychain. If someone
        // adds `apiSecretKey` to AppConfig, this fails loudly.
        let json = serde_json::to_string(&AppConfig::default()).unwrap();
        assert!(
            !json.to_lowercase().contains("secret"),
            "config leaked: {json}"
        );
    }
}
