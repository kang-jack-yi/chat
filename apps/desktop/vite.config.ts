import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  cacheDir: process.env.CHAT_VITE_CACHE_DIR,
  plugins: [react()],
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        auxiliary: resolve(__dirname, "auxiliary.html"),
        document: resolve(__dirname, "document.html"),
      },
    },
  },
  server: {
    strictPort: true,
  },
  test: {
    exclude: ["**/.forge-*/**", "**/node_modules/**", "**/dist/**"],
  },
});
