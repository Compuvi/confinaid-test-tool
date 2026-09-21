// SPDX-License-Identifier: Apache-2.0
//! Credential commands — multi-profile edition.
//!
//! ## Invariant
//! `apiSecretKey` travels IPC in **one direction only**.
//! `CredentialInput` has the field; `StoredCredentialProfile` does not.
//! Adding it to the output type would defeat keychain storage entirely.
//!
//! ## Profile model
//! Non-secret fields (apiBaseUrl, clientId) live in `config.json` under
//! `profiles.<name>`.  The secret lives in the OS keychain, keyed by profile
//! name.  `active_profile` in config indicates which profile is currently used
//! by the HTTP runner.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::config::ProfileSettings;
use crate::credentials;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

// ── Wire types ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialInput {
    pub profile_name: String,
    pub api_base_url: String,
    pub client_id: String,
    /// Optional. Used for monitoring endpoints that are scoped to a company.
    pub company_id: Option<String>,
    /// Optional. Base URL of the dashboard/monitoring backend (may differ from api_base_url).
    pub monitoring_url: Option<String>,
    /// Write-only. Never present on the response type.
    /// Empty string = "keep the existing secret" (only valid for updates).
    pub api_secret_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCredentialProfile {
    pub profile_name: String,
    pub api_base_url: String,
    pub client_id: String,
    pub company_id: Option<String>,
    pub monitoring_url: Option<String>,
    pub has_secret: bool,
    /// Last four characters, so the user can confirm which key is stored.
    pub secret_hint: Option<String>,
}

// ── Validation ────────────────────────────────────────────────────────────────

fn validate(input: &CredentialInput, is_new: bool) -> AppResult<()> {
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
    // Secret is required when creating a new profile; optional for updates.
    if is_new && input.api_secret_key.trim().is_empty() {
        return Err(AppError::Validation(
            "API secret key is required for a new profile".into(),
        ));
    }
    Ok(())
}

// ── Helper: build StoredCredentialProfile from config + keychain ─────────────

fn build_stored_profile(
    profile_name: &str,
    settings: &ProfileSettings,
) -> AppResult<StoredCredentialProfile> {
    let secret = credentials::read_secret(profile_name)?;
    Ok(StoredCredentialProfile {
        profile_name: profile_name.to_string(),
        api_base_url: settings.api_base_url.clone(),
        client_id: settings.client_id.clone(),
        company_id: settings.company_id.clone(),
        monitoring_url: settings.monitoring_url.clone(),
        has_secret: secret.is_some(),
        secret_hint: secret.as_deref().and_then(credentials::secret_hint),
    })
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Create or update a credential profile.
///
/// If `apiSecretKey` is non-empty the keychain entry is updated.
/// If it is empty and the profile already exists the secret is left unchanged.
/// The saved profile becomes the active profile for API requests.
#[tauri::command]
pub fn save_credentials(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: CredentialInput,
) -> AppResult<StoredCredentialProfile> {
    let profile_name = profile.profile_name.trim().to_string();
    let mut config = state.config_snapshot()?;

    let is_new = !config.profiles.contains_key(&profile_name);
    validate(&profile, is_new)?;

    // Update the keychain only when a new secret is supplied.
    if !profile.api_secret_key.trim().is_empty() {
        credentials::store_secret(&profile_name, &profile.api_secret_key)?;
    }

    config.profiles.insert(
        profile_name.clone(),
        ProfileSettings {
            api_base_url: profile.api_base_url.trim().to_string(),
            client_id: profile.client_id.trim().to_string(),
            company_id: profile
                .company_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            monitoring_url: profile
                .monitoring_url
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
        },
    );
    config.active_profile = Some(profile_name.clone());
    state.update_config(&app, config)?;

    let settings = ProfileSettings {
        api_base_url: profile.api_base_url.trim().to_string(),
        client_id: profile.client_id.trim().to_string(),
        company_id: profile
            .company_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        monitoring_url: profile
            .monitoring_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
    };
    build_stored_profile(&profile_name, &settings)
}

/// Load the currently active credential profile (non-secret parts + hint).
/// Returns `null` when no profile is active.
#[tauri::command]
pub fn load_credentials(state: State<'_, AppState>) -> AppResult<Option<StoredCredentialProfile>> {
    let config = state.config_snapshot()?;
    let Some(profile_name) = config.active_profile.clone() else {
        return Ok(None);
    };
    let Some(settings) = config.profiles.get(&profile_name) else {
        return Ok(None);
    };
    Ok(Some(build_stored_profile(&profile_name, settings)?))
}

/// List all saved profiles, sorted by name.
/// Each entry includes `hasSecret` so the UI can warn about incomplete setups.
#[tauri::command]
pub fn list_profiles(state: State<'_, AppState>) -> AppResult<Vec<StoredCredentialProfile>> {
    let config = state.config_snapshot()?;
    let mut profiles: Vec<StoredCredentialProfile> = config
        .profiles
        .iter()
        .map(|(name, settings)| build_stored_profile(name, settings))
        .collect::<AppResult<Vec<_>>>()?;
    profiles.sort_by(|a, b| a.profile_name.cmp(&b.profile_name));
    Ok(profiles)
}

/// Make `profile_name` the active profile (used by the HTTP runner).
/// Returns the profile so the frontend can update its form in one round-trip.
#[tauri::command]
pub fn switch_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_name: String,
) -> AppResult<StoredCredentialProfile> {
    let mut config = state.config_snapshot()?;
    let profile_name = profile_name.trim().to_string();

    let settings = config
        .profiles
        .get(&profile_name)
        .ok_or_else(|| AppError::NotFound(format!("profile '{profile_name}' not found")))?
        .clone();

    config.active_profile = Some(profile_name.clone());
    state.update_config(&app, config)?;

    build_stored_profile(&profile_name, &settings)
}

