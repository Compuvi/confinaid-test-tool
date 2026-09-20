/**
 * Zustand store for the Bulk Import panel.
 *
 * Lives outside React so state (and in-progress runs) survive navigation —
 * the user can switch pages while a run is going, come back, and see exactly
 * where things are.
 */

import { create } from "zustand";
import type { EndpointId } from "@/types/request";

// ─── Types ───────────────────────────────────────────────────────────────────

export type BulkFile = {
  id: string;
  filename: string;
  /** Number of rows that were loaded from this file (after truncation). */
  rowCount: number;
};

export type BulkRowInput = {
  endpoint: EndpointId;
  body: Record<string, unknown>;
};

export type BulkRowEntry = BulkRowInput & {
  _id: string;
  /** Which BulkFile this row came from. */
  _fileId: string;
  status: "pending" | "running" | "done" | "error";
  httpStatus?: number;
  durationMs?: number;
  errorMsg?: string;
  /** First 3 000 chars of the response body — enough to diagnose failures. */
  responseBody?: string;
};

// ─── Store ───────────────────────────────────────────────────────────────────

interface BulkState {
  /** Ordered list of loaded files. The UI lets the user reorder these. */
  files: BulkFile[];
  /** All rows from all files, in file order. */
  rows: BulkRowEntry[];
  running: boolean;
  completedCount: number;
  /** Most-recent parse/load error (cleared on the next successful load). */
  parseError: string | null;

  // ── Actions ──────────────────────────────────────────────────────────────
  /** Append a new file and its rows (caller has already applied MAX_BULK_ROWS). */
  addFile: (file: BulkFile, newRows: BulkRowEntry[]) => void;
  /** Remove a file and all its rows. */
  removeFile: (fileId: string) => void;
  /**
   * Move a file one position up or down.
   * Rows are reordered to stay in sync with the new file order.
   * Only valid when no run is in progress.
   */
  moveFile: (fileId: string, direction: "up" | "down") => void;

  setRunning: (b: boolean) => void;
  setCompletedCount: (n: number) => void;
  /** Bulk-replace all rows (used to reset statuses at run start). */
  setRows: (rows: BulkRowEntry[]) => void;
  /** Patch one row by index. */
  updateRowAtIndex: (idx: number, patch: Partial<BulkRowEntry>) => void;
  setParseError: (e: string | null) => void;
  /** Reset everything to initial state. */
  clear: () => void;
}

export const useBulkStore = create<BulkState>((set) => ({
  files: [],
  rows: [],
  running: false,
  completedCount: 0,
  parseError: null,

  addFile: (file, newRows) =>
    set((state) => ({
      files: [...state.files, file],
      rows: [...state.rows, ...newRows],
      parseError: null,
    })),

  removeFile: (fileId) =>
    set((state) => ({
      files: state.files.filter((f) => f.id !== fileId),
      rows: state.rows.filter((r) => r._fileId !== fileId),
    })),

  moveFile: (fileId, direction) =>
    set((state) => {
      const files = [...state.files];
      const idx = files.findIndex((f) => f.id === fileId);
      if (idx === -1) return state;

      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= files.length) return state;

      // Swap the two file entries.
      [files[idx], files[target]] = [files[target], files[idx]];

      // Rebuild rows in new file order.
      const orderMap = new Map(files.map((f, i) => [f.id, i]));
      const rows = [...state.rows].sort(
        (a, b) => (orderMap.get(a._fileId) ?? 0) - (orderMap.get(b._fileId) ?? 0)
      );

      return { files, rows };
    }),

  setRunning: (b) => set({ running: b }),
  setCompletedCount: (n) => set({ completedCount: n }),
  setRows: (rows) => set({ rows }),
  updateRowAtIndex: (idx, patch) =>
    set((state) => ({
      rows: state.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    })),
  setParseError: (e) => set({ parseError: e }),
  clear: () =>
    set({
      files: [],
      rows: [],
      running: false,
      completedCount: 0,
      parseError: null,
    }),
}));

/**
 * Module-level abort flag — plain `let` so it survives component
 * unmount/remount while a run is in progress.
 */
let _bulkAbort = false;
export const getBulkAbort = () => _bulkAbort;
export const setBulkAbort = (v: boolean) => {
  _bulkAbort = v;
};
