// SPDX-License-Identifier: Apache-2.0
//! Credential commands.
//!
//! Invariant enforced here: `apiSecretKey` travels IPC in one direction only.
//! `CredentialInput` has the field; `StoredCredentialProfile` does not. Adding
//! it to the output type would defeat keychain storage entirely, since the
//! value would then sit in the renderer's heap and in any devtools snapshot.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::credentials;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

const DEFAULT_PROFILE: &str = "default";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialInput {
    pub profile_name: String,
    pub api_base_url: String,
    pub client_id: String,
    /// Write-only. Never present on the response type.
    pub api_secret_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCredentialProfile {
    pub profile_name: String,
    pub api_base_url: String,
    pub client_id: String,
    pub has_secret: bool,
    /// Last four characters, so the user can confirm which key is stored.
    pub secret_hint: Option<String>,
}

fn validate(input: &CredentialInput) -> AppResult<()> {
    if input.profile_name.trim().is_empty() {
        return Err(AppError::Validation("Profile name is required".into()));
    }
    if input.client_id.trim().is_empty() {
        return Err(AppError::Validation("Client ID is required".into()));
    }
    let url = input.api_base_url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::Validation(
            "API base URL must start with http:// or https://".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn save_credentials(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: CredentialInput,
) -> AppResult<StoredCredentialProfile> {
    validate(&profile)?;

    let profile_name = profile.profile_name.trim().to_string();
    credentials::store_secret(&profile_name, &profile.api_secret_key)?;

    let mut config = state.config_snapshot()?;
    config.api_base_url = profile.api_base_url.trim().to_string();
    config.client_id = profile.client_id.trim().to_string();
    config.active_profile = Some(profile_name.clone());
    state.update_config(&app, config.clone())?;

    Ok(StoredCredentialProfile {
        profile_name,
        api_base_url: config.api_base_url,
        client_id: config.client_id,
        has_secret: true,
        secret_hint: credentials::secret_hint(&profile.api_secret_key),
    })
}

#[tauri::command]
pub fn load_credentials(state: State<'_, AppState>) -> AppResult<Option<StoredCredentialProfile>> {
    let config = state.config_snapshot()?;
    let Some(profile_name) = config.active_profile.clone() else {
        return Ok(None);
    };

    let secret = credentials::read_secret(&profile_name)?;

    Ok(Some(StoredCredentialProfile {
        profile_name,
        api_base_url: config.api_base_url,
        client_id: config.client_id,
        has_secret: secret.is_some(),
        secret_hint: secret.as_deref().and_then(credentials::secret_hint),
    }))
}

#[tauri::command]
pub fn clear_credentials(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let mut config = state.config_snapshot()?;
    let profile_name = config
        .active_profile
        .clone()
        .unwrap_or_else(|| DEFAULT_PROFILE.to_string());

    credentials::delete_secret(&profile_name)?;

    config.active_profile = None;
    config.client_id = String::new();
    state.update_config(&app, config)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> CredentialInput {
        CredentialInput {
            profile_name: "default".into(),
            api_base_url: "https://api.example.com".into(),
            client_id: "client-1".into(),
            api_secret_key: "sk_test_abcd1234".into(),
        }
    }

    #[test]
    fn accepts_a_well_formed_profile() {
        assert!(validate(&input()).is_ok());
    }

    #[test]
    fn rejects_a_url_without_a_scheme() {
        let mut bad = input();
        bad.api_base_url = "api.example.com".into();
        assert_eq!(validate(&bad).unwrap_err().code(), "VALIDATION_ERROR");
    }

    #[test]
    fn rejects_blank_profile_name_and_client_id() {
        let mut blank_profile = input();
        blank_profile.profile_name = "   ".into();
        assert_eq!(
            validate(&blank_profile).unwrap_err().code(),
            "VALIDATION_ERROR"
        );

        let mut blank_client = input();
        blank_client.client_id = "".into();
        assert_eq!(
            validate(&blank_client).unwrap_err().code(),
            "VALIDATION_ERROR"
        );
    }

    #[test]
    fn stored_profile_never_serializes_the_secret() {
        // The load-bearing invariant of this module.
        let stored = StoredCredentialProfile {
            profile_name: "default".into(),
            api_base_url: "https://api.example.com".into(),
            client_id: "client-1".into(),
            has_secret: true,
            secret_hint: Some("1234".into()),
        };
        let json = serde_json::to_string(&stored).unwrap();
        assert!(!json.contains("sk_test"), "secret leaked over IPC: {json}");
        assert!(!json.to_lowercase().contains("apisecretkey"), "{json}");
    }
}
