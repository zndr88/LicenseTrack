import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { nodeTestFiles } from "./vitest.node-tests.js";

const sharedExclude = ["tests/**", "node_modules/**", "dist/**"];

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
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
    projects: [
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          setupFiles: ["./src/__tests__/setup.js"],
          exclude: [...sharedExclude, ...nodeTestFiles],
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: nodeTestFiles,
          exclude: sharedExclude,
        },
      },
    ],
  },
});
