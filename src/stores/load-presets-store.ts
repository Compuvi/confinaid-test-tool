// SPDX-License-Identifier: Apache-2.0
/**
 * Persisted store for named Load & Rate Limit test presets.
 *
 * A preset is a snapshot of the full `LoadConfig` with a user-chosen name.
 * Presets are stored in localStorage via zustand/persist under the key
 * "load-presets-v1".
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { LoadConfig } from "./load-store";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LoadPreset {
  id: string;
  name: string;
  createdAt: number;
  config: LoadConfig;
}

interface LoadPresetsState {
  presets: LoadPreset[];
  /** Save the current config under `name`. Always prepends (newest first). */
  savePreset: (name: string, config: LoadConfig) => void;
  /** Remove a preset by id. */
  deletePreset: (id: string) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useLoadPresetsStore = create<LoadPresetsState>()(
  persist(
    (set) => ({
      presets: [],
      savePreset: (name, config) =>
        set((s) => ({
          presets: [
            {
              id: crypto.randomUUID(),
              name: name.trim() || "Untitled",
              createdAt: Date.now(),
              config,
            },
            ...s.presets,
          ],
        })),
      deletePreset: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
    }),
    { name: "load-presets-v1" }
  )
);
