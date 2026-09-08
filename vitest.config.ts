import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Deliberately separate from vite.config.ts: the app build must not carry
// jsdom/test wiring, and the test run must not start a dev server.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "src-tauri", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/lib/**", "src/stores/**", "src/hooks/**", "src/components/**"],
      exclude: ["src/**/*.test.*", "src/__tests__/**", "src/components/ui/**"],
    },
  },
  define: {
    __APP_VERSION__: '"test"',
  },
  resolve: {
    alias: { "@": resolve(__dirname, "./src") },
  },
});
