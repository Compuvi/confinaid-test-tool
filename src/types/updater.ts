/** Mirrors `UpdateCheckResult` in `src-tauri/src/updater.rs`. */
export type UpdateCheckResult = {
  /** `true` when the latest GitHub release is strictly newer than the running build. */
  available: boolean;
  /** Version string of the running build (e.g. `"0.1.2"`). */
  current_version: string;
  /** Tag version from the latest GitHub release (e.g. `"0.2.0"`). */
  new_version: string | null;
  /** GitHub release page URL — fallback for manual download. */
  release_url: string | null;
  /** Release notes in Markdown. */
  release_notes: string | null;
  /** `true` when the manifest marks this update as mandatory. */
  mandatory: boolean;

  // ── Auto-install fields (only set when available === true) ───────────────
  /** Direct download URL for the platform-specific installer. */
  download_url: string | null;
  /** Expected file size in bytes. */
  download_size: number | null;
  /** SHA-256 hex checksum of the installer. */
  checksum: string | null;
  /** Installer filename (e.g. `"confinaid-test-tool_0.2.0_x64-setup.exe"`). */
  filename: string | null;
};

/** Emitted as `update-download-progress` during an install. */
export type DownloadProgress = {
  downloaded: number;
  total: number;
  percentage: number;
  /** bytes per second */
  speed_bps: number;
};
