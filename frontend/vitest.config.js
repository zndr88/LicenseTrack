import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // This is a timing-sensitive UI suite (fake timers, session/activity effects,
    // user-event interactions) that very occasionally flakes under parallel CPU
    // load, passing on re-run. Retry keeps such rare flakes from redding CI while
    // a genuinely broken test — failing all attempts — still fails.
    retry: 2,
    setupFiles: ["./src/__tests__/setup.js"],
    exclude: ["tests/e2e/**", "tests/demo/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        statements: 50,
        branches: 45,
        functions: 40,
        lines: 55,
      },
    },
  },
});
