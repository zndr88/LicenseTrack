import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { APP_VERSION } from "./src/version.js";
import { readBuildMetadata } from "./build/buildMetadata.js";

const metadata = readBuildMetadata(APP_VERSION, fileURLToPath(new URL(".", import.meta.url)), process.env);

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_BUILD_LABEL": JSON.stringify(metadata.label),
    "import.meta.env.VITE_BUILD_TOOLTIP": JSON.stringify(metadata.tooltip),
  },
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
