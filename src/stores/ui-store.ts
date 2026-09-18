import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n, { type LanguageCode, DEFAULT_LANGUAGE } from "@/lib/i18n";

type UiState = {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** Currently active UI language. */
  language: LanguageCode;
  setLanguage: (code: LanguageCode) => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

      language: DEFAULT_LANGUAGE,
      setLanguage: (code: LanguageCode) => {
        void i18n.changeLanguage(code);
        set({ language: code });
      },
    }),
    {
      name: "confinaid-test-tool-ui",
      // Re-apply the stored language on rehydration.
      onRehydrateStorage: () => (state) => {
        if (state?.language) {
          void i18n.changeLanguage(state.language);
        }
      },
    }
  )
);
