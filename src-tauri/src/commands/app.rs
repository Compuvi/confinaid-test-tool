// SPDX-License-Identifier: Apache-2.0
//! App metadata. Pure — no network, no state, no side effects.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub app_version: String,
    pub tauri_version: String,
    pub os: String,
    pub arch: String,
    pub is_debug: bool,
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn get_runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        tauri_version: tauri::VERSION.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        is_debug: cfg!(debug_assertions),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_info_reports_the_host_platform() {
        let info = get_runtime_info();
        assert_eq!(info.app_version, env!("CARGO_PKG_VERSION"));
        assert!(!info.os.is_empty());
        assert!(!info.arch.is_empty());
    }

    #[test]
    fn runtime_info_serializes_as_camel_case_for_the_frontend() {
        let value = serde_json::to_value(get_runtime_info()).unwrap();
        assert!(value.get("appVersion").is_some());
        assert!(value.get("tauriVersion").is_some());
        assert!(value.get("isDebug").is_some());
    }
}