/// Delete a profile: removes it from config.json and the OS keychain.
/// If the deleted profile was active, the first remaining profile (by name)
/// becomes active; if none remain, `active_profile` is cleared.
#[tauri::command]
pub fn delete_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_name: String,
) -> AppResult<Option<StoredCredentialProfile>> {
    let mut config = state.config_snapshot()?;
    let profile_name = profile_name.trim().to_string();

    config.profiles.remove(&profile_name);

    if config.active_profile.as_deref() == Some(&profile_name) {
        // Fall back to the first remaining profile, sorted alphabetically.
        let mut remaining: Vec<String> = config.profiles.keys().cloned().collect();
        remaining.sort();
        config.active_profile = remaining.into_iter().next();
    }

    // Always attempt to delete the keychain entry; idempotent if already gone.
    credentials::delete_secret(&profile_name)?;

    state.update_config(&app, config.clone())?;

    // Return the new active profile (if any) so the frontend can update.
    let active = match &config.active_profile {
        Some(name) => config
            .profiles
            .get(name)
            .map(|s| build_stored_profile(name, s))
            .transpose()?,
        None => None,
    };
    Ok(active)
}

/// Delete the currently active profile.
/// Kept for backwards compatibility with any call-site using the old single-
/// profile API; delegates to `delete_profile` internally.
#[tauri::command]
pub fn clear_credentials(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Option<StoredCredentialProfile>> {
    let config = state.config_snapshot()?;
    let profile_name = match config.active_profile.clone() {
        Some(name) => name,
        None => return Ok(None),
    };
    delete_profile(app, state, profile_name)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> CredentialInput {
        CredentialInput {
            profile_name: "default".into(),
            api_base_url: "https://api.example.com".into(),
            client_id: "client-1".into(),
            company_id: None,
            monitoring_url: None,
            api_secret_key: "sk_test_abcd1234".into(),
        }
    }

    #[test]
    fn accepts_a_well_formed_profile() {
        assert!(validate(&input(), true).is_ok());
    }

    #[test]
    fn rejects_a_url_without_a_scheme() {
        let mut bad = input();
        bad.api_base_url = "api.example.com".into();
        assert_eq!(validate(&bad, true).unwrap_err().code(), "VALIDATION_ERROR");
    }

    #[test]
    fn rejects_blank_profile_name_and_client_id() {
        let mut blank_profile = input();
        blank_profile.profile_name = "   ".into();
        assert_eq!(
            validate(&blank_profile, true).unwrap_err().code(),
            "VALIDATION_ERROR"
        );

        let mut blank_client = input();
        blank_client.client_id = "".into();
        assert_eq!(
            validate(&blank_client, true).unwrap_err().code(),
            "VALIDATION_ERROR"
        );
    }

    #[test]
    fn empty_secret_allowed_for_updates_but_not_for_new_profiles() {
        let mut no_secret = input();
        no_secret.api_secret_key = "".into();
        // Updating an existing profile — secret is optional.
        assert!(validate(&no_secret, false).is_ok());
        // Creating a new profile — secret is required.
        assert_eq!(
            validate(&no_secret, true).unwrap_err().code(),
            "VALIDATION_ERROR"
        );
    }

    #[test]
    fn stored_profile_never_serializes_the_secret() {
        let stored = StoredCredentialProfile {
            profile_name: "default".into(),
            api_base_url: "https://api.example.com".into(),
            client_id: "client-1".into(),
            company_id: None,
            monitoring_url: None,
            has_secret: true,
            secret_hint: Some("1234".into()),
        };
        let json = serde_json::to_string(&stored).unwrap();
        assert!(!json.contains("sk_test"), "secret leaked over IPC: {json}");
        assert!(!json.to_lowercase().contains("apisecretkey"), "{json}");
    }
}
