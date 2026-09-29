// SPDX-License-Identifier: Apache-2.0
/**
 * Persisted history of completed Load & Rate Limit runs.
 *
 * Only lightweight summary data is stored (no raw response bodies).
 * Capped at 200 entries to keep localStorage usage in check.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { LoadConfig } from "@/stores/load-store";

export interface LoadRunLatency {
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface LoadHistoryEntry {
  id: string;
  startedAt: number;
  finishedAt: number;
  config: LoadConfig;
  sent: number;
  success: number;
  errors: number;
  rateLimited: number;
  /** Requests per second over the full run duration. */
  throughputRps: number;
  latency: LoadRunLatency | null;
  statusCounts: Record<number, number>;
  /** Probe mode: concurrency level at which a 429 was first received. */
  probeLimitConcurrency: number | null;
  probeRetryAfterMs: number | null;
}

const MAX_HISTORY = 200;

interface LoadHistoryState {
  history: LoadHistoryEntry[];
  addRun: (entry: LoadHistoryEntry) => void;
  deleteEntry: (id: string) => void;
  clearHistory: () => void;
}

export const useLoadHistoryStore = create<LoadHistoryState>()(
  persist(
    (set) => ({
      history: [],
      addRun: (entry) =>
        set((s) => ({
          history: [entry, ...s.history].slice(0, MAX_HISTORY),
        })),
      deleteEntry: (id) => set((s) => ({ history: s.history.filter((e) => e.id !== id) })),
      clearHistory: () => set({ history: [] }),
    }),
    { name: "load-history-v1" }
  )
);
