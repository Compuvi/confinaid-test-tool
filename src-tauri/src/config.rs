// SPDX-License-Identifier: Apache-2.0
//! Non-secret application configuration, persisted as JSON.
//!
//! The API secret key is deliberately NOT part of this struct — it lives in
//! the OS keychain (see `credentials`). Anything stored here is safe to read
//! with a text editor, and users will do exactly that when debugging.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const CONFIG_FILE_NAME: &str = "config.json";

fn default_api_base_url() -> String {
    "https://api.confinaid.com".to_string()
}

fn default_request_timeout_ms() -> u64 {
    30_000
}

// ── Per-profile settings (non-secret) ────────────────────────────────────────

/// Non-secret, per-profile settings stored in config.json.
/// The corresponding API secret is stored in the OS keychain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSettings {
    #[serde(default = "default_api_base_url")]
    pub api_base_url: String,
    #[serde(default)]
    pub client_id: String,
    /// Optional company/tenant identifier used for the monitoring endpoints.
    /// Not required for the partner API itself (analyze/rewrite/token).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub company_id: Option<String>,
    /// Optional base URL of the Confinaid dashboard/monitoring backend.
    /// In production this is the same host as api_base_url; on beta/staging it
    /// differs (e.g. https://beta-api.confinaid.com vs https://api-beta.confinaid.com).
    /// Falls back to api_base_url when not set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub monitoring_url: Option<String>,
}

// ── Application config ────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// Named credential profiles (non-secret parts).
    /// The secret for each profile lives in the OS keychain, keyed by name.
    #[serde(default)]
    pub profiles: HashMap<String, ProfileSettings>,

    /// Profile currently used for API requests.
    #[serde(default)]
    pub active_profile: Option<String>,

    #[serde(default = "default_request_timeout_ms")]
    pub request_timeout_ms: u64,

    // ── Legacy single-profile fields (v0.2.x and earlier) ────────────────────
    // These appeared at the top level in old config.json files. They are read
    // here for migration purposes and never written again
    // (`skip_serializing_if` drops them from every subsequent write).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub api_base_url: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub client_id: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            profiles: HashMap::new(),
            active_profile: None,
            request_timeout_ms: default_request_timeout_ms(),
            api_base_url: String::new(),
            client_id: String::new(),
        }
    }
}

impl AppConfig {
    /// Migrate pre-multi-profile configs into the `profiles` map.
    ///
    /// Old config.json had a single `apiBaseUrl` / `clientId` at the top level.
    /// This method folds those into `profiles[active_profile]` on first load and
    /// clears the legacy fields so they are not written back.
    pub fn migrate_v1_profile(&mut self) {
        if !self.profiles.is_empty() {
            return; // Already in new format — nothing to do.
        }
        if let Some(name) = self.active_profile.clone() {
            if !self.client_id.is_empty() || !self.api_base_url.is_empty() {
                let settings = ProfileSettings {
                    api_base_url: std::mem::take(&mut self.api_base_url),
                    client_id: std::mem::take(&mut self.client_id),
                    company_id: None,
                    monitoring_url: None,
                };
                self.profiles.insert(name, settings);
            }
        }
        // Clear regardless so they don't appear in the next write.
        self.api_base_url = String::new();
        self.client_id = String::new();
    }
}

impl AppConfig {
    /// Reads config from `dir/config.json`. A missing file is not an error —
    /// first launch is the common case and yields defaults.
    pub fn load_from_dir(dir: &Path) -> AppResult<Self> {
        let path = dir.join(CONFIG_FILE_NAME);
        let mut config = match std::fs::read_to_string(&path) {
            Ok(contents) => serde_json::from_str::<Self>(&contents).map_err(|err| {
                AppError::Storage(format!(
                    "{} is not valid config JSON: {err}",
                    path.display()
                ))
            })?,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Self::default(),
            Err(err) => {
                return Err(AppError::Storage(format!(
                    "could not read {}: {err}",
                    path.display()
                )))
            }
        };
        // Transparently upgrade old single-profile configs.
        config.migrate_v1_profile();
        Ok(config)
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
        let mut profiles = HashMap::new();
        profiles.insert(
            "staging".into(),
            ProfileSettings {
                api_base_url: "https://api.example.com".into(),
                client_id: "client-123".into(),
                company_id: None,
                monitoring_url: None,
            },
        );
        let config = AppConfig {
            profiles,
            active_profile: Some("staging".into()),
            request_timeout_ms: 5_000,
            api_base_url: String::new(),
            client_id: String::new(),
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
            r#"{ "somethingNew": 1, "requestTimeoutMs": 5000 }"#,
        )
        .unwrap();

        let config = AppConfig::load_from_dir(&dir).unwrap();
        assert_eq!(config.profiles.len(), 0);
        assert_eq!(config.request_timeout_ms, 5_000);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn v1_migration_folds_legacy_fields_into_profiles_map() {
        let dir = temp_dir("v1-migrate");
        std::fs::create_dir_all(&dir).unwrap();
        // Simulate a v0.2.x config.json
        std::fs::write(
            dir.join(CONFIG_FILE_NAME),
            r#"{"apiBaseUrl":"https://api.confinaid.com","clientId":"cid_old","activeProfile":"default"}"#,
        )
        .unwrap();

        let config = AppConfig::load_from_dir(&dir).unwrap();
        assert_eq!(config.active_profile.as_deref(), Some("default"));
        let p = config.profiles.get("default").unwrap();
        assert_eq!(p.client_id, "cid_old");
        assert_eq!(p.api_base_url, "https://api.confinaid.com");
        // Legacy top-level fields are empty after migration
        assert!(config.api_base_url.is_empty());
        assert!(config.client_id.is_empty());

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
