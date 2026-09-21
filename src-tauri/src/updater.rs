// SPDX-License-Identifier: Apache-2.0
//! Update checker and auto-installer.
//!
//! ## Flow
//! 1. `check_for_updates` — fetches the latest GitHub release, parses
//!    `update-manifest.json`, compares semver. Returns structured result
//!    including the download URL, file size, and SHA-256 checksum for the
//!    platform-specific asset.
//!
//! 2. `install_update` — called by the frontend with the download info already
//!    known. Downloads the installer into the system temp directory, verifies
//!    its SHA-256 checksum, spawns the platform-specific installer silently,
//!    and exits the app.
//!
//! Progress is streamed to the frontend via Tauri events:
//!   • `update-download-progress`  { downloaded, total, percentage, speed_bps }
//!   • `update-status`             plain status string

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;

// ─── Constants ───────────────────────────────────────────────────────────────

const GITHUB_API_LATEST: &str =
    "https://api.github.com/repos/Compuvi/confinaid-test-tool/releases/latest";
const MANIFEST_FILENAME: &str = "update-manifest.json";
const USER_AGENT: &str = concat!("Confinaid-Test-Tool-Updater/", env!("CARGO_PKG_VERSION"));
const REQUEST_TIMEOUT_SECS: u64 = 15;
const DOWNLOAD_TIMEOUT_SECS: u64 = 300; // 5 min hard cap

// ─── GitHub API shapes ───────────────────────────────────────────────────────

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    assets: Vec<GithubAsset>,
}

#[derive(Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

// ─── Manifest shapes ─────────────────────────────────────────────────────────

/// One platform installer entry inside `update-manifest.json`.
#[derive(Debug, Clone, Deserialize)]
pub struct PlatformAsset {
    pub url: String,
    pub checksum: String,
    pub size: u64,
    pub filename: String,
}

/// Platform map inside `update-manifest.json`.
#[derive(Debug, Clone, Deserialize)]
pub struct ManifestAssets {
    #[serde(rename = "windows-x86_64")]
    pub windows_x86_64: Option<PlatformAsset>,
    #[serde(rename = "windows-msi")]
    pub windows_msi: Option<PlatformAsset>,
    #[serde(rename = "macos-x86_64")]
    pub macos_x86_64: Option<PlatformAsset>,
    #[serde(rename = "macos-aarch64")]
    pub macos_aarch64: Option<PlatformAsset>,
    #[serde(rename = "linux-x86_64")]
    pub linux_x86_64: Option<PlatformAsset>,
}

/// Full `update-manifest.json` shape (mirrors `generate-manifest.mjs`).
#[derive(Debug, Deserialize)]
pub struct UpdateManifest {
    #[allow(dead_code)]
    pub version: String,
    #[serde(default)]
    pub release_notes: Option<String>,
    #[serde(default)]
    pub mandatory: bool,
    #[allow(dead_code)]
    #[serde(default)]
    pub min_version: Option<String>,
    pub assets: ManifestAssets,
}

// ─── Public result types ──────────────────────────────────────────────────────

/// Returned to the frontend via IPC after `check_for_updates`.
#[derive(Debug, Clone, Serialize)]
pub struct UpdateCheckResult {
    /// `true` when the latest release is strictly newer than the running build.
    pub available: bool,
    /// Version string of the running build (e.g. `"0.1.2"`).
    pub current_version: String,
    /// Tag version from the latest GitHub release (e.g. `"0.2.0"`).
    pub new_version: Option<String>,
    /// GitHub release page URL — fallback for manual download.
    pub release_url: Option<String>,
    /// Markdown release notes from the manifest or GitHub release body.
    pub release_notes: Option<String>,
    /// `true` when the manifest marks this update as mandatory.
    pub mandatory: bool,

    // ── Install info (only set when `available == true`) ──────────────────
    /// Direct download URL for the platform-specific installer.
    pub download_url: Option<String>,
    /// Expected file size in bytes.
    pub download_size: Option<u64>,
    /// SHA-256 hex checksum of the installer.
    pub checksum: Option<String>,
    /// Installer filename (e.g. `"confinaid-test-tool_0.2.0_x64-setup.exe"`).
    pub filename: Option<String>,
}

