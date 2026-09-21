/**
 * Zustand store for the local request log.
 *
 * Persisted to localStorage via the `persist` middleware.
 * Capped at 1 000 entries so storage never grows unbounded.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { RequestLogEntry } from "@/types/request-log";

type RequestLogState = {
  entries: RequestLogEntry[];
};

type RequestLogActions = {
  /** Prepend a new entry, keeping the total at ≤ 1 000. */
  addEntry: (entry: RequestLogEntry) => void;
  /** Wipe the entire log. */
  clearLog: () => void;
};

export const useRequestLogStore = create<RequestLogState & RequestLogActions>()(
  persist(
    (set) => ({
      entries: [],

      addEntry: (entry) => set((s) => ({ entries: [entry, ...s.entries].slice(0, 1_000) })),

      clearLog: () => set({ entries: [] }),
    }),
    {
      name: "confinaid-test-tool-request-log",
    }
  )
);
