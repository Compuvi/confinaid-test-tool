/**
 * Typed wrapper over Tauri's `invoke`.
 *
 * Components never call `invoke` directly — they go through the `commands`
 * object below, which is the single place a Rust command name appears in the
 * frontend. Renaming a command is then a one-line change here rather than a
 * grep across the codebase.
 */

import { invoke } from "@tauri-apps/api/core";

import { TauriError } from "./errors";
import type { RuntimeInfo } from "@/types/app";
import type { CredentialInput, StoredCredentialProfile } from "@/types/credentials";
import type {
  MonitoringFilters,
  MonitoringPage,
  MonitoringRecordDetail,
  MonitoringSummary,
} from "@/types/monitoring";
import type { SendRequestParams, RequestResult, TokenHint } from "@/types/request";
import type { UpdateCheckResult } from "@/types/updater";

export type CommandOptions = {
  /** Log call/result timing. Defaults to on in dev. */
  debug?: boolean;
  /** Reject after this many ms. Omit for commands that should never time out. */
  timeout?: number;
};

export type CommandFn<TParams, TResult> = TParams extends void
  ? () => Promise<TResult>
  : (params: TParams) => Promise<TResult>;

function run<TResult>(
  commandName: string,
  params: Record<string, unknown> | undefined,
  { debug = import.meta.env.DEV, timeout }: CommandOptions
): Promise<TResult> {
  const startedAt = performance.now();
  if (debug) console.debug(`[tauri] → ${commandName}`, params ?? {});

  const call = invoke<TResult>(commandName, params);

  const guarded =
    timeout === undefined
      ? call
      : Promise.race([
          call,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new TauriError(`${commandName} timed out after ${timeout}ms`)),
              timeout
            )
          ),
        ]);

  return guarded.then(
    (result) => {
      if (debug) {
        console.debug(
          `[tauri] ← ${commandName} (${Math.round(performance.now() - startedAt)}ms)`,
          result
        );
      }
      return result;
    },
    (error: unknown) => {
      throw TauriError.fromRust(error);
    }
  );
}

export function createCommand<TParams extends Record<string, unknown>, TResult>(
  commandName: string,
  options: CommandOptions = {}
): (params: TParams) => Promise<TResult> {
  return (params: TParams) => run<TResult>(commandName, params, options);
}

export function createCommandNoParams<TResult>(
  commandName: string,
  options: CommandOptions = {}
): () => Promise<TResult> {
  return () => run<TResult>(commandName, undefined, options);
}

/** One-off escape hatch for commands not yet in the `commands` object. */
export function tauriInvoke<TResult>(
  commandName: string,
  params?: Record<string, unknown>
): Promise<TResult> {
  return run<TResult>(commandName, params, {});
}

/**
 * Every Rust command, grouped by domain. camelCase here, snake_case in Rust —
 * matching `generate_handler!` in `src-tauri/src/lib.rs`.
 */
export const commands = {
  // App metadata: pure, no network, no state.
  app: {
    getVersion: createCommandNoParams<string>("get_app_version"),
    getRuntimeInfo: createCommandNoParams<RuntimeInfo>("get_runtime_info"),
  },

  // The API secret key crosses this boundary in one direction only. `save`
  // accepts it; `load` returns hasSecret + secretHint and never the value.
  credentials: {
    // Timed out because the Linux Secret Service can block on an unlock prompt.
    save: createCommand<{ profile: CredentialInput }, StoredCredentialProfile>("save_credentials", {
      timeout: 30_000,
    }),
    load: createCommandNoParams<StoredCredentialProfile | null>("load_credentials"),
    /** List all saved profiles (sorted by name). */
    list: createCommandNoParams<StoredCredentialProfile[]>("list_profiles"),
    /** Switch the active profile used for API requests. */
    switch: createCommand<{ profileName: string }, StoredCredentialProfile>("switch_profile", {
      timeout: 30_000,
    }),
    /** Delete a profile from config + keychain. Returns the new active profile (if any). */
    delete: createCommand<{ profileName: string }, StoredCredentialProfile | null>(
      "delete_profile",
      { timeout: 30_000 }
    ),
    clear: createCommandNoParams<StoredCredentialProfile | null>("clear_credentials"),
  },

  // HTTP request runner — one call per endpoint invocation.
  request: {
    /**
     * Fire one request against the Confinaid Partner API.
     *
     * The Rust side reads the stored credentials and injects the bearer token
     * automatically. The frontend never holds the API secret.
     *
     * Network failures are surfaced as rejected promises with a `TauriError`
     * whose `code` is one of: `"NETWORK_ERROR"`, `"UNAUTHORIZED"`, `"RATE_LIMITED"`,
     * `"VALIDATION_ERROR"`.
     */
    send: createCommand<{ params: SendRequestParams }, RequestResult>("send_request", {
      timeout: 120_000, // 2 min hard cap — rewrite can be slow
    }),

    /**
     * Return the cached token hint without making a network call.
     * Returns `null` when no token is cached or the cached token is expired.
     */
    getTokenStatus: createCommandNoParams<TokenHint | null>("get_token_status"),
  },

  // Updater — background check at startup; auto-install on user request.
  updater: {
    checkForUpdates: createCommandNoParams<UpdateCheckResult>("check_for_updates"),
    /**
     * Download, verify (SHA-256), and install the update.
     *
     * Progress is streamed via Tauri events:
     *   `update-download-progress` — DownloadProgress
     *   `update-status`            — string
     *
     * Resolves when the installer has been launched (app will exit shortly
     * after).  Rejects with an error message on failure.
     */
    installUpdate: createCommand<
      {
        downloadUrl: string;
        checksum: string;
        downloadSize: number;
        filename: string;
      },
      void
    >("install_update"),
  },

  // Partner API monitoring — requires company_id configured on the active profile.
  monitoring: {
    listRecords: createCommand<
      {
        filters: MonitoringFilters;
        page?: number;
        pageSize?: number;
        ordering?: string;
      },
      MonitoringPage
    >("list_monitoring_records", { timeout: 30_000 }),

    getSummary: createCommand<{ filters: MonitoringFilters }, MonitoringSummary>(
      "get_monitoring_summary",
      { timeout: 30_000 }
    ),

    getRecord: createCommand<{ recordId: string }, MonitoringRecordDetail>(
      "get_monitoring_record",
      { timeout: 30_000 }
    ),
  },

  // Planned namespaces — see the "Planned modules" block in src-tauri/src/lib.rs:
  //   runner:  { startLoadTest, cancel, probeRateLimit }
  //   suite:   { list, save, remove, run }
  //   report:  { list, get, export }
} as const;
