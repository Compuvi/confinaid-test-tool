// SPDX-License-Identifier: Apache-2.0
//! Tauri commands: update checking and auto-install.

use tauri::AppHandle;

use crate::updater::{self, UpdateCheckResult};

/// Check whether a newer version of the test tool is available on GitHub.
///
/// Called once at startup from the frontend (fire-and-forget from the UI
/// perspective).  Network errors are returned as `Err` so the frontend can
/// silently suppress them — a failed check must never block the app.
#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();
    updater::check_for_updates(&current_version).await
}

/// Download, verify (SHA-256), and silently install the update.
///
/// The frontend passes the values already received from `check_for_updates`,
/// so this command does not re-fetch the manifest.
///
/// Progress is streamed back via Tauri events:
///   - `update-download-progress` — `{ downloaded, total, percentage, speed_bps }`
///   - `update-status`            — plain status string
///
/// On success the app exits (the installer/relaunch script takes over).
/// On failure the partially-downloaded file is deleted and an error string
/// is returned so the frontend can show a toast.
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    download_url: String,
    checksum: String,
    download_size: u64,
    filename: String,
) -> Result<(), String> {
    updater::install_update(download_url, checksum, download_size, filename, app).await
}