/// Emitted as `update-download-progress` during download.
#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f64,
    pub speed_bps: u64,
}

// ─── Semver helpers ───────────────────────────────────────────────────────────

/// Parse `"x.y.z"` or `"vx.y.z"` → `(major, minor, patch)`.
fn parse_semver(v: &str) -> Option<(u32, u32, u32)> {
    let v = v.trim_start_matches('v');
    // Ignore pre-release / build-metadata suffixes.
    let core = v.split('-').next().unwrap_or(v);
    let parts: Vec<&str> = core.split('.').collect();
    if parts.len() < 3 {
        return None;
    }
    Some((
        parts[0].parse().ok()?,
        parts[1].parse().ok()?,
        parts[2].parse().ok()?,
    ))
}

fn is_newer(candidate: &str, current: &str) -> bool {
    match (parse_semver(candidate), parse_semver(current)) {
        (Some(c), Some(r)) => c > r,
        _ => false,
    }
}

// ─── Platform detection ───────────────────────────────────────────────────────

/// Pick the right asset for this machine.
///
/// On Windows, prefer MSI when the exe lives under `Program Files`
/// (a typical MSI install location), otherwise prefer the NSIS setup.
fn pick_platform_asset(assets: &ManifestAssets) -> Option<&PlatformAsset> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    match (os, arch) {
        ("windows", "x86_64") | ("windows", "x86") => {
            let prefer_msi = prefer_msi_on_windows();
            if prefer_msi {
                assets
                    .windows_msi
                    .as_ref()
                    .or(assets.windows_x86_64.as_ref())
            } else {
                assets
                    .windows_x86_64
                    .as_ref()
                    .or(assets.windows_msi.as_ref())
            }
        }
        ("macos", "aarch64") => assets
            .macos_aarch64
            .as_ref()
            .or(assets.macos_x86_64.as_ref()),
        ("macos", _) => assets
            .macos_x86_64
            .as_ref()
            .or(assets.macos_aarch64.as_ref()),
        ("linux", "x86_64") | ("linux", "x86") => assets.linux_x86_64.as_ref(),
        _ => None,
    }
}

/// Heuristic: if the current exe path contains "Program Files" assume it was
/// installed by an MSI; otherwise assume the NSIS portable/user-install.
fn prefer_msi_on_windows() -> bool {
    if let Ok(exe) = std::env::current_exe() {
        let path_upper = exe.display().to_string().to_uppercase();
        return path_upper.contains("PROGRAM FILES");
    }
    false
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

fn make_client(timeout_secs: u64) -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

// ─── Core check logic ─────────────────────────────────────────────────────────

/// Check GitHub for a newer release and return a structured result.
///
/// Never panics; all network / parse errors are converted to `Err(String)`.
pub async fn check_for_updates(current_version: &str) -> Result<UpdateCheckResult, String> {
    let client = make_client(REQUEST_TIMEOUT_SECS)?;

    // ── Fetch the latest release ──────────────────────────────────────────────
    let response = client
        .get(GITHUB_API_LATEST)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub API returned HTTP {}",
            response.status().as_u16()
        ));
    }

    let release: GithubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub release JSON: {e}"))?;

    let new_version = release.tag_name.trim_start_matches('v').to_string();

    // ── Fetch update-manifest.json from release assets ────────────────────────
    let manifest_url = release
        .assets
        .iter()
        .find(|a| a.name == MANIFEST_FILENAME)
        .map(|a| a.browser_download_url.clone());

    let manifest: Option<UpdateManifest> = if let Some(url) = manifest_url {
        match client.get(&url).send().await {
            Ok(r) if r.status().is_success() => r.json::<UpdateManifest>().await.ok(),
            _ => None,
        }
    } else {
        None
    };

    // ── Resolve platform asset ────────────────────────────────────────────────
    let (download_url, download_size, checksum, filename) = if let Some(ref m) = manifest {
        if let Some(asset) = pick_platform_asset(&m.assets) {
            (
                Some(asset.url.clone()),
                Some(asset.size),
                Some(asset.checksum.clone()),
                Some(asset.filename.clone()),
            )
        } else {
            (None, None, None, None)
        }
    } else {
        (None, None, None, None)
    };

    // ── Compare versions ──────────────────────────────────────────────────────
    let available = is_newer(&new_version, current_version);

    let release_notes = manifest
        .as_ref()
        .and_then(|m| m.release_notes.clone())
        .or(release.body);
    let mandatory = manifest.as_ref().map(|m| m.mandatory).unwrap_or(false);

    Ok(UpdateCheckResult {
        available,
        current_version: current_version.to_string(),
        new_version: Some(new_version),
        release_url: Some(release.html_url),
        release_notes,
        mandatory,
        download_url: if available { download_url } else { None },
        download_size: if available { download_size } else { None },
        checksum: if available { checksum } else { None },
        filename: if available { filename } else { None },
    })
}

