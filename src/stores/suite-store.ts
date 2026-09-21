/**
 * Zustand store for the Suites feature.
 *
 * Suites and their test cases are persisted to localStorage via the `persist`
 * middleware so they survive app restarts. Run results and "currently running"
 * flags are ephemeral (not persisted).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Suite, TestCase, SuiteRunResult } from "@/types/suite";

// ──────────────────────────────────────────────────────── State shape ─────

type SuiteState = {
  /** All saved suites, ordered by creation time. */
  suites: Suite[];

  /** ID of the suite currently open in the detail panel. */
  selectedSuiteId: string | null;

  /**
   * Latest run result per suite ID.
   * Ephemeral — cleared on app restart.
   */
  runResults: Record<string, SuiteRunResult>;

  /**
   * Set of suite IDs that currently have an in-progress run.
   * Ephemeral — cleared on app restart.
   */
  runningSuiteIds: Set<string>;

  /**
   * Full history of all suite runs, newest first.
   * Persisted — survives app restarts. Capped at 500 entries.
   */
  runHistory: SuiteRunResult[];
};

type SuiteActions = {
  // ── Suite CRUD ────────────────────────────────────────────────────────
  /** Create a new suite, select it, and return the created instance. */
  createSuite: (name: string, description: string) => Suite;
  updateSuite: (id: string, patch: Partial<Pick<Suite, "name" | "description">>) => void;
  deleteSuite: (id: string) => void;
  selectSuite: (id: string | null) => void;

  // ── Case CRUD ─────────────────────────────────────────────────────────
  addCase: (suiteId: string, testCase: TestCase) => void;
  updateCase: (suiteId: string, caseId: string, patch: Partial<Omit<TestCase, "id">>) => void;
  deleteCase: (suiteId: string, caseId: string) => void;

  // ── Runner state ──────────────────────────────────────────────────────
  setRunResult: (suiteId: string, result: SuiteRunResult) => void;
  clearRunResult: (suiteId: string) => void;
  setRunning: (suiteId: string, running: boolean) => void;

  // ── Case ordering ─────────────────────────────────────────────────────
  reorderCase: (suiteId: string, caseId: string, direction: "up" | "down") => void;

  // ── Run history ───────────────────────────────────────────────────────
  /** Prepend a completed run to the persisted history (capped at 500). */
  addRunHistory: (result: SuiteRunResult) => void;
  /** Remove a single run from history, identified by its startedAt timestamp. */
  deleteHistoryEntry: (startedAt: number) => void;
  /** Wipe the entire run history. */
  clearHistory: () => void;
};

// ──────────────────────────────────────────────────────── Store ───────────

export const useSuiteStore = create<SuiteState & SuiteActions>()(
  persist(
    (set) => ({
      // ── Initial state ──
      suites: [],
      selectedSuiteId: null,
      runResults: {},
      runningSuiteIds: new Set(),
      runHistory: [],

      // ── Suite CRUD ────────────────────────────────────────────────────
      createSuite: (name, description) => {
        const suite: Suite = {
          id: crypto.randomUUID(),
          name,
          description,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          cases: [],
        };
        set((s) => ({ suites: [...s.suites, suite], selectedSuiteId: suite.id }));
        return suite;
      },

      updateSuite: (id, patch) =>
        set((s) => ({
          suites: s.suites.map((suite) =>
            suite.id === id ? { ...suite, ...patch, updatedAt: Date.now() } : suite
          ),
        })),

      deleteSuite: (id) =>
        set((s) => ({
          suites: s.suites.filter((suite) => suite.id !== id),
          selectedSuiteId: s.selectedSuiteId === id ? null : s.selectedSuiteId,
        })),

      selectSuite: (id) => set({ selectedSuiteId: id }),

      // ── Case CRUD ─────────────────────────────────────────────────────
      addCase: (suiteId, testCase) =>
        set((s) => ({
          suites: s.suites.map((suite) =>
            suite.id === suiteId
              ? {
                  ...suite,
                  cases: [...suite.cases, testCase],
                  updatedAt: Date.now(),
                }
              : suite
          ),
        })),

      updateCase: (suiteId, caseId, patch) =>
        set((s) => ({
          suites: s.suites.map((suite) =>
            suite.id === suiteId
              ? {
                  ...suite,
                  updatedAt: Date.now(),
                  cases: suite.cases.map((c) => (c.id === caseId ? { ...c, ...patch } : c)),
                }
              : suite
          ),
        })),

      deleteCase: (suiteId, caseId) =>
        set((s) => ({
          suites: s.suites.map((suite) =>
            suite.id === suiteId
              ? {
                  ...suite,
                  updatedAt: Date.now(),
                  cases: suite.cases.filter((c) => c.id !== caseId),
                }
              : suite
          ),
        })),

      // ── Runner state ──────────────────────────────────────────────────
      setRunResult: (suiteId, result) =>
        set((s) => ({
          runResults: { ...s.runResults, [suiteId]: result },
        })),

      clearRunResult: (suiteId) =>
        set((s) => {
          const next = { ...s.runResults };
          delete next[suiteId];
          return { runResults: next };
        }),

      setRunning: (suiteId, running) =>
        set((s) => {
          const next = new Set(s.runningSuiteIds);
          if (running) next.add(suiteId);
          else next.delete(suiteId);
          return { runningSuiteIds: next };
        }),

      // ── Run history ───────────────────────────────────────────────────
      addRunHistory: (result) =>
        set((s) => ({
          runHistory: [result, ...s.runHistory].slice(0, 500),
        })),

      deleteHistoryEntry: (startedAt) =>
        set((s) => ({
          runHistory: s.runHistory.filter((r) => r.startedAt !== startedAt),
        })),

      clearHistory: () => set({ runHistory: [] }),

      // ── Case ordering ─────────────────────────────────────────────────
      reorderCase: (suiteId, caseId, direction) =>
        set((s) => ({
          suites: s.suites.map((suite) => {
            if (suite.id !== suiteId) return suite;
            const idx = suite.cases.findIndex((c) => c.id === caseId);
            if (idx < 0) return suite;
            const newIdx = direction === "up" ? idx - 1 : idx + 1;
            if (newIdx < 0 || newIdx >= suite.cases.length) return suite;
            const cases = [...suite.cases];
            [cases[idx], cases[newIdx]] = [cases[newIdx], cases[idx]];
            return { ...suite, cases, updatedAt: Date.now() };
          }),
        })),
    }),
    {
      name: "confinaid-test-tool-suites",
      // Only persist the durable data — exclude ephemeral runtime state.
      partialize: (state) => ({
        suites: state.suites,
        selectedSuiteId: state.selectedSuiteId,
        runHistory: state.runHistory,
      }),
    }
  )
);
