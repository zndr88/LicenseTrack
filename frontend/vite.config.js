import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // The app build uses an absolute base so deep links such as /licenses/12
  // still load /assets/*. The demo build stays relative for its Pages sub-path.
  base: mode === "demo" ? "./" : "/",
  build: {
    outDir: mode === "demo" ? "dist-demo" : "dist",
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
}));