// ─── Download with progress ───────────────────────────────────────────────────

async fn download_with_progress(
    url: &str,
    dest: &Path,
    total: u64,
    app: &AppHandle,
) -> Result<(), String> {
    let client = make_client(DOWNLOAD_TIMEOUT_SECS)?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download HTTP {}: {}",
            response.status().as_u16(),
            response.text().await.unwrap_or_default()
        ));
    }

    let mut file = File::create(dest).map_err(|e| format!("Cannot create temp file: {e}"))?;
    let mut downloaded: u64 = 0;
    let start = std::time::Instant::now();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Write error: {e}"))?;
        downloaded += chunk.len() as u64;

        let elapsed = start.elapsed().as_secs_f64().max(0.001);
        let speed_bps = (downloaded as f64 / elapsed) as u64;
        let effective_total = if total > 0 { total } else { downloaded + 1 };
        let percentage = (downloaded as f64 / effective_total as f64 * 100.0).min(100.0);

        let _ = app.emit(
            "update-download-progress",
            &DownloadProgress {
                downloaded,
                total,
                percentage,
                speed_bps,
            },
        );
    }

    file.flush().map_err(|e| format!("Flush error: {e}"))?;
    Ok(())
}

// ─── Checksum verification ────────────────────────────────────────────────────

fn verify_checksum(path: &Path, expected: &str) -> Result<(), String> {
    let mut file = File::open(path).map_err(|e| format!("Cannot open file for checksum: {e}"))?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| format!("Checksum read error: {e}"))?;
    let actual = hex::encode(hasher.finalize());

    if actual.to_lowercase() != expected.to_lowercase() {
        return Err(format!(
            "Checksum mismatch — expected {expected}, got {actual}"
        ));
    }
    Ok(())
}

// ─── Platform-specific install ────────────────────────────────────────────────

