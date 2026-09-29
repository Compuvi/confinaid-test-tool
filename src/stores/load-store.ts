// SPDX-License-Identifier: Apache-2.0
/**
 * Load-test configuration store.
 *
 * The configuration AND the last completed run's stats are both persisted so
 * that navigating away and back does not wipe the results panel.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { EndpointId } from "@/types/request";

export type LoadMode = "count" | "duration" | "probe";

export interface LoadConfig {
  endpoint: EndpointId;
  body: string;
  concurrency: number;
  mode: LoadMode;
  /** Fixed-count mode: total requests to fire. */
  totalRequests: number;
  /** Fixed-duration mode: how long to run (seconds). */
  durationSecs: number;
  /** Per-request timeout (ms). */
  timeoutMs: number;
  /** Rate-probe: starting concurrency level. */
  probeStartConcurrency: number;
  /** Rate-probe: increment per step. */
  probeStep: number;
  /** Rate-probe: requests sent at each concurrency level before ramping. */
  probeStepRequests: number;
  /** Rate-probe: ceiling concurrency level. */
  probeMaxConcurrency: number;
  /**
   * Optional pause between consecutive requests on each worker (ms).
   * 0 = back-to-back (default). Useful for simulating realistic think-time
   * or for reducing pressure during exploratory testing.
   */
  requestDelayMs: number;
}

/** Serialisable snapshot of a completed run — stored in localStorage. */
export interface SavedRunStats {
  sent: number;
  success: number;
  errors: number;
  rateLimited: number;
  /**
   * Raw latency samples capped at 1 000 entries for storage efficiency.
   * Percentile computation over this sample is accurate enough for display.
   */
  latenciesMs: number[];
  statusCounts: Record<number, number>;
  startedAt: number;
  /** Always set (only saved after a run finishes). */
  finishedAt: number;
  probeCurrentConcurrency: number;
  probeLimitConcurrency: number | null;
  probeRetryAfterMs: number | null;
  statusSamples: Record<
    number,
    Array<{ body: string; url: string; durationMs: number; index: number }>
  >;
  errorSamples: string[];
}

const DEFAULT_CONFIG: LoadConfig = {
  endpoint: "Analyze",
  body: '{\n  "content": "Merhaba, sözleşme taslağını ekte gönderiyorum."\n}',
  concurrency: 5,
  mode: "count",
  totalRequests: 50,
  durationSecs: 30,
  timeoutMs: 10_000,
  probeStartConcurrency: 1,
  probeStep: 1,
  probeStepRequests: 10,
  probeMaxConcurrency: 20,
  requestDelayMs: 0,
};

interface LoadStoreState {
  config: LoadConfig;
  setConfig: (partial: Partial<LoadConfig>) => void;
  /** Last completed run, restored when the Load page remounts. */
  savedStats: SavedRunStats | null;
  setSavedStats: (stats: SavedRunStats | null) => void;
}

export const useLoadStore = create<LoadStoreState>()(
  persist(
    (set) => ({
      config: DEFAULT_CONFIG,
      setConfig: (partial) => set((s) => ({ config: { ...s.config, ...partial } })),
      savedStats: null,
      setSavedStats: (stats) => set({ savedStats: stats }),
    }),
    { name: "load-config-v1" }
  )
);
