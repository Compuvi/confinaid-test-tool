// SPDX-License-Identifier: Apache-2.0
/**
 * Load-test configuration store.
 *
 * Only the *configuration* is persisted — runtime stats live in React state
 * inside the page component so they reset on each run.
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
}

const DEFAULT_CONFIG: LoadConfig = {
  endpoint: "Analyze",
  body: '{\n  "text": ""\n}',
  concurrency: 5,
  mode: "count",
  totalRequests: 50,
  durationSecs: 30,
  timeoutMs: 10_000,
  probeStartConcurrency: 1,
  probeStep: 1,
  probeStepRequests: 10,
  probeMaxConcurrency: 20,
};

interface LoadStoreState {
  config: LoadConfig;
  setConfig: (partial: Partial<LoadConfig>) => void;
}

export const useLoadStore = create<LoadStoreState>()(
  persist(
    (set) => ({
      config: DEFAULT_CONFIG,
      setConfig: (partial) => set((s) => ({ config: { ...s.config, ...partial } })),
    }),
    { name: "load-config-v1" }
  )
);
