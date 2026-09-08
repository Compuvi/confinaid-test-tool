/** Mirrors `CredentialInput` in `src-tauri/src/commands/credentials.rs`. */
export type CredentialInput = {
  profileName: string;
  apiBaseUrl: string;
  clientId: string;
  /**
   * Write-only. Sent to Rust, stored in the OS keychain, and never returned —
   * there is deliberately no counterpart field on StoredCredentialProfile.
   */
  apiSecretKey: string;
};

/** Mirrors `StoredCredentialProfile` in the same module. */
export type StoredCredentialProfile = {
  profileName: string;
  apiBaseUrl: string;
  clientId: string;
  hasSecret: boolean;
  /** Last four characters of the stored secret, or null if too short to hint. */
  secretHint: string | null;
};
