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
    clear: createCommandNoParams<void>("clear_credentials"),
  },

  // Planned namespaces — see the "Planned modules" block in src-tauri/src/lib.rs:
  //   request: { send, sendBulk }
  //   runner:  { startLoadTest, cancel, probeRateLimit }
  //   suite:   { list, save, remove, run }
  //   report:  { list, get, export }
} as const;
