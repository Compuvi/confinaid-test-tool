// SPDX-License-Identifier: Apache-2.0
//! Custody of the Confinaid API secret key.
//!
//! The secret is stored in the OS keychain (Keychain / Credential Manager /
//! Secret Service) and is **write-only across the IPC boundary**: it can be
//! set from the frontend, but no function here returns it to JavaScript.
//! Reads yield a presence flag and a short hint instead.
//!
//! Everything that needs the actual value — request signing in the future
//! `http` module, the load runner — reads it from Rust.

use keyring::Entry;

use crate::error::{AppError, AppResult};

/// Keychain service name. Matches the Tauri bundle identifier so the entry is
/// attributable in Keychain Access / Credential Manager.
pub const KEYCHAIN_SERVICE: &str = "com.compuvi.confinaid.testtool";

/// Number of trailing characters surfaced to the UI so a user can tell which
/// key is stored without revealing it.
const HINT_LEN: usize = 4;

fn entry(profile_name: &str) -> AppResult<Entry> {
    Entry::new(KEYCHAIN_SERVICE, profile_name).map_err(map_keyring_error)
}

fn map_keyring_error(err: keyring::Error) -> AppError {
    match err {
        keyring::Error::NoEntry => AppError::NotFound("no stored secret for this profile".into()),
        keyring::Error::NoStorageAccess(inner) => AppError::Forbidden(format!(
            "the OS keychain refused access: {inner}. On Linux, ensure a Secret Service \
             provider (gnome-keyring or kwallet) is running."
        )),
        other => AppError::Storage(format!("keychain error: {other}")),
    }
}

/// Last `HINT_LEN` characters of the secret, for UI confirmation only.
/// Short secrets are masked entirely rather than partially revealed.
pub fn secret_hint(secret: &str) -> Option<String> {
    let chars: Vec<char> = secret.chars().collect();
    if chars.len() <= HINT_LEN {
        return None;
    }
    Some(chars[chars.len() - HINT_LEN..].iter().collect())
}

pub fn store_secret(profile_name: &str, secret: &str) -> AppResult<()> {
    if secret.trim().is_empty() {
        return Err(AppError::Validation(
            "API secret key cannot be empty".into(),
        ));
    }
    entry(profile_name)?
        .set_password(secret)
        .map_err(map_keyring_error)
}

/// Returns `Ok(None)` when nothing is stored — absence is a normal state on
/// first launch, not an error the UI should surface.
pub fn read_secret(profile_name: &str) -> AppResult<Option<String>> {
    match entry(profile_name)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(map_keyring_error(err)),
    }
}

/// Idempotent: deleting an entry that does not exist succeeds.
pub fn delete_secret(profile_name: &str) -> AppResult<()> {
    match entry(profile_name)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(map_keyring_error(err)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hint_exposes_only_the_last_four_characters() {
        assert_eq!(secret_hint("sk_live_abcd1234").as_deref(), Some("1234"));
    }

    #[test]
    fn short_secrets_are_masked_entirely() {
        assert_eq!(secret_hint("abcd"), None);
        assert_eq!(secret_hint("ab"), None);
        assert_eq!(secret_hint(""), None);
    }

    #[test]
    fn hint_is_char_safe_for_multibyte_secrets() {
        // Byte slicing here would panic; the char-based implementation must not.
        assert_eq!(secret_hint("sk_tëst_🔑abcd").as_deref(), Some("abcd"));
    }

    #[test]
    fn empty_secrets_are_rejected_before_touching_the_keychain() {
        let err = store_secret("test-profile", "   ").unwrap_err();
        assert_eq!(err.code(), "VALIDATION_ERROR");
    }

    /// Exercises the real OS keychain. Ignored by default: CI runners have no
    /// unlocked keychain (and on Linux no Secret Service daemon), so this
    /// would fail there for reasons unrelated to the code.
    ///
    /// Run it locally after touching this module:
    ///   cargo test --lib -- --ignored keychain_round_trip
    #[test]
    #[ignore = "requires an unlocked OS keychain"]
    fn keychain_round_trip() {
        let profile = "confinaid-test-tool-selftest";
        let secret = "sk_selftest_abcd1234";

        // Start clean; delete is idempotent so this is safe either way.
        delete_secret(profile).unwrap();
        assert_eq!(read_secret(profile).unwrap(), None);

        store_secret(profile, secret).unwrap();
        assert_eq!(read_secret(profile).unwrap().as_deref(), Some(secret));

        delete_secret(profile).unwrap();
        assert_eq!(read_secret(profile).unwrap(), None);

        // Deleting again must still succeed.
        delete_secret(profile).unwrap();
    }
}
