import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// One build serves both targets: the browser (GitHub Pages) and the Tauri
// shell. `base: "./"` keeps asset paths relative, which both need.
export default defineConfig({
  plugins: [react()],
  base: "./",
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: "safari16", outDir: "dist" },
  test: { environment: "node" },
});
