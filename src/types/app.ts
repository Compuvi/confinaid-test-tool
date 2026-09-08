/** Mirrors `RuntimeInfo` in `src-tauri/src/commands/app.rs`. */
export type RuntimeInfo = {
  appVersion: string;
  tauriVersion: string;
  os: string;
  arch: string;
  isDebug: boolean;
};