/// Launch the installer and exit the app.
///
/// Windows NSIS (.exe): spawns a hidden PowerShell that waits 1 s then runs
///                      `<installer.exe> /S` silently.
/// Windows MSI  (.msi): spawns `msiexec /i <file> /qn /norestart` the same way.
/// macOS        (.dmg): opens the DMG with `open` (Finder shows it to the user).
/// Linux     (.AppImage): chmod +x, write a shell relaunch script, exit.
async fn launch_installer(path: &Path, app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let path_str = path
            .to_str()
            .ok_or("Installer path contains invalid UTF-8")?
            .replace('\'', "''"); // escape for PowerShell single-quote string

        // Capture the current exe path so we can relaunch after install.
        let current_exe = std::env::current_exe()
            .ok()
            .and_then(|p| p.to_str().map(|s| s.replace('\'', "''")))
            .unwrap_or_default();

        let is_msi = path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("msi"));

        // Wait for the app to exit (1 s), run the installer silently (-Wait),
        // then wait 2 s and relaunch the exe at the same path (now the new version).
        let ps_command = if is_msi {
            format!(
                "Start-Sleep -Milliseconds 1000; \
                 Start-Process msiexec \
                   -ArgumentList '/i','{path_str}','/qn','/norestart' \
                   -WindowStyle Hidden -Wait; \
                 Start-Sleep -Milliseconds 2000; \
                 if (Test-Path '{current_exe}') {{ Start-Process '{current_exe}' }}"
            )
        } else {
            // NSIS silent install — use Start-Process -Wait so PowerShell
            // blocks until the installer has fully completed before relaunching.
            format!(
                "Start-Sleep -Milliseconds 1000; \
                 Start-Process '{path_str}' -ArgumentList '/S' -Wait; \
                 Start-Sleep -Milliseconds 2000; \
                 if (Test-Path '{current_exe}') {{ Start-Process '{current_exe}' }}"
            )
        };

        Command::new("powershell.exe")
            .args([
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-NoProfile",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &ps_command,
            ])
            .creation_flags(CREATE_NO_WINDOW) // no console window flash
            .spawn()
            .map_err(|e| format!("Failed to spawn PowerShell installer: {e}"))?;

        std::thread::sleep(Duration::from_millis(300));
        app.exit(0);
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // Mount / open the DMG — Finder shows it to the user so they can
        // drag the app to /Applications themselves.
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open DMG: {e}"))?;

        std::thread::sleep(Duration::from_millis(500));
        app.exit(0);
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        // Make executable
        Command::new("chmod")
            .args(["+x", path.to_str().unwrap_or("")])
            .output()
            .map_err(|e| format!("chmod failed: {e}"))?;

        // Write a tiny shell script that waits 2 s, launches the new AppImage,
        // and removes itself.
        let script_path = std::env::temp_dir().join("confinaid_test_tool_update.sh");
        let script = format!(
            "#!/bin/bash\nsleep 2\n\"{path}\" &\nrm -f \"$0\"\n",
            path = path.display()
        );
        fs::write(&script_path, &script)
            .map_err(|e| format!("Failed to write relaunch script: {e}"))?;
        Command::new("chmod")
            .args(["+x", script_path.to_str().unwrap_or("")])
            .output()
            .ok();
        Command::new("bash")
            .arg(&script_path)
            .spawn()
            .map_err(|e| format!("Failed to spawn relaunch script: {e}"))?;

        std::thread::sleep(Duration::from_millis(500));
        app.exit(0);
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Auto-install is not supported on this platform".to_string())
}

// ─── Public install entry point ───────────────────────────────────────────────

/// Download, verify, and install an update.
///
/// The frontend passes the values it already received from `check_for_updates`
/// so we don't re-fetch the manifest.
pub async fn install_update(
    download_url: String,
    checksum: String,
    download_size: u64,
    filename: String,
    app: AppHandle,
) -> Result<(), String> {
    // ── Step 1: Download ──────────────────────────────────────────────────────
    let _ = app.emit("update-status", "Downloading update…");

    let dest = std::env::temp_dir().join(&filename);

    println!("[Updater] Downloading {download_url} → {dest:?}");
    download_with_progress(&download_url, &dest, download_size, &app)
        .await
        .map_err(|e| {
            let _ = fs::remove_file(&dest);
            format!("Download failed: {e}")
        })?;

    // ── Step 2: Verify checksum ───────────────────────────────────────────────
    let _ = app.emit("update-status", "Verifying integrity…");

    if !checksum.is_empty() {
        verify_checksum(&dest, &checksum).inspect_err(|_| {
            let _ = fs::remove_file(&dest);
        })?;
        println!("[Updater] Checksum verified ✓");
    } else {
        println!("[Updater] No checksum in manifest — skipping verification");
    }

    // ── Step 3: Launch installer / replace binary ─────────────────────────────
    let _ = app.emit("update-status", "Launching installer…");
    launch_installer(&dest, app).await
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semver_newer() {
        assert!(is_newer("0.2.0", "0.1.2"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("0.1.3", "0.1.2"));
        assert!(!is_newer("0.1.2", "0.1.2"));
        assert!(!is_newer("0.1.1", "0.1.2"));
    }

    #[test]
    fn semver_with_v_prefix() {
        assert!(is_newer("v0.2.0", "v0.1.2"));
        assert!(is_newer("v0.2.0", "0.1.2"));
    }

    #[test]
    fn semver_prerelease_ignored() {
        assert!(is_newer("0.2.0-beta.1", "0.1.9"));
    }
}
