import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "fs";

// @tauri-apps/cli sets this when running `tauri dev --host` for a physical
// device. Undefined for ordinary desktop development.
const host = process.env.TAURI_DEV_HOST;

// Single-source the version from package.json (tauri.conf.json reads it too).
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

export default defineConfig({
  plugins: [react(), tailwindcss()],

  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Tauri's CLI owns the terminal — don't let Vite clear its output.
  clearScreen: false,

  server: {
    port: 3000,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 3001 } : undefined,
    // Rust sources are watched by cargo, not Vite.
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
